import { ferryPosition, HEIGHT, PIECES, RACE_TICK, WIDTH } from './game.js?v=24';

const blend=(a,b,t)=>a+(b-a)*t;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const roundKey=game=>game.match+'/'+game.round;
const pixel=value=>Math.round(value*100)/100;
export const raceTick=seconds=>Math.round(seconds/RACE_TICK);

export function motionPacket(game,player) {
  const {phase,match,round,elapsed}=game;
  const packet={type:'motion',phase,match,round,elapsed};
  if (phase==='build') packet.previews=game.previews;
  if (player) {
    const {x,y,vx,vy,face,ground,seal,support}=player;
    packet.pose=[pixel(x),pixel(y),pixel(vx),pixel(vy),face,ground,seal,support];
    packet.seat=player.id;
    if (player.outcome) Object.assign(packet,{type:'runner-end',elapsed:player.endedAt,outcome:player.outcome,trap:player.hitTrap});
  }
  return packet;
}

export function readRunnerPose(game,message) {
  const {elapsed,pose,outcome,trap}=message;
  if (!Number.isFinite(elapsed)||elapsed<0||elapsed>game.rules.raceTime||!Array.isArray(pose)||pose.length!==8) return null;
  const [x,y,vx,vy,face,ground,seal,support]=pose;
  if (![x,y,vx,vy].every(Number.isFinite)||x< -20||x>WIDTH||y< -1000||y>HEIGHT+50||
    Math.abs(vx)>600||Math.abs(vy)>1000||(face!==-1&&face!==1)||typeof ground!=='boolean'||typeof seal!=='boolean'||
    (support!==null&&(!Number.isInteger(support)||game.placed[support]?.kind!=='ferry'||!ground))) return null;
  if (message.type==='runner-end'&&(
    !['finish','hit','timeout'].includes(outcome)||(outcome==='timeout'&&elapsed!==game.rules.raceTime)||
    (trap!==null&&(outcome!=='hit'||!Number.isInteger(trap)||PIECES[game.placed[trap]?.kind]?.type!=='Trampa')))) return null;
  return {x,y,vx,vy,face,ground,seal,support};
}

export function stateVersion(game) {
  return JSON.stringify([
    game.match,game.round,game.phase,game.over,game.event.id,game.placed.length,
    game.picks,game.finishedBuilding,game.resetVotes,game.players.map(p=>[p.status,p.connected,p.seal,p.points]),
  ]);
}

export class BuildMotion {
  reset() {
    this.key='';
    this.frames=[];
    this.shown=0;
  }

  constructor() { this.reset(); }

  push(game,packet,now) {
    if (roundKey(packet)!==roundKey(game)||!Number.isFinite(packet.elapsed)||packet.elapsed<0) return;
    if (this.key!==roundKey(game)) {
      this.reset();
      this.key=roundKey(game);
    }
    if (packet.elapsed<=(this.frames.at(-1)?.elapsed??-1)) return;
    this.frames.push({elapsed:packet.elapsed,now,previews:packet.previews??{}});
    if (this.frames.length>12) this.frames.shift();
  }

  view(game,now) {
    if (game.phase!=='build'||this.key!==roundKey(game)||!this.frames.length) return game;
    const last=this.frames.at(-1);
    const offset=Math.min(...this.frames.map(frame=>frame.now-frame.elapsed*1000));
    const target=this.shown=clamp((now-offset-55)/1000,Math.max(this.shown,this.frames[0].elapsed),last.elapsed);
    const index=this.frames.findIndex(frame=>frame.elapsed>target);
    const before=index<0?last:this.frames[index-1];
    const after=index<0?before:this.frames[index];
    const ratio=before===after?0:(target-before.elapsed)/(after.elapsed-before.elapsed);
    const previews={};
    for (const [id,older] of Object.entries(before.previews)) {
      const newer=after.previews[id];
      previews[id]=newer?{...older,x:blend(older.x,newer.x,ratio),y:blend(older.y,newer.y,ratio)}:older;
    }
    return {...game,elapsed:target,previews};
  }
}

export class RemoteRunners {
  constructor() { this.streams=new Map(); }

  reset() { this.streams.clear(); }

  push(player,pose,at,received,outcome=null) {
    if (!this.streams.has(player.id)) this.streams.set(player.id,{
      frames:[{...player,at:0}],delay:.08,shown:null,drawnAt:null,
    });
    const stream=this.streams.get(player.id);
    const last=stream.frames.at(-1);
    if (last.outcome||at<last.at||(at===last.at&&!outcome)) return false;
    if (!outcome) {
      const gap=at-last.at;
      const transit=Math.max(0,received-at);
      const delay=clamp(transit+Math.max(.04,gap),.065,.42);
      stream.delay=blend(stream.delay,delay,delay>stream.delay?.2:.08);
    }
    const status=outcome==='finish'?'done':outcome?'out':'running';
    const departure=pose.ground?null:Number.isInteger(last.support)?{support:last.support,at}:last.departure;
    stream.frames.push({...pose,at,status,outcome,departure});
    if (stream.frames.length>30) stream.frames.shift();
    return true;
  }

  view(game,player) {
    const stream=this.streams.get(player.id);
    if (!player.connected||!stream) return player;
    const {frames}=stream;
    const last=frames.at(-1);
    const desired=clamp(game.elapsed-stream.delay,frames[0].at,last.at);
    if (stream.shown===null) stream.shown=desired;
    else {
      const dt=game.elapsed-stream.drawnAt;
      const speed=clamp(1+(desired-stream.shown-dt)/.12,.75,1.22);
      stream.shown=clamp(stream.shown+dt*speed,frames[0].at,last.at);
    }
    stream.drawnAt=game.elapsed;
    const target=stream.shown;
    const next=frames.findIndex(frame=>frame.at>target);
    const before=next<0?frames.at(-1):frames[Math.max(0,next-1)];
    const after=next<0?before:frames[next];
    const ratio=before===after||before.status!==after.status?0:clamp((target-before.at)/(after.at-before.at),0,1);
    const x=frame=>{
      const support=frame.support??frame.departure?.support;
      if (frame.status!=='running'||!Number.isInteger(support)) return frame.x;
      const strength=frame.departure?clamp(1-(frame.at-frame.departure.at)/.18,0,1):1;
      return frame.x+(ferryPosition(game,support,game.elapsed).x-ferryPosition(game,support,frame.at).x)*strength;
    };
    return {...player,...before,x:blend(x(before),x(after),ratio),y:blend(before.y,after.y,ratio),
      vx:blend(before.vx,after.vx,ratio),vy:blend(before.vy,after.vy,ratio)};
  }
}
