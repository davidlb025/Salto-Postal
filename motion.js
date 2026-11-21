import { advanceRunner, raceSolids, RACE_TICK } from './game.js?v=10';

const MIN_DELAY=64,MAX_DELAY=132;
const TICK_MS=RACE_TICK*1000;
const PREDICTION_LIMIT=500;
const snap=value=>Math.round(value*10)/10;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const lerp=(from,to,ratio)=>from+(to-from)*ratio;
const phaseKey=state=>JSON.stringify([state.match,state.round,state.phase]);

export function motionPacket(game) {
  const packet={type:'motion',match:game.match,round:game.round,phase:game.phase,elapsed:game.elapsed};
  if (game.phase==='race') packet.players=game.players.map(p=>[
    p.id,snap(p.x),snap(p.y),snap(p.vx),snap(p.vy),p.face,p.ground,p.status,
    p.surface,p.jumpSurface,p.surfaceFace,p.iceCarry,p.coyote,p.jumpBuffer,p.previous,p.inputSequence,
  ]);
  if (game.phase==='build') packet.previews=game.previews;
  return packet;
}

export function stateVersion(game) {
  return JSON.stringify([
    game.match,game.round,game.phase,game.over,game.event.id,game.placed.length,
    game.picks,game.finishedBuilding,game.resetVotes,game.players.map(p=>[p.status,p.connected,p.seal,p.points]),
  ]);
}

function mixPlayer(player,older,newer,t) {
  if (!older) return player;
  const [,x,y,vx,vy,face,ground,status]=older;
  const same=newer&&newer[7]===status;
  return {...player,face,ground,status,
    x:same?lerp(x,newer[1],t):x,y:same?lerp(y,newer[2],t):y,
    vx:same?lerp(vx,newer[3],t):vx,vy:same?lerp(vy,newer[4],t):vy};
}

export class MotionBuffer {
  reset(key='') {
    this.key=key;
    this.frames=[];
    this.jitter=0;
    this.clock=null;
    this.lastDraw=null;
  }

  constructor() { this.reset(); }

  push(game,packet,received) {
    const key=phaseKey(game);
    if (phaseKey(packet)!==key||!Number.isFinite(packet.elapsed)||packet.elapsed<0) return false;
    if (this.key!==key) this.reset(key);
    const at=packet.elapsed*1000;
    const last=this.frames.at(-1);
    if (last&&at<=last.at) return false;
    if (last) {
      const deviation=Math.abs((received-last.received)-(at-last.at));
      this.jitter=lerp(this.jitter,Math.min(180,deviation),.12);
    }
    this.frames.push({at,received,packet});
    if (this.frames.length>24) this.frames.shift();
    return true;
  }

  view(game,now) {
    if (this.key!==phaseKey(game)||!this.frames.length||!['build','race'].includes(game.phase)) return game;
    const first=this.frames[0],last=this.frames.at(-1);
    const offset=Math.min(...this.frames.map(frame=>frame.received-frame.at));
    const delay=clamp(MIN_DELAY+this.jitter*2,MIN_DELAY,MAX_DELAY);
    const target=clamp(now-offset-delay,first.at,last.at);
    if (this.clock===null||now-this.lastDraw>250||last.at-this.clock>350) this.clock=target;
    else {
      const speed=clamp(1+(target-this.clock)/125,.75,1.24);
      this.clock=clamp(this.clock+Math.max(0,now-this.lastDraw)*speed,first.at,last.at);
    }
    this.lastDraw=now;
    const next=this.frames.findIndex(frame=>frame.at>this.clock);
    const before=next<0?last:this.frames[Math.max(0,next-1)];
    const after=next<0?before:this.frames[next];
    const t=before===after?0:clamp((this.clock-before.at)/(after.at-before.at),0,1);
    if (game.phase==='build') {
      const previews={};
      for (const [id,older] of Object.entries(before.packet.previews??{})) {
        const newer=after.packet.previews?.[id];
        previews[id]=newer?{...older,x:lerp(older.x,newer.x,t),y:lerp(older.y,newer.y,t)}:older;
      }
      return {...game,elapsed:this.clock/1000,previews};
    }
    const oldPlayers=before.packet.players??[],newPlayers=after.packet.players??[];
    const players=game.players.map(player=>mixPlayer(player,oldPlayers.find(p=>p[0]===player.id),newPlayers.find(p=>p[0]===player.id),t));
    return {...game,elapsed:this.clock/1000,players};
  }
}

