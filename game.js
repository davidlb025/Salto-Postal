export const WIDTH = 960;
export const HEIGHT = 450;
export const MAX_ROUNDS = 15;
export const ROUND_LIMIT = 20;
export const RESET_EVERY = 5;
export const MAX_SCORE = 15;
export const SCORE_LIMIT = 50;
export const MOVEMENT_MIN = 65;
export const MOVEMENT_MAX = 150;

export const COURIERS = [
  { name:'Brasa', species:'Zorro', color:'#ffb270', sprite:'fox' },
  { name:'Miga', species:'Coneja', color:'#b7f698', sprite:'rabbit' },
  { name:'Eco', species:'Murciélago', color:'#cab3ff', sprite:'bat' },
  { name:'Brote', species:'Rana', color:'#79e8df', sprite:'frog' },
];
export const ACCESSORIES = { none:'Sin complemento', cap:'Gorra coral', scarf:'Pañuelo turquesa', star:'Insignia dorada' };
export const avatar = player=>COURIERS[player.animal??player.id];
export const defaultProfile = id=>({animal:id,accessory:'none',vote:null,ready:false});
export const PIECES = {
  beam: { name:'Viga', w:96, h:16, type:'Ruta', detail:'Una plataforma estable.' },
  spring: { name:'Muelle', w:48, h:16, type:'Impulso', detail:'Te lanza al pisarlo.' },
  spike: { name:'Púas', w:48, h:16, type:'Trampa', detail:'Eliminan al contacto.' },
  fan: { name:'Rotor', w:32, h:32, type:'Trampa', detail:'Oscila de lado a lado.' },
  piston: { name:'Prensa', w:46, h:25, type:'Trampa', detail:'Avisa con una luz antes de bajar.' },
  emitter: { name:'Emisor', w:32, h:26, type:'Trampa', detail:'Dispara chispas en la dirección indicada.' },
  ferry: { name:'Transbordador', w:75, h:16, type:'Ruta', detail:'Se desplaza de lado a lado y te lleva encima.' },
  crumble: { name:'Frágil', w:80, h:16, type:'Ruta', detail:'Se rompe poco después de pisarla.' },
  ice: { name:'Hielo', w:92, h:16, type:'Ruta', detail:'Conserva el impulso al aterrizar y cuesta frenar.' },
  saw: { name:'Sierra', w:34, h:34, type:'Trampa', detail:'Sube y baja por un riel.' },
  laser: { name:'Rayo', w:31, h:25, type:'Trampa', detail:'Proyecta un rayo periódico en la dirección elegida.' },
  mine: { name:'Mina de pulso', w:31, h:16, type:'Trampa', detail:'Detecta pasos cercanos y detona una vez por carrera.' },
  shock: { name:'Bobina', w:44, h:13, type:'Trampa', detail:'Electrifica el aire sobre sus dos polos.' },
  pendulum: { name:'Péndulo', w:34, h:30, type:'Trampa', detail:'Un macizo contrapeso que se balancea.' },
  shutter: { name:'Púas retráctiles', w:55, h:12, type:'Trampa', detail:'Las púas avisan antes de salir.' },
  belt: { name:'Cinta', w:88, h:17, type:'Ruta', detail:'Te arrastra en la dirección indicada.' },
  gel: { name:'Gel denso', w:72, h:16, type:'Ruta', detail:'Reduce tu velocidad y la altura del salto.' },
  trash: { name:'Papelera', w:36, h:36, type:'Herramienta', detail:'Ponla sobre una trampa para retirarla.' },
};
export const DIRECTIONAL = new Set(['emitter','laser','belt']);
export const DEFAULT_WEIGHTS=Object.freeze({...Object.fromEntries(Object.keys(PIECES).map(kind=>[kind,100])),trash:35});

