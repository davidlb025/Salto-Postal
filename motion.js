import { advanceRunner, ferryPosition, raceSolids, runnerContacts, runnerPredictionWeight, runnerTouchesTrap, RACE_TICK } from './game.js?v=22';

export const RACE_HISTORY=8;

const DEFAULT_DELAY=38,FAST_RACE_DELAY=22,MAX_DELAY=180;
const MAX_RACE_ADVANCE=25;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const lerp=(from,to,ratio)=>from+(to-from)*ratio;
const phaseKey=state=>JSON.stringify([state.match,state.round,state.phase]);
const pixel=value=>Math.round(value*1000)/1000;

export function raceFrame(game) {
  const final=game.phase==='result';
  return [final?game.raceEndedAt:game.elapsed,game.event.id-Number(final),game.players.map(p=>[
    p.id,pixel(p.x),pixel(p.y),pixel(p.vx),Math.round(p.vy),p.face,p.ground,p.status,p.seal,p.connected,
    p.inputSequence,p.inputAt,p.previous,p.surface,p.jumpBuffer,
  ])];
}

export function motionPacket(game,frames) {
  const packet={type:'motion',match:game.match,round:game.round,phase:game.phase,elapsed:game.elapsed};
  if (frames?.length) {
    packet.phase='race';
    packet.elapsed=frames.at(-1)[0];
    packet.simulationTick=raceTick(game.phase==='result'?game.raceEndedAt:game.elapsed);
    packet.frames=frames;
    packet.timed=game.placed.flatMap(({armedAt,collapseAt},index)=>
      armedAt===undefined&&collapseAt===undefined?[]:[[index,armedAt??null,collapseAt??null]]);
    packet.events=game.events.filter(event=>event.id>=frames[0][1]&&event.id<=frames.at(-1)[1]);
    // Replay uses the full step state. Keep the row prefix readable by older guests.
    packet.players=game.players.map(p=>[
      p.id,p.x,p.y,p.vx,p.vy,p.face,p.ground,p.status,
      p.surface,p.jumpSurface,p.surfaceFace,p.iceCarry,p.coyote,p.jumpBuffer,p.previous,p.inputSequence,p.inputAt,p.support,p.inputJumps,p.ferryDeparture,
    ]);
  }
  if (game.phase==='build') packet.previews=game.previews;
  return packet;
}

export function stateVersion(game) {
  return JSON.stringify([
    game.match,game.round,game.phase,game.over,game.event.id,game.placed.length,
    game.picks,game.finishedBuilding,game.resetVotes,game.players.map(p=>[p.status,p.connected,p.seal,p.points]),
  ]);
}

function legacyFrame(game,packet) {
  const players=packet.players.map(([id,x,y,vx,vy,face,ground,status])=>{
    const player=game.players.find(p=>p.id===id);
    return [id,x,y,vx,vy,face,ground,status,player?.seal,player?.connected];
  });
  return [packet.elapsed,game.event.id,players];
}

export class MotionBuffer {
  constructor() { this.reset(); }

  reset(key='') {
    this.key=key;
    this.frames=[];
    this.samples=[];
    this.timed=new Map();
    this.events=new Map();
    this.jitter=0;
    this.spacing=1000/30;
    this.clock=null;
    this.presentedAt=-1;
    this.presentedEvent=-1;
    this.lastDraw=null;
  }

  push(game,packet,received,reliable=false) {
    const key=phaseKey(game);
    if (phaseKey(packet)!==key||!Number.isFinite(packet.elapsed)||packet.elapsed<0) return;
    if (this.key!==key) this.reset(key);
    const at=packet.elapsed*1000;
    const sample=this.samples.at(-1);
    if ((!reliable||!sample)&&(!sample||at>sample.at)) {
      if (sample) {
        const gap=at-sample.at;
        const deviation=Math.abs((received-sample.received)-gap);
        this.jitter=lerp(this.jitter,Math.min(180,deviation),.12);
        this.spacing=lerp(this.spacing,Math.min(MAX_DELAY,gap),gap>this.spacing?.24:.14);
      }
      this.samples.push({at,received});
      if (this.samples.length>24) this.samples.shift();
    }

    if (packet.phase==='race') {
      const incoming=packet.frames??(Array.isArray(packet.players)?[legacyFrame(game,packet)]:[]);
      for (const snapshot of incoming) {
        const time=snapshot[0]*1000;
        if (time<this.presentedAt) continue;
        const index=this.frames.findIndex(frame=>frame.at>=time);
        const frame={at:time,snapshot};
        if (index<0) this.frames.push(frame);
        else if (this.frames[index].at>time) this.frames.splice(index,0,frame);
        else if (reliable) this.frames[index]=frame;
      }
      for (const [index,armedAt,collapseAt] of packet.timed??[]) this.timed.set(index,{armedAt:armedAt??undefined,collapseAt:collapseAt??undefined});
      for (const event of packet.events??[]) this.events.set(event.id,event);
      const oldestEvent=(this.frames.at(-1)?.snapshot[1]??0)-48;
      for (const id of this.events.keys()) if (id<oldestEvent) this.events.delete(id);
    } else if (packet.phase==='build'&&at>(this.frames.at(-1)?.at??-1)) {
      this.frames.push({at,previews:packet.previews});
    }
    if (this.frames.length>72) this.frames.splice(0,this.frames.length-72);
  }