export class GuestMovement {
  prepare(game,id,now) {
    const player=game?.phase==='race'&&game.players.find(p=>p.id===id);
    if (!player) return false;
    const key=phaseKey(game);
    if (this.key!==key) {
      this.key=key;
      this.commands=[];
      this.offsets=[];
      this.lead=55;
      this.errorX=0;
      this.errorY=0;
      this.drawnAt=now;
      this.anchor(player,game.elapsed,now);
    }
    return true;
  }

  anchor(player,elapsed,at) {
    this.player={...player};
    this.elapsed=elapsed;
    this.anchorAt=this.simulatedAt=at;
    this.sequence=player.inputSequence;
    this.bits=player.previous;
  }

  record(game,id,bits,sequence,now) {
    if (!this.prepare(game,id,now)) return;
    this.commands.push({bits,sequence,at:now});
    if (this.commands.length>128) this.commands.shift();
  }

  advance(game,now) {
    if (this.player.status!=='running') return;
    const limit=Math.min(now,this.anchorAt+PREDICTION_LIMIT);
    while (this.simulatedAt+TICK_MS<=limit) {
      this.simulatedAt+=TICK_MS;
      this.elapsed+=RACE_TICK;
      let jump=false;
      for (const command of this.commands) {
        if (command.at>this.simulatedAt) break;
        if (command.sequence<=this.sequence) continue;
        jump||=Boolean(command.bits&4)&&!(this.bits&4);
        this.bits=command.bits;
        this.sequence=command.sequence;
      }
      advanceRunner(game,this.player,this.bits|(jump?8:0),RACE_TICK,this.elapsed,raceSolids(game,this.elapsed));
    }
  }

  reconcile(game,packet,id,now) {
    if (!this.prepare(game,id,now)) return;
    const state=game.players.find(p=>p.id===id);
    const snapshot=packet.players?.find(row=>row[0]===id);
    if (!snapshot||state.status!=='running') return;
    const [,x,y,vx,vy,face,ground,status,surface,jumpSurface,surfaceFace,iceCarry,coyote,jumpBuffer,previous,inputSequence]=snapshot;
    this.advance(game,now);
    const prior=this.player;
    const acknowledged=this.commands.find(command=>command.sequence===inputSequence);
    if (acknowledged) this.lead=lerp(this.lead,clamp((now-acknowledged.at)/2,15,170),.22);
    this.commands=this.commands.filter(command=>command.sequence>inputSequence);
    this.offsets.push(now-packet.elapsed*1000);
    if (this.offsets.length>12) this.offsets.shift();
    // Replay inputs the host has yet to consume from the authoritative race clock.
    const at=Math.max(now-250,packet.elapsed*1000+Math.min(...this.offsets)-this.lead);
    this.anchor({...state,x,y,vx,vy,face,ground,status,surface,jumpSurface,surfaceFace,iceCarry,coyote,jumpBuffer,previous,inputSequence},packet.elapsed,at);
    this.advance(game,now);
    const dx=prior.x+this.errorX-this.player.x, dy=prior.y+this.errorY-this.player.y;
    const smooth=prior.status===status&&status==='running'&&Math.hypot(dx,dy)<96;
    this.errorX=smooth?dx:0;
    this.errorY=smooth?dy:0;
  }

  view(game,id,now) {
    if (!this.prepare(game,id,now)) return null;
    const player=game.players.find(p=>p.id===id);
    if (player.status!=='running') return player;
    this.advance(game,now);
    const decay=Math.exp(-(now-this.drawnAt)/65);
    this.drawnAt=now;
    this.errorX*=decay;
    this.errorY*=decay;
    const {x,y,vx,vy,face,ground,status}=this.player;
    return {...player,x:x+this.errorX,y:y+this.errorY,vx,vy,face,ground,status};
  }
}