export function roomRules(rules) {
  const bounded=(value,min,max,fallback)=>Number.isInteger(value)?Math.max(min,Math.min(max,value)):fallback;
  return {
    maxRounds:bounded(rules?.maxRounds,1,ROUND_LIMIT,MAX_ROUNDS),
    resetEvery:bounded(rules?.resetEvery,0,ROUND_LIMIT,RESET_EVERY),
    winPoints:bounded(rules?.winPoints,1,SCORE_LIMIT,MAX_SCORE),
    jump:bounded(rules?.jump,MOVEMENT_MIN,MOVEMENT_MAX,100),
    speed:bounded(rules?.speed,MOVEMENT_MIN,MOVEMENT_MAX,100),
    weights:Object.fromEntries(Object.keys(PIECES).map(kind=>[
      kind,bounded(rules?.weights?.[kind],0,100,DEFAULT_WEIGHTS[kind]),
    ])),
  };
}
const rect = (x,y,w,h) => ({x,y,w,h});
export const ARENAS = [
  { name:'Dársena 07', theme:'dock', description:'Andenes escalonados', ledges:[[236,328,104],[405,282,100],[570,238,111],[710,191,70]], seal:[608,150] },
  { name:'Azotea Iris', theme:'iris', description:'Una bajada antes de coronar', ledges:[[227,299,104],[407,331,111],[581,271,95],[718,205,65]], extra:[[455,399,77],[549,347,34]], seal:[491,365] },
  { name:'Canal Neón', theme:'canal', description:'Saltos largos sobre el canal', ledges:[[250,351,93],[381,288,98],[538,254,79],[672,208,109]], seal:[552,175] },
  { name:'Fundición Ámbar', theme:'amber', description:'Ascenso por las bocas del horno', ledges:[[218,346,78],[347,278,75],[467,220,67],[588,159,78],[708,125,66]], end:[815,100,109], seal:[468,129] },
  { name:'Antenas Boreales', theme:'boreal', description:'Desciende de torre en torre', start:[40,214,152], ledges:[[246,241,60],[371,282,103],[542,310,58],[669,341,87]], end:[815,350,109], extra:[[596,393,66]], seal:[621,366] },
  { name:'Terminal Espejo', theme:'mirror', description:'Pasarelas altas y un desvío inferior', start:[40,340,152], ledges:[[246,281,86],[388,237,88],[536,278,91],[690,245,81]], end:[815,192,109], extra:[[377,343,86],[500,361,80]], seal:[551,334] },
  { name:'Archivo Submarino', theme:'deep', description:'Dos rutas cruzan el dique', start:[40,311,152], ledges:[[223,251,85],[360,168,81],[514,214,86],[658,170,81]], end:[815,168,109], extra:[[350,332,115],[518,298,90],[677,255,80]], seal:[536,277] },
  { name:'Jardín de Bobinas', theme:'garden', description:'Terrazas entre dosel y cables', start:[40,360,152], ledges:[[236,322,85],[381,252,64],[485,273,89],[630,216,99],[757,183,31]], end:[815,151,109], extra:[[449,360,104],[582,304,72]], seal:[531,334] },
  { name:'Vía de Mercurio', theme:'mercury', description:'Carriles cortos con saltos de precisión', start:[40,324,152], ledges:[[241,300,48],[364,236,53],[482,257,51],[606,205,54],[735,251,45]], end:[815,186,109], extra:[[375,338,107],[535,318,81]], seal:[570,290] },
  { name:'Oasis de Cristal', theme:'crystal', description:'Collado alto y descenso en zigzag', start:[40,275,152], ledges:[[227,198,68],[354,169,77],[507,224,83],[668,261,76]], end:[815,305,109], extra:[[546,308,59],[657,339,80]], seal:[687,312] },
  { name:'Cámara Antigravedad', theme:'orbit', description:'Saltos más largos en gravedad baja', gravity:955, start:[40,382,152], ledges:[[235,318,68],[355,250,78],[493,203,75],[620,130,77],[744,99,47]], end:[815,131,109], extra:[[484,296,74],[608,238,62]], seal:[649,211] },
  { name:'Salinas del Ocaso', theme:'salt', description:'Plataformas bajas con un desvío por arriba', start:[40,386,152], ledges:[[250,360,89],[404,362,76],[559,329,91],[713,345,60]], end:[815,289,109], extra:[[344,283,51],[452,238,87],[601,256,64]], seal:[492,210] },
].map(({start=[40,384,152],end=[815,160,109],extra=[],...arena})=>{
  const origin=rect(...start,18);
  const destination=rect(...end,18);
  return {...arena,origin,destination,floor:[origin,...arena.ledges.map(row=>rect(...row,16)),destination,...extra.map(row=>rect(...row,16))],
    exit:rect(destination.x+destination.w-54,destination.y-53,39,53), token:rect(arena.seal[0]-9,arena.seal[1]-9,18,18)};
});

