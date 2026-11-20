const MIN_DELAY=64,MAX_DELAY=132;
const snap=value=>Math.round(value*10)/10;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const lerp=(from,to,ratio)=>from+(to-from)*ratio;
const phaseKey=state=>JSON.stringify([state.match,state.round,state.phase]);

export function motionPacket(game) {
  const packet={type:'motion',match:game.match,round:game.round,phase:game.phase,elapsed:game.elapsed};
  if (game.phase==='race') packet.players=game.players.map(p=>[
    p.id,snap(p.x),snap(p.y),snap(p.vx),snap(p.vy),p.face,p.ground,p.status,
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
