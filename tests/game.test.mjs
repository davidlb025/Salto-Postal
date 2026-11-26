import assert from 'node:assert/strict';
import test from 'node:test';
import { ARENAS, RACE_TICK, beginRace, chooseArena, defaultProfile, disconnect, finishRace, newGame, roomRules, settleRunner, step, voteResult } from '../game.js';
import { blankMap, isRouteVerified, readMap, routeVerification } from '../map-data.js';

function race(ids=[0,1,2,3],rules) {
  const game=newGame(ids,0,{},rules);
  beginRace(game);
  return game;
}

test('random is the default vote and is drawn only when the selected option is resolved',t=>{
  const ids=[0,1,2];
  const profiles=Object.fromEntries(ids.map(id=>[id,defaultProfile(id)]));
  const random=t.mock.method(Math,'random',()=>.99);
  assert.equal(voteResult(ids,profiles),null);
  profiles[1].vote=3;
  assert.equal(voteResult(ids,profiles),null);
  assert.equal(random.mock.callCount(),0);
  assert.equal(chooseArena(voteResult(ids,profiles)),ARENAS.length-1);
  profiles[2].vote=3;
  assert.equal(chooseArena(voteResult(ids,profiles)),3);
  assert.equal(voteResult([0,1],profiles),null);
  profiles[0].vote=5;
  assert.equal(voteResult([0,1],profiles),5);
  assert.equal(random.mock.callCount(),1);
});

test('first place uses simulation ticks, regardless of arrival packet order, and preserves a podium tie',()=>{
  const game=race(undefined,{firstPoints:4,winPoints:4});
  settleRunner(game,game.players[2],'finish',122*RACE_TICK);
  settleRunner(game,game.players[1],'finish',121*RACE_TICK+1e-10);
  settleRunner(game,game.players[0],'finish',121*RACE_TICK);
  settleRunner(game,game.players[3],'finish',123*RACE_TICK);
  assert.equal(settleRunner(game,game.players[0],'finish',1),false);
  finishRace(game);
  finishRace(game);
  assert.deepEqual(game.finish,[0,1,2,3]);
  assert.deepEqual(game.players.map(p=>p.points),[4,4,0,0]);
  assert.deepEqual(game.standings.slice(0,2),[{id:0,rank:1},{id:1,rank:1}]);
  assert.match(game.roundNote,/Primero compartido/);
  assert.equal(game.competitiveRounds,1);
});

test('trap points are capped according to deliveries, and seals only pay out on delivery',()=>{
  for (const delivered of [false,true]) {
    const game=race(undefined,{deliveryPoints:5,firstPoints:0,sealPoints:2});
    game.placed=[{kind:'spike',owner:0}];
    for (const player of game.players.slice(1)) {
      player.seal=true;
      settleRunner(game,player,'hit',1,0);
    }
    game.players[0].seal=true;
    settleRunner(game,game.players[0],delivered?'finish':'hit',2,delivered?null:0);
    finishRace(game);
    assert.deepEqual(game.players[0].score,{goal:delivered?5:0,first:0,trap:delivered?2:1,style:delivered?2:0});
    assert.deepEqual(game.players.slice(1).map(p=>p.points),[0,0,0]);
  }
});

test('the optional delivery condition controls points when every competitive runner finishes',()=>{
  for (const deliveryRequiresRivalFailure of [true,false]) {
    for (const abandoned of [false,true]) {
      const game=race([0,1,2],{deliveryPoints:6,deliveryRequiresRivalFailure,firstPoints:0});
      settleRunner(game,game.players[0],'finish',1);
      settleRunner(game,game.players[1],'finish',2);
      if (abandoned) disconnect(game,2);
      else settleRunner(game,game.players[2],'finish',3);
      finishRace(game);
      const bonus=deliveryRequiresRivalFailure?0:6;
      assert.deepEqual(game.players.map(p=>p.score.goal),[bonus,bonus,abandoned?0:bonus]);
    }
  }
});