export function editProfile(profile,patch) {
  const next={...profile};
  if (Number.isInteger(patch.animal)&&COURIERS[patch.animal]) next.animal=patch.animal;
  if (typeof patch.accessory==='string'&&Object.hasOwn(ACCESSORIES,patch.accessory)) next.accessory=patch.accessory;
  if (patch.vote===null||(Number.isInteger(patch.vote)&&ARENAS[patch.vote])) next.vote=patch.vote;
  const changed=next.animal!==profile.animal||next.accessory!==profile.accessory||next.vote!==profile.vote;
  if (changed) next.ready=false;
  else if (typeof patch.ready==='boolean') next.ready=patch.ready;
  return next;
}

export function voteResult(ids,profiles,fallback) {
  const counts=new Map();
  for (const id of ids) {
    const vote=profiles[id]?.vote;
    if (Number.isInteger(vote)&&ARENAS[vote]) counts.set(vote,(counts.get(vote)??0)+1);
  }
  const best=Math.max(0,...counts.values());
  if (!best) return fallback;
  const tied=[...counts.keys()].filter(vote=>counts.get(vote)===best);
  return tied.includes(profiles[0]?.vote)?profiles[0].vote:Math.min(...tied);
}
const overlap = (a,b) => a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
const PICK_TIME=13, PLACE_TIME=16, RACE_TIME=30;
const active = game => game.players.filter(p=>p.connected);
const totals = () => ({goal:0,first:0,trap:0,style:0});
const sum = score => Object.values(score).reduce((a,b)=>a+b,0);

function emit(g,sound,source) {
  const event={id:g.event.id+1,sound,x:source && source.x+source.w/2,y:source && source.y+source.h/2, owner:source?.owner ?? source?.id};
  g.event=event;
  g.events=[...g.events.slice(-11),event];
}

function sample(pool,count) {
  const available=[...pool];
  return Array.from({length:count},()=>available.splice(Math.floor(Math.random()*available.length),1)[0]);
}

function weightedSample(pool,count,weights) {
  const available=pool.filter(kind=>weights[kind]>0);
  const chosen=[];
  while (available.length&&chosen.length<count) {
    let roll=Math.random()*available.reduce((total,kind)=>total+weights[kind],0);
    const index=available.findIndex(kind=>(roll-=weights[kind])<0);
    chosen.push(available.splice(index<0?available.length-1:index,1)[0]);
  }
  return chosen;
}

function roundOffer(g) {
  const {weights}=g.rules;
  const routes=Object.keys(PIECES).filter(kind=>PIECES[kind].type==='Ruta');
  const traps=Object.keys(PIECES).filter(kind=>PIECES[kind].type==='Trampa');
  const specials=[];
  if (Math.random()*100<weights.spring) specials.push('spring');
  if ((g.placed.some(part=>traps.includes(part.kind))||traps.some(kind=>weights[kind]>0))&&
    Math.random()*100<weights.trash) specials.push('trash');
  const lot=[
    ...weightedSample(routes,3,weights),
    ...weightedSample(traps,Math.min(4,5-specials.length),weights),
    ...specials,
  ];
  lot.push(...weightedSample([...routes,...traps].filter(kind=>!lot.includes(kind)),8-lot.length,weights));
  return sample(lot,lot.length);
}

export function canVoteReset(g,id) {
  return Array.isArray(g?.resetVotes)&&!g.over&&g.round<(g.rules?.maxRounds??MAX_ROUNDS)&&
    g.players.some(player=>player.id===id&&player.connected);
}

export function voteReset(g,id,vote) {
  if (typeof vote!=='boolean'||!canVoteReset(g,id)||g.resetVotes.includes(id)===vote) return false;
  if (vote) g.resetVotes.push(id);
  else g.resetVotes=g.resetVotes.filter(player=>player!==id);
  return true;
}

export function resetVoteStatus(g) {
  const players=active(g);
  const votes=players.filter(player=>g.resetVotes?.includes(player.id)).length;
  const every=g.rules?.resetEvery??0;
  return {votes,total:players.length,scheduled:every>0&&g.round>0&&g.round%every===0,
    unanimous:players.length>0&&votes===players.length};
}

export function rankPlayers(players) {
  const ranked=players.filter(player=>player.connected).sort((a,b)=>b.points-a.points||a.id-b.id);
  return ranked.map(player=>({id:player.id,rank:ranked.findIndex(other=>other.points===player.points)+1}));
}