  view(game,now,playerId,inputSequence=0) {
    if (this.key!==phaseKey(game)||!this.frames.length) return game;
    const first=this.frames[0],last=this.frames.at(-1);
    const racing=game.phase==='race';
    const responding=racing&&inputSequence>0;
    const offset=Math.min(...this.samples.map(sample=>sample.received-sample.at));
    const baseDelay=racing?clamp(this.spacing+5,FAST_RACE_DELAY,DEFAULT_DELAY):DEFAULT_DELAY;
    const delay=Math.min(responding?20:MAX_DELAY,baseDelay+this.jitter*2);
    let target=clamp(now-offset-delay,first.at,last.at);
    if (responding) {
      const confirmed=this.frames.find(frame=>frame.at>target&&frame.snapshot[2].some(row=>row[0]===playerId&&row[10]>=inputSequence));
      if (confirmed) target=confirmed.at;
    }
    if (this.clock===null||(!racing&&(now-this.lastDraw>250||last.at-this.clock>500))) {
      this.clock=Math.max(this.clock??0,target);
    }
    else {
      const dt=Math.max(0,now-this.lastDraw);
      const speed=clamp(1+(target-this.clock-dt)/100,.65,responding?1.5:1.35);
      // A confirmation may catch playback up gradually, never jump the race clock.
      const advance=racing?Math.min(dt*speed,MAX_RACE_ADVANCE):dt*speed;
      this.clock=clamp(this.clock+advance,first.at,last.at);
    }
    this.lastDraw=now;
    const next=this.frames.findIndex(frame=>frame.at>this.clock);
    let before=next<0?last:this.frames[Math.max(0,next-1)];
    if (racing) {
      before=this.frames.find(frame=>frame.at>this.presentedAt&&frame.at<before.at&&frame.snapshot[1]>this.presentedEvent)??before;
      this.presentedAt=before.at;
      this.presentedEvent=before.snapshot[1];
      return this.raceView(game,before.snapshot);
    }

    const after=next<0?before:this.frames[next];
    const t=before===after?0:clamp((this.clock-before.at)/(after.at-before.at),0,1);
    const previews={};
    for (const [id,older] of Object.entries(before.previews??{})) {
      const newer=after.previews?.[id];
      previews[id]=newer?{...older,x:lerp(older.x,newer.x,t),y:lerp(older.y,newer.y,t)}:older;
    }
    return {...game,elapsed:this.clock/1000,previews};
  }

  raceView(game,[elapsed,eventId,rows]) {
    const players=game.players.map(player=>{
      const row=rows.find(fields=>fields[0]===player.id);
      if (!row) return player;
      const [,x,y,vx,vy,face,ground,status,seal,connected,inputSequence,inputAt,previous,surface,jumpBuffer]=row;
      return {...player,x,y,vx,vy,face,ground,status,seal,connected,inputSequence,inputAt,previous,surface,jumpBuffer};
    });
    const placed=this.timed.size?game.placed.map((part,index)=>{
      const times=this.timed.get(index);
      return times?{...part,...times}:part;
    }):game.placed;
    const events=new Map(game.events.map(event=>[event.id,event]));
    for (const [id,event] of this.events) events.set(id,event);
    const visible=[...events.values()].filter(event=>event.id<=eventId).sort((a,b)=>a.id-b.id);
    return {...game,elapsed,players,placed,events:visible,event:visible.at(-1)??{id:0,sound:''}};
  }
}

const TICK_MS=RACE_TICK*1000;
const PREDICTION_TICKS=36,MAX_INPUT_LEAD=24;
const DEPARTURE_BLEND=.18;
export const raceTick=seconds=>Math.round(seconds/RACE_TICK);