test('custom trap points use the independent round cap for the actual delivery outcome',()=>{
  for (const delivered of [false,true]) {
    for (const trapPoints of [0,4]) {
      const game=race([0,1,2],{trapPoints,trapCap:3,trapCapWithoutFinish:5});
      game.placed=[{kind:'spike',owner:0}];
      settleRunner(game,game.players[1],'hit',1,0);
      settleRunner(game,game.players[2],'hit',2,0);
      if (delivered) settleRunner(game,game.players[0],'finish',3);
      finishRace(game);
      assert.equal(game.players[0].score.trap,trapPoints?delivered?3:5:0);
      if (trapPoints) assert.match(game.roundNote,delivered?/máximo de 3/:/máximo de 5 sin entregas/);
    }
  }
  const zeroCap=race([0,1],{trapPoints:4,trapCap:0});
  zeroCap.placed=[{kind:'spike',owner:0}];
  settleRunner(zeroCap,zeroCap.players[1],'hit',1,0);
  settleRunner(zeroCap,zeroCap.players[0],'finish',2);
  finishRace(zeroCap);
  assert.equal(zeroCap.players[0].score.trap,0);
});

test('disconnect preserves confirmed finishes, eliminations and credits',()=>{
  const game=race();
  game.placed=[{kind:'spike',owner:0}];
  settleRunner(game,game.players[1],'hit',1,0);
  disconnect(game,1);
  disconnect(game,0);
  settleRunner(game,game.players[2],'finish',2);
  disconnect(game,2);
  finishRace(game);
  assert.deepEqual(game.players.map(p=>p.outcome),['abandon','hit','finish','timeout']);
  assert.deepEqual(game.players.map(p=>p.points),[1,0,4,0]);
  assert.equal(game.returnToLobby,true);
  assert.equal(game.competitiveRounds,1);
});

test('abandonment alone never awards delivery and a cancelled round does not consume the round limit',()=>{
  const game=race([0,1,2],{maxRounds:1});
  disconnect(game,2);
  settleRunner(game,game.players[0],'finish',1);
  settleRunner(game,game.players[1],'finish',1);
  finishRace(game);
  assert.deepEqual(game.players.map(p=>p.points),[1,1,0]);
  assert.equal(game.over,true);

  const cancelled=race([0,1],{maxRounds:1});
  cancelled.players[0].points=5;
  disconnect(cancelled,1);
  settleRunner(cancelled,cancelled.players[0],'finish',1);
  finishRace(cancelled);
  assert.equal(cancelled.players[0].points,5);
  assert.equal(cancelled.competitiveRounds,0);
  assert.equal(cancelled.cancelled,true);
  assert.equal(cancelled.over,false);
  assert.equal(cancelled.returnToLobby,true);
});

test('last valid simulation tick credits arrivals and the first overlapping trap takes priority over the goal',()=>{
  const game=race([0,1,2,3]);
  const {exit}=ARENAS[0];
  const [first,second,victim,timedOut]=game.players;
  const trap={kind:'spike',x:exit.x+20,y:exit.y+30,w:48,h:16};
  game.placed=[{...trap,owner:0},{...trap,owner:1}];
  Object.assign(victim,{x:exit.x+26,y:exit.y+18});
  for (const player of [first,second]) Object.assign(player,{x:exit.x,y:exit.y+3});
  game.elapsed=game.deadline-RACE_TICK;
  step(game,{},RACE_TICK);
  assert.equal(game.phase,'result');
  assert.deepEqual(game.finish,[0,1]);
  assert.equal(victim.hitTrap,0);
  assert.equal(timedOut.outcome,'timeout');
  assert.deepEqual(game.players.map(p=>p.points),[5,4,0,0]);
});

test('v1 maps keep a verification through export and import and invalidate it for different geometry or rules',()=>{
  const map=blankMap();
  const rules=roomRules();
  assert.equal(isRouteVerified(readMap(map),rules),false);
  map.routeVerification=routeVerification(map,rules);
  assert.equal(isRouteVerified(readMap(JSON.parse(JSON.stringify(map))),rules),true);
  assert.equal(isRouteVerified(readMap({...map,name:'Otro nombre'}),rules),true);
  assert.equal(isRouteVerified(readMap({...map,gravity:955}),rules),false);
  assert.equal(isRouteVerified(readMap(map),roomRules({speed:110})),false);
  assert.equal(isRouteVerified(readMap(map),roomRules({raceTime:40})),false);
});