export function newGame(ids,arena,profiles={},rules) {
  const g={
    match:crypto.randomUUID?.() ?? String(Date.now()+Math.random()),
    players:ids.map(id=>({id,points:0,gain:0,connected:true,totalScore:totals(),
      animal:profiles[id]?.animal??id,accessory:profiles[id]?.accessory??'none'})), arena,rules:roomRules(rules),
    phase:'draft', round:0, elapsed:0, deadline:0, placed:[], finishedBuilding:{}, previews:{}, finish:[],
    event:{id:0,sound:''}, events:[], result:'',
  };
  nextRound(g);
  return g;
}

function nextRound(g) {
  const reset=resetVoteStatus(g);
  g.objectsReset=g.round>0&&(reset.scheduled||reset.unanimous);
  if (g.objectsReset) g.placed=[];
  g.resetVotes=[];
  g.round++;
  g.phase='draft';
  g.elapsed=0;
  g.deadline=PICK_TIME;
  g.lot=roundOffer(g);
  g.offer=[...g.lot];
  g.picks={};
  g.finishedBuilding={};
  g.previews={};
  g.finish=[];
  g.result='';
  for (const part of g.placed) {
    delete part.collapseAt;
    delete part.armedAt;
  }
  const {origin}=ARENAS[g.arena];
  for (const [i,p] of g.players.entries()) {
    Object.assign(p,{x:origin.x+17+i*31,y:origin.y-30,w:20,h:30,vx:0,vy:0,face:1,ground:true,
      coyote:0,jumpBuffer:0,previous:0,surface:'',jumpSurface:'',surfaceFace:1,iceCarry:0,
      status:p.connected?'ready':'away',gain:0,score:totals(),seal:false});
  }
  if (!g.offer.length) closeDraft(g);
}

function beginCountdown(g) {
  g.previews={};
  g.phase='countdown';
  g.elapsed=0;
  g.deadline=3;
  emit(g,'start');
}

function closeDraft(g) {
  g.phase='build';
  g.elapsed=0;
  g.deadline=PLACE_TIME;
  finishBuildIfReady(g);
}

export function canBuildFor(g,id) {
  return g?.phase==='build'&&!!g.picks[id]&&!Object.hasOwn(g.finishedBuilding,id)&&g.players.some(p=>p.id===id&&p.connected);
}

function finishBuildIfReady(g) {
  if (!g.players.some(p=>canBuildFor(g,p.id))) beginCountdown(g);
}

export function setPreview(g,id,coords) {
  if (!canBuildFor(g,id)) return false;
  if (coords===null) {
    delete g.previews[id];
    return true;
  }
  const {x,y,face}=coords;
  if (!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>WIDTH||y>HEIGHT) return false;
  g.previews[id]={x,y,face:face===-1?-1:1};
  return true;
}

export function canDraft(g,player) {
  return g?.phase==='draft'&&g.players.some(p=>p.id===player&&p.connected)&&!Object.hasOwn(g.picks,player);
}

export function showSeal(g,viewer) {
  return g.phase==='build'||(g.phase==='race'&&g.players.some(p=>(viewer===null?p.status==='running':p.id===viewer)&&!p.seal));
}

export function draft(g,player,kind) {
  if (!canDraft(g,player)||(kind!=='skip'&&!g.offer.includes(kind))) return false;
  g.picks[player]=kind==='skip'?null:kind;
  if (kind!=='skip') {
    g.offer=g.offer.filter(item=>item!==kind);
    emit(g,'pick');
  }
  if (active(g).every(p=>Object.hasOwn(g.picks,p.id))) closeDraft(g);
  return true;
}

export function pieceAt(kind,x,y,owner,face=1) {
  const item=PIECES[kind];
  return {kind,owner,x:x-item.w/2,y:y-item.h/2,w:item.w,h:item.h,face:face===-1?-1:1};
}

function sweep(part) {
  if (part.kind==='ferry') return rect(part.x-30,part.y,part.w+60,part.h);
  if (part.kind==='fan') return rect(part.x-36,part.y,part.w+72,part.h);
  if (part.kind==='piston') return rect(part.x,part.y,part.w,part.h+64);
  if (part.kind==='saw') return rect(part.x,part.y-32,part.w,part.h+64);
  if (part.kind==='pendulum') return rect(part.x-43,part.y,part.w+86,part.h+61);
  if (part.kind==='mine') return rect(part.x-26,part.y-21,part.w+52,part.h+42);
  if (part.kind==='shock'||part.kind==='shutter') return rect(part.x,part.y-23,part.w,part.h+23);
  return part;
}