export class RunnerInputs {
  constructor() {
    this.pending=new Map();
    this.applied={bits:0,sequence:0,jumps:0};
  }

  add(message,nextTick) {
    if (message.sequence<=this.applied.sequence||this.pending.has(message.sequence)||this.pending.size>=64) return;
    const scheduled=Number.isSafeInteger(message.atTick);
    const tick=scheduled?clamp(message.atTick,nextTick,nextTick+MAX_INPUT_LEAD):nextTick;
    const jumps=Number.isSafeInteger(message.jumps)&&message.jumps>=0?message.jumps:null;
    this.pending.set(message.sequence,{tick,scheduled,waitUntil:nextTick+3,bits:message.bits,sequence:message.sequence,jumps});
  }

  take(tick) {
    let jump=false,changed=false;
    const ordered=[...this.pending.values()].sort((a,b)=>a.sequence-b.sequence);
    for (const command of ordered) {
      if (command.tick>tick) break;
      if (command.scheduled&&((command.sequence>this.applied.sequence+1&&tick<command.waitUntil)||
        (changed&&command.bits!==this.applied.bits))) break;
      this.pending.delete(command.sequence);
      const previous=this.applied;
      const pressed=Boolean(command.bits&4)&&!(previous.bits&4);
      const jumps=Math.max(previous.jumps,command.jumps??previous.jumps+Number(pressed));
      jump||=jumps>previous.jumps;
      changed||=command.bits!==previous.bits;
      this.applied={...command,jumps};
    }
    return {...this.applied,input:this.applied.bits|(jump?8:0),urgent:changed||jump};
  }
}

export class GuestRunner {
  constructor() { this.reset(); }

  reset() {
    this.commands=[];
    this.latest=null;
    this.anchor=null;
    this.runner=null;
    this.tick=0;
    this.origin=null;
    this.clocks=[];
    this.errorX=0;
    this.errorY=0;
    this.lastPose=null;
    this.previewSealTick=null;
  }

  synchronize(tick,sent,now) {
    const rtt=now-sent;
    if (!Number.isSafeInteger(tick)||!Number.isFinite(rtt)||rtt<0||rtt>1200) return;
    // A command issued at the probe's local send time reached this host tick.
    this.clocks.push({rtt,origin:sent-(tick+1)*TICK_MS});
    if (this.clocks.length>8) this.clocks.shift();
    let best=this.clocks.reduce((a,b)=>a.rtt<=b.rtt?a:b);
    const recent=this.clocks.slice(-3);
    if (recent.length===3&&recent.every(sample=>sample.rtt>best.rtt+22)) {
      this.clocks=recent;
      best=recent.reduce((a,b)=>a.rtt<=b.rtt?a:b);
    }
    this.origin=this.origin===null||!this.runner?best.origin:lerp(this.origin,best.origin,.25);
  }

  push(packet,id,now) {
    const tick=packet.simulationTick;
    if (!Number.isSafeInteger(tick)||tick<(this.latest?.tick??0)) return;
    const row=packet.players?.find(player=>player[0]===id);
    if (!row||!Number.isSafeInteger(row[18])) return;
    const [,x,y,vx,vy,face,ground,status,surface,jumpSurface,surfaceFace,iceCarry,coyote,jumpBuffer,previous,inputSequence,,support,inputJumps,ferryDeparture=null]=row;
    if (this.latest?.tick===tick&&this.latest.player.inputSequence>=inputSequence) return;
    const seal=packet.frames?.at(-1)?.[2].find(player=>player[0]===id)?.[8];
    this.latest={tick,player:{x,y,vx,vy,face,ground,status,surface,jumpSurface,surfaceFace,iceCarry,coyote,jumpBuffer,previous,inputSequence,support,inputJumps,ferryDeparture,seal}};
    this.origin??=now-tick*TICK_MS;
  }

  record(bits,sequence,jumps,now) {
    const previous=this.commands.at(-1)?.tick??-Infinity;
    const estimated=this.origin===null?1:Math.floor((now-this.origin)/TICK_MS+1e-6)+1;
    const tick=Math.max(estimated,this.tick+1,previous+1);
    this.commands.push({bits,sequence,jumps,tick});
    if (this.commands.length>64) this.commands.shift();
    return this.origin===null?undefined:tick;
  }

  get previewSeal() {
    const player=this.latest?.player;
    return player?.seal===true||(player?.status==='running'&&this.previewSealTick!==null);
  }

  update(game,player,now,dt) {
    const latest=this.latest;
    if (player?.status!=='running'||!latest) return null;
    if (latest.player.status!=='running') return this.lastPose;
    const wanted=Math.floor((now-this.origin)/TICK_MS+1e-6);
    const target=clamp(wanted,latest.tick,latest.tick+PREDICTION_TICKS);
    // Stepping is continuous between packets. A reconciliation compares both poses at the same tick.
    const tick=Math.max(latest.tick,this.tick,Math.min(target,this.tick+4));
    const fixedSolids=game.placed.some(part=>part.kind==='ferry'||part.kind==='crumble')?null:raceSolids(game,game.elapsed);
    if (this.anchor!==latest) {
      const old=this.runner&&tick-this.tick<=PREDICTION_TICKS?this.advance(game,fixedSolids,tick):null;
      this.anchor=latest;
      this.tick=latest.tick;
      this.runner={...player,...latest.player};
      this.commands=this.commands.filter(command=>command.sequence>this.runner.inputSequence);
      this.advance(game,fixedSolids,tick);
      this.errorX=old?clamp(old.x+this.errorX-this.runner.x,-56,56):0;
      this.errorY=old?clamp(old.y+this.errorY-this.runner.y,-56,56):0;
    } else this.advance(game,fixedSolids,tick);

    const decay=Math.exp(-dt*14);
    const correction=value=>value+clamp(value*(decay-1),-dt*36,dt*36);
    this.errorX=correction(this.errorX);
    const grounded=this.runner.ground;
    this.errorY=grounded&&this.errorY>=-4?0:correction(this.errorY);
    const predictedTime=this.tick*RACE_TICK;
    const predicted={...this.runner,x:this.runner.x+this.errorX,y:this.runner.y+(grounded?Math.min(0,this.errorY):this.errorY)};
    this.projectFerry(game,predicted,predictedTime);
    const weight=predicted.trapContact?0:runnerPredictionWeight(game,player,predicted,predictedTime);
    // Keep the seal hidden while the host is still catching up to a predicted pickup.
    if (this.previewSealTick!==null&&latest.tick>=this.previewSealTick&&predicted.sealContactTick===undefined) {
      this.previewSealTick=null;
    }
    if (!weight) {
      this.lastPose=null;
      return null;
    }
    const {face,vx,vy,ground}=weight>=.5?predicted:player;
    const atExit=predicted.exitContact&&weight===1;
    const pose={x:lerp(player.x,predicted.x,weight),y:lerp(player.y,predicted.y,weight),face,ground,
      vx:atExit?0:vx,vy:atExit?0:vy};
    if (this.previewSealTick===null&&predicted.sealContactTick!==undefined&&runnerContacts(game,{...player,...pose}).seal) {
      this.previewSealTick=predicted.sealContactTick;
    }
    this.lastPose=pose;
    return this.lastPose;
  }

  projectFerry(game,pose,predictedTime) {
    const riding=pose.ground&&pose.surface==='ferry';
    const [support,departure]=riding?[pose.support,predictedTime]:pose.ferryDeparture??[];
    if (!Number.isInteger(support)) return;
    const strength=riding?1:clamp(1-(predictedTime-departure)/DEPARTURE_BLEND,0,1);
    if (!strength) return;
    const visible=ferryPosition(game,support,game.elapsed),simulated=ferryPosition(game,support,predictedTime);
    if (!visible||!simulated) return;
    // Keep feet relative to the drawn deck; shed its offset gradually after takeoff.
    pose.x+=(visible.x-simulated.x)*strength;
    if (riding) {
      pose.x=clamp(pose.x,visible.x-pose.w+.01,visible.x+visible.w-.01);
      pose.y=visible.y-pose.h;
    }
  }

  advance(game,fixedSolids,target) {
    const p=this.runner;
    while (this.tick<target&&!p.exitContact) {
      this.tick++;
      let bits=p.previous,jump=false;
      for (const command of this.commands) {
        if (command.tick>this.tick) break;
        if (command.sequence<=p.inputSequence) continue;
        jump||=command.jumps>p.inputJumps;
        bits=command.bits;
        p.inputSequence=command.sequence;
        p.inputJumps=command.jumps;
      }
      const time=this.tick*RACE_TICK;
      const solids=fixedSolids??raceSolids(game,time);
      advanceRunner(game,p,bits|(jump?8:0),RACE_TICK,time,solids);
      p.trapContact||=runnerTouchesTrap(game,p,time,solids);
      if (!p.trapContact) {
        const contact=runnerContacts(game,p);
        if (contact.seal) p.sealContactTick??=this.tick;
        p.exitContact=contact.exit;
      }
    }
    this.tick=target;
    return p;
  }
}