export function canPlace(g,part) {
  if (part.kind==='trash') return !!trashTarget(g,part);
  const {origin,destination,floor,token}=ARENAS[g.arena];
  const start=rect(origin.x-12,origin.y-80,origin.w+46,108);
  const end=rect(destination.x-15,destination.y-89,destination.w+43,114);
  if (part.x<-12||part.x+part.w>WIDTH-12||part.y<28||part.y+part.h>HEIGHT-22) return false;
  if ([start,end].some(box=>overlap(sweep(part),box))) return false;
  const bounds=part.kind==='ferry'?sweep(part):part;
  const occupied=g.placed.map(box=>box.kind==='ferry'?sweep(box):box);
  return ![token,...floor,...occupied].some(box=>overlap(bounds,box));
}

export function trashTarget(g,paperBin) {
  let target=null,closest=Infinity;
  const x=paperBin.x+paperBin.w/2, y=paperBin.y+paperBin.h/2;
  for (const trap of g.placed) {
    if (PIECES[trap.kind]?.type!=='Trampa'||!overlap(trap,paperBin)) continue;
    const distance=Math.hypot(x-trap.x-trap.w/2,y-trap.y-trap.h/2);
    if (distance<closest) {
      target=trap;
      closest=distance;
    }
  }
  return target;
}

export function build(g,player,kind,x,y,face) {
  if (!canBuildFor(g,player)) return false;
  if (kind!=='skip') {
    if (g.picks[player]!==kind||!Number.isFinite(x)||!Number.isFinite(y)) return false;
    const piece=pieceAt(kind,x,y,player,face);
    if (kind==='trash') {
      const target=trashTarget(g,piece);
      if (!target) return false;
      g.placed.splice(g.placed.indexOf(target),1);
      emit(g,'scrap',piece);
    } else {
      if (!canPlace(g,piece)) return false;
      g.placed.push(piece);
      emit(g,'place',piece);
    }
  }
  g.finishedBuilding[player]=kind!=='skip';
  delete g.previews[player];
  finishBuildIfReady(g);
  return true;
}

export function partPosition(part,time) {
  if (part.kind==='fan'||part.kind==='ferry') {
    const distance=part.kind==='fan'?36:30;
    return {...part,x:part.x+Math.sin(time*(part.kind==='fan'?2.5:1.8))*distance};
  }
  if (part.kind==='piston') {
    const cycle=time%2.9;
    const reach=cycle<1.6?0:Math.min(1,(cycle-1.6)*11,(2.9-cycle)*4)*64;
    return {...part,y:part.y+reach,reach,warning:cycle>1.14&&cycle<1.6};
  }
  if (part.kind==='saw') return {...part,y:part.y+Math.sin(time*3.1)*32,railY:part.y};
  if (part.kind==='pendulum') {
    const angle=Math.sin(time*2.25)*.88;
    return {...part,x:part.x+Math.sin(angle)*53,y:part.y+Math.cos(angle)*53,anchorX:part.x+part.w/2,anchorY:part.y};
  }
  return part;
}

export function sparkPosition(part,time,solids) {
  const cycle=time%2.15;
  const face=part.face;
  const x=part.x+part.w/2+face*(20+(cycle-.76)*355);
  const mouth=part.x+part.w/2+face*18;
  const y=part.y+part.h/2-5;
  if (cycle<.76||cycle>1.83||x<3||x>WIDTH-9) return null;
  const lane=rect(Math.min(x,mouth),y,Math.abs(x-mouth)+8,10);
  if (solids.some(box=>overlap(lane,box))) return null;
  return {...rect(x-6,y,12,10),kind:'spark',owner:part.owner,face};
}

function beamPosition(part,time,solids) {
  const cycle=time%2.8;
  if (cycle<1.12||cycle>2.11) return null;
  const {face,owner}=part;
  const origin=face===1?part.x+part.w:part.x;
  const y=part.y+part.h*.42;
  let length=175;
  for (const box of solids) {
    if (y+7<box.y||y>box.y+box.h) continue;
    const distance=face===1?box.x-origin:origin-box.x-box.w;
    if (distance>=0) length=Math.min(length,distance);
  }
  if (length<=0) return null;
  return {...rect(face===1?origin:origin-length,y,length,7),kind:'ray',owner};
}

function trapParts(part,time,solids) {
  const body=partPosition(part,time);
  if (part.kind==='emitter'||part.kind==='laser') {
    const shot=part.kind==='emitter'?sparkPosition(part,time,solids):beamPosition(part,time,solids);
    return {hazards:shot?[shot]:[],props:[body]};
  }
  if (part.kind==='mine') {
    const age=time-(part.armedAt??Infinity);
    const blast={...sweep(part),kind:'blast',owner:part.owner};
    return {hazards:age>=.52&&age<.84?[blast]:[],props:age<.84?[{...body,warning:age>=0}]:[]};
  }
  if (part.kind==='shock'||part.kind==='shutter') {
    const cycle=(time+part.x*.001)%2.65;
    const height=part.kind==='shock'?22:17;
    const hazard={...rect(part.x,part.y-height,part.w,height+3),kind:part.kind==='shock'?'arc':'teeth',owner:part.owner};
    return {hazards:cycle>1.29&&cycle<2.10?[hazard]:[],props:[{...body,warning:cycle>.89&&cycle<=1.29}]};
  }
  return {hazards:[body],props:[]};
}

export function raceGeometry(g,time) {
  const placed=g.placed.filter(p=>p.collapseAt===undefined||time<p.collapseAt);
  const supports=placed.filter(p=>PIECES[p.kind].type!=='Trampa');
  const solids=[...ARENAS[g.arena].floor,...supports.map(p=>partPosition(p,time))];
  const traps=placed.filter(p=>PIECES[p.kind].type==='Trampa').map(part=>trapParts(part,time,solids));
  return {solids,hazards:traps.flatMap(trap=>trap.hazards),props:traps.flatMap(trap=>trap.props)};
}

export function disconnect(g,id) {
  const p=g.players.find(player=>player.id===id);
  if (!p) return;
  p.connected=false;
  p.status='away';
  if (g.phase!=='result') p.score=totals();
  if (g.phase==='draft'&&active(g).every(player=>Object.hasOwn(g.picks,player.id))) closeDraft(g);
  if (g.phase==='build') {
    delete g.previews[id];
    finishBuildIfReady(g);
  }
}

function tally(g) {
  const current=active(g);
  const finish=g.finish.filter(id=>current.some(p=>p.id===id));
  const contested=finish.length<current.length;
  for (const p of current) {
    if (finish.includes(p.id)) {
      p.score.goal=contested?3:0;
      p.score.first=Number(finish[0]===p.id);
      p.score.style=Number(p.seal);
    }
    p.gain=sum(p.score);
    p.points+=p.gain;
    for (const key of Object.keys(p.score)) p.totalScore[key]+=p.score[key];
  }
  g.phase='result';
  g.elapsed=0;
  const best=Math.max(0,...current.map(p=>p.points));
  const winners=current.filter(p=>p.points===best).map(p=>'P'+(p.id+1)+' '+avatar(p).name);
  g.over=g.round>=(g.rules?.maxRounds??MAX_ROUNDS)||best>=(g.rules?.winPoints??MAX_SCORE);
  if (g.over) g.standings=rankPlayers(current);
  g.deadline=g.over?0:6;
  g.result=g.over
    ? (winners.length===1?'Gana '+winners[0]:'Empate · '+winners.join(' / '))
    : finish.length===0?'Nadie entregó'
      : finish.length===current.length?'Todos entregaron':'Primero en llegar: P'+(finish[0]+1)+' '+avatar(g.players.find(p=>p.id===finish[0])).name;
  emit(g,g.over?'podium':finish.length?'finish':'fail');
}

function move(g,p,input,dt,solids,hazards) {
  const steer=Number(Boolean(input&2))-Number(Boolean(input&1));
  if (steer) p.face=steer;
  const target=steer*(p.surface==='gel'?112:255)*(g.rules?.speed??100)/100;
  const onIce=p.surface==='ice';
  const carryingIce=onIce&&p.iceCarry>0;
  const grip=carryingIce?(steer?420:100):(steer?1250:240);
  const acceleration=(onIce?grip:p.ground?(steer?3150:4200):(steer?2250:2800))*dt;
  p.iceCarry=onIce?Math.max(0,p.iceCarry-dt):0;
  p.vx+=Math.max(-acceleration,Math.min(acceleration,target-p.vx));
  const carrying=p.ground&&g.placed.find(part=>{
    if (part.kind!=='ferry') return false;
    const before=partPosition(part,g.elapsed-dt);
    return Math.abs(p.y+p.h-before.y)<.1&&p.x+p.w>before.x&&p.x<before.x+before.w;
  });
  const ride=carrying?partPosition(carrying,g.elapsed).x-partPosition(carrying,g.elapsed-dt).x:0;
  p.coyote=p.ground?.105:Math.max(0,p.coyote-dt);
  const jumpPressed=(input&8)||((input&4)&&!(p.previous&4));
  p.jumpBuffer=jumpPressed?.12:Math.max(0,p.jumpBuffer-dt);
  p.previous=input&7;
  if (p.coyote&&p.jumpBuffer) {
    p.vy=-495*(g.rules?.jump??100)/100*(p.jumpSurface==='gel'?.72:1);
    p.ground=false;
    p.coyote=0;
    p.jumpBuffer=0;
    emit(g,'jump',p);
  }
  const dx=(p.vx+(p.surface==='belt'?p.surfaceFace*103:0))*dt+ride;
  p.x=Math.max(-p.w/2,Math.min(WIDTH-p.w,p.x+dx));
  for (const box of solids) {
    if (!overlap(p,box)) continue;
    if (dx>0) p.x=box.x-p.w;
    if (dx<0) p.x=box.x+box.w;
    p.vx=0;
  }
  const map=ARENAS[g.arena];
  p.vy=Math.min(660,p.vy+(map.gravity??1090)*dt);
  p.y+=p.vy*dt;
  p.ground=false;
  p.surface='';
  for (const box of solids) {
    if (!overlap(p,box)) continue;
    if (p.vy>0) {
      p.y=box.y-p.h;
      if (box.kind==='spring') {
        p.vy=-715;
        emit(g,'spring',p);
        break;
      }
      if (box.kind==='crumble'&&box.collapseAt===undefined) {
        box.collapseAt=g.elapsed+.58;
        emit(g,'crack',box);
      }
      p.ground=true;
      p.surface=box.kind??'';
      p.jumpSurface=p.surface;
      if (p.surface==='ice'&&!onIce&&Math.abs(p.vx)>1) p.iceCarry=.13;
      p.surfaceFace=box.face??1;
    } else if (p.vy<0) p.y=box.y+box.h;
    p.vy=0;
  }
  const hit=hazards.find(box=>overlap({...p,x:p.x+2,y:p.y+3,w:p.w-4,h:p.h-4},box));
  if (hit||p.y>HEIGHT+40) {
    p.status='out';
    const owner=hit&&g.players.find(other=>other.id===hit.owner&&other.id!==p.id&&other.connected);
    if (owner) owner.score.trap++;
    emit(g,'hit',p);
    return;
  }
  if (!p.seal&&overlap(p,map.token)) {
    p.seal=true;
    emit(g,'seal',p);
  }
  if (overlap(p,map.exit)) {
    p.status='done';
    g.finish.push(p.id);
    emit(g,'finish',p);
  }
}

export function step(g,inputs,dt) {
  if (g.over) return;
  g.elapsed+=dt;
  if (g.phase==='draft'&&g.elapsed>=g.deadline) closeDraft(g);
  else if (g.phase==='build'&&g.elapsed>=g.deadline) beginCountdown(g);
  else if (g.phase==='countdown'&&g.elapsed>=g.deadline) {
    g.phase='race';
    g.elapsed=0;
    g.deadline=RACE_TIME;
    for (const p of active(g)) p.status='running';
    emit(g,'go');
  } else if (g.phase==='race') {
    for (const part of g.placed) {
      if (part.kind==='mine'&&part.armedAt===undefined&&g.players.some(p=>p.status==='running'&&overlap(p,sweep(part)))) {
        part.armedAt=g.elapsed;
        emit(g,'arm',part);
      }
    }
    const {solids,hazards}=raceGeometry(g,g.elapsed);
    for (const p of active(g)) if (p.status==='running') move(g,p,inputs[p.id]||0,dt,solids,hazards);
    if (g.elapsed>=g.deadline||active(g).every(p=>p.status!=='running')) {
      for (const p of active(g)) if (p.status==='running') p.status='out';
      tally(g);
    }
  } else if (g.phase==='result'&&g.elapsed>=g.deadline) nextRound(g);
}
