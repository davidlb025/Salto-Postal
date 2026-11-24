import { ARENAS, COURIERS, avatar, DIRECTIONAL, WIDTH, HEIGHT, raceGeometry, raceSolids, showSeal, gameArena, placementGuide, placementBody } from './game.js?v=24';
import { drawProp } from './props.js?v=11';

const images=Object.fromEntries([
  'port','door','seal','spark','parcel','beam','spring','spike','fan','piston','emitter','ferry','crumble','ice','trash',...COURIERS.map(p=>p.sprite),
].map(name=>{
  const img=new Image();
  img.src='./assets/'+name+(name==='port'?'.webp':'.png');
  return [name,img];
}));
const themes={
  dock:['#292242','#c26569','#ffaf83','#ffd19c','#78566a'],
  iris:['#292145','#775393','#d18db1','#ffc2d0','#615480'],
  canal:['#122e46','#326477','#66a8a0','#b5dfaa','#487879'],
  amber:['#3b2028','#a74a38','#f99352','#ffc96d','#9b5d44'],
  boreal:['#1b2152','#4d5298','#6db3af','#bdf5dc','#514d94'],
  mirror:['#372342','#a3537e','#e596a3','#ffdabc','#a75986'],
  deep:['#10223d','#245f80','#319eab','#8edccd','#33648a'],
  garden:['#142938','#366756','#a2a65e','#dbe19a','#669674'],
  mercury:['#151d3d','#434573','#ac7795','#f3a783','#a87d9a'],
  crystal:['#32234d','#624784','#b38ac1','#efdee5','#bfabdd'],
  orbit:['#14192f','#252c58','#576294','#e1c9f8','#7574a7'],
  salt:['#462c39','#ba6f64','#eaaa78','#ffe3b0','#d59b81'],
};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const skies=new Map();
const portLayers=new Map();
const effects=[];
let visualRound, visualEvent=0;

function image(ctx,key,x,y,w,h) {
  if (drawProp(ctx,key,x,y,w,h)) return;
  const img=images[key];
  if (img?.complete&&img.naturalWidth) ctx.drawImage(img,Math.round(x),Math.round(y),Math.round(w),Math.round(h));
}

function flipped(ctx,key,box) {
  if (box.face!==-1) {
    image(ctx,key,box.x,box.y,box.w,box.h);
    return;
  }
  ctx.save();
  ctx.translate(box.x+box.w,box.y);
  ctx.scale(-1,1);
  image(ctx,key,0,0,box.w,box.h);
  ctx.restore();
}

function skyFor(theme) {
  if (skies.has(theme)) return skies.get(theme);
  const canvas=document.createElement('canvas');
  canvas.width=320;
  canvas.height=150;
  const ctx=canvas.getContext('2d');
  const [dark,mid,light,sun]=themes[theme];
  const gradient=ctx.createLinearGradient(0,0,0,150);
  gradient.addColorStop(0,dark);
  gradient.addColorStop(.68,mid);
  gradient.addColorStop(1,light);
  ctx.fillStyle=gradient;
  ctx.fillRect(0,0,320,150);
  ctx.fillStyle=sun;
  const center=theme==='amber'?168:theme==='mirror'?180:246;
  for (let dy=-24;dy<=24;dy++) {
    const span=Math.floor(Math.sqrt(24*24-dy*dy));
    if (dy<7||dy%5!==2) ctx.fillRect(center-span,54+dy,span*2+1,1);
    if (theme==='mirror'&&dy<17) ctx.fillRect(305-span/2,59+dy/2,span+1,1);
  }
  scenery(ctx,theme,sun,dark);
  ctx.fillStyle=dark+'65';
  for (let i=0;i<33;i++) {
    const h=9+(i*23)%34;
    ctx.fillRect(i*10,143-h,8,h+7);
    if (i%3===0) ctx.fillRect(i*10+3,137-h,1,6);
  }
  skies.set(theme,canvas);
  return canvas;
}

function scenery(ctx,theme,light,dark) {
  ctx.fillStyle=light+'60';
  if (theme==='orbit') {
    ctx.fillRect(213,57,85,2);
    ctx.fillRect(202,60,91,1);
    for (let i=0;i<60;i++) ctx.fillRect((i*123+18)%320,(i*83+28)%135,1,i%11===0?2:1);
  }
  if (theme==='salt'||theme==='mercury') {
    for (let i=0;i<16;i++) {
      const y=114+i*2;
      ctx.fillRect(i*67%320,y,14+i*4,1);
    }
  }
  for (let i=0;i<11;i++) {
    const x=(i*73+29)%320,y=100+(i*19)%45,h=8+(i*29)%37;
    if (theme==='garden') {
      ctx.fillStyle=dark+'80';
      ctx.fillRect(x,y-h,2,h+16);
      ctx.fillStyle=light+'38';
      ctx.fillRect(x-10,y-h-4,22,3);
      ctx.fillRect(x-7,y-h-8,15,4);
    }
    if (theme==='crystal') {
      for (let j=0;j<h;j++) {
        const span=Math.min(6,Math.floor(j/2));
        ctx.fillStyle=j%4===0?light+'66':dark+'56';
        ctx.fillRect(x-span,y-h+j,2*span+1,1);
      }
    }
  }
}

function portLayer(theme) {
  const art=images.port;
  if (!art.complete||!art.naturalWidth) return null;
  const filter=theme==='dock'?'none':theme==='amber'||theme==='salt'?'sepia(.65)':
    ['boreal','deep','orbit'].includes(theme)?'hue-rotate(326deg) saturate(.8)':
      theme==='garden'?'hue-rotate(68deg) saturate(.64)':'saturate(.7)';
  if (!portLayers.has(filter)) {
    const layer=document.createElement('canvas');
    layer.width=art.naturalWidth;
    layer.height=art.naturalHeight;
    const ctx=layer.getContext('2d');
    ctx.filter=filter;
    ctx.drawImage(art,0,0);
    portLayers.set(filter,layer);
  }
  return portLayers.get(filter);
}

function world(ctx,theme,t) {
  const [dark,,,sun,accent]=themes[theme];
  ctx.drawImage(skyFor(theme),0,0,WIDTH,HEIGHT);
  ctx.fillStyle=sun+'79';
  for (let i=0;i<32;i++) {
    const speed=theme==='deep'?5:theme==='amber'?18:10;
    const x=(i*127+37+(theme==='deep'?0:t*speed))%WIDTH;
    const y=(i*77+17+(theme==='deep'?HEIGHT-(t*speed)%HEIGHT:0))%HEIGHT;
    ctx.fillRect(x,y,i%3===0?7:2,2);
  }
  if (theme==='boreal'||theme==='deep'||theme==='canal') {
    ctx.fillStyle=sun+'24';
    for (let i=0;i<8;i++) {
      const y=theme==='boreal'?48+i*6:355+i*6;
      ctx.fillRect((i*141+t*9)%WIDTH-100,y,100+i*12,2);
    }
  }
  const port=portLayer(theme);
  if (port) ctx.drawImage(port,0,-63,WIDTH,570);
  const shade=ctx.createLinearGradient(0,344,0,450);
  shade.addColorStop(0,dark+'00');
  shade.addColorStop(1,'#101423');
  ctx.fillStyle=shade;
  ctx.fillRect(0,344,WIDTH,106);
  ctx.fillStyle=accent;
  for (let x=6;x<WIDTH;x+=25) ctx.fillRect(x,438,8,2);
}

function platform(ctx,box,theme) {
  ctx.fillStyle='#111727';
  ctx.fillRect(box.x-3,box.y+4,box.w+6,box.h+3);
  ctx.fillStyle='#294657';
  ctx.fillRect(box.x,box.y,box.w,box.h);
  for (let i=0;i<box.w;i+=32) image(ctx,'beam',box.x+i,box.y,Math.min(32,box.w-i),box.h+1);
  ctx.fillStyle=themes[theme][3];
  ctx.fillRect(box.x,box.y,box.w,2);
}

function sign(ctx,text,x,y,color) {
  ctx.font='bold 10px monospace';
  const w=ctx.measureText(text).width+14;
  ctx.fillStyle='#171a2b';
  ctx.fillRect(x,y,w,17);
  ctx.fillStyle=color;
  ctx.fillRect(x,y,2,17);
  ctx.fillText(text,x+7,y+12);
}

const rigs={
  fox:{size:[23,26],legs:[19,13],head:[13,5],eyes:[15,8],chest:[15,15]},
  rabbit:{size:[15,26],legs:[20,8],head:[8,7],eyes:[9,10],chest:[8,15]},
  bat:{size:[23,22],legs:[17,12],head:[13,6],eyes:[15,9],chest:[14,14]},
  frog:{size:[19,21],legs:[16,10],head:[9,3],eyes:[11,7],chest:[12,13]},
  hedgehog:{size:[30,35],legs:[29,20],head:[17,7],eyes:[20,14],chest:[19,24]},
  duck:{size:[28,38],legs:[30,14],head:[16,5],eyes:[17,12],chest:[17,22]},
  raccoon:{size:[35,37],legs:[30,23],head:[22,7],eyes:[25,12],chest:[24,24]},
  capybara:{size:[28,37],legs:[30,14],head:[15,5],eyes:[14,8],chest:[14,21]},
};

function drawOutfit(ctx,gear,sprite,x,y,w,h,scale) {
  if (!gear||gear==='none') return;
  const rig=rigs[sprite];
  const [iw,ih]=rig.size;
  const anchor=['cap','crown','beret'].includes(gear)?rig.head:gear==='goggles'?rig.eyes:rig.chest;
  ctx.save();
  ctx.translate(Math.round(x+anchor[0]*w/iw),Math.round(y+anchor[1]*h/ih));
  ctx.scale(scale,scale);
  const fill=(color,left,top,w,h)=>{
    ctx.fillStyle=color;
    ctx.fillRect(left,top,w,h);
  };
  if (gear==='cap') {
    fill('#222239',-9,-5,15,8);
    fill('#222239',-4,1,16,4);
    fill('#ee745e',-8,-4,13,6);
    fill('#ffac7d',-6,-4,8,2);
    fill('#ef935f',4,1,7,2);
    fill('#fff2bc',-1,-2,3,2);
  } else if (gear==='scarf') {
    fill('#182b3c',-10,0,19,5);
    fill('#65dec7',-9,-1,17,3);
    fill('#3a9e9f',-12,2,5,6);
    fill('#b8f7d6',-8,-1,4,1);
  } else if (gear==='star') {
    fill('#372633',-3,-4,7,9);
    fill('#372633',-5,-2,11,5);
    fill('#e3a84e',-4,-1,9,3);
    fill('#ffed9a',-1,-3,3,7);
    fill('#fff5ba',-1,-1,2,2);
  } else if (gear==='goggles') {
    fill('#372b35',-11,-2,21,4);
    fill('#372b35',-7,-4,9,8);
    fill('#372b35',3,-4,8,8);
    fill('#bb7756',-6,-3,7,6);
    fill('#bb7756',4,-3,6,6);
    fill('#6cbdcd',-5,-2,5,4);
    fill('#6cbdcd',5,-2,4,4);
    fill('#dbf9ea',-5,-2,3,1);
    fill('#dbf9ea',5,-2,2,1);
  } else if (gear==='crown') {
    fill('#43303e',-9,-7,18,10);
    fill('#efa548',-8,-2,16,4);
    for (const tip of [-7,-2,3]) fill('#ffe084',tip,tip===-2?-7:-5,4,5);
    fill('#f47463',-1,0,2,2);
  } else if (gear==='beret') {
    fill('#27243c',-10,-4,20,7);
    fill('#27243c',-7,-6,15,3);
    fill('#8a65c3',-9,-3,18,4);
    fill('#be9bea',-6,-5,13,3);
    fill('#edc5e8',0,-8,2,3);
  } else if (gear==='bow') {
    fill('#342537',-8,-3,17,8);
    fill('#df596c',-7,-2,6,6);
    fill('#df596c',2,-2,6,6);
    fill('#ff9e91',-2,0,5,3);
  } else if (gear==='satchel') {
    fill('#422c2a',-4,-6,3,5);
    fill('#422c2a',-1,-3,3,5);
    fill('#422c2a',1,0,10,10);
    fill('#ce8050',2,1,8,8);
    fill('#f7b777',2,1,8,4);
    fill('#fff2ab',5,4,2,2);
  }
  ctx.restore();
}

export function drawPortraitOutfit(ctx,gear,sprite) {
  const [iw,ih]=rigs[sprite].size;
  const scale=24/Math.max(iw,ih);
  const w=iw*scale, h=ih*scale;
  drawOutfit(ctx,gear,sprite,(28-w)/2,(28-h)/2,w,h,.65);
}

function pose(ctx,sprite,width,run,stride,rising) {
  const img=images[sprite];
  if (!img.complete||!img.naturalHeight) return;
  if (reduced.matches||(!run&&rising===null)) {
    image(ctx,sprite,-width/2,-38,width,38);
    return;
  }
  const [hip,mid]=rigs[sprite].legs;
  const ih=img.naturalHeight, iw=img.naturalWidth;
  const bodyHeight=Math.round(38*hip/ih);
  const knee=-38+bodyHeight;
  const hips=[0,mid,iw];
  for (let i=0;i<2;i++) {
    const left=hips[i], span=hips[i+1]-left;
    const kick=run?stride*(i===0?1:-1):i===0?(rising?-.46:-.12):(rising?.34:.48);
    ctx.save();
    ctx.translate(Math.round(width*left/iw-width/2),knee);
    ctx.rotate(kick*.29);
    ctx.drawImage(img,left,hip,span,ih-hip,Math.round(kick*5),-Math.max(0,Math.round(kick*4)),
      Math.ceil(width*span/iw),38-bodyHeight);
    ctx.restore();
  }
  ctx.drawImage(img,0,0,iw,hip+1,Math.round(-width/2),-38,width,bodyHeight+2);
}

function figure(ctx,p,t,racing=false) {
  if (p.status==='out'||p.status==='away') return;
  const courier=avatar(p);
  const run=p.ground&&Math.abs(p.vx)>25;
  const cadence=7+Math.abs(p.vx||0)*.031;
  const stride=run?Math.sin(Math.floor(t*cadence*2)*.92+p.id):0;
  const breath=.025*Math.sin(t*4+p.id);
  const tilt=p.ground?stride*.12:Math.max(-.16,Math.min(.16,p.vy/1700));
  const squash=p.ground?breath-Math.abs(stride)*.08:p.vy<0?.12:-.04;
  ctx.save();
  const x=p.x+p.w/2,y=p.y+p.h;
  ctx.translate(racing?x:Math.round(x),racing?y:Math.round(y));
  if (p.ground) {
    ctx.fillStyle='#131929aa';
    ctx.fillRect(-13,0,26,3);
  }
  ctx.scale(p.face||1,1);
  if (!reduced.matches) {
    ctx.rotate(tilt);
    ctx.scale(1-squash*.6,1+squash);
  }
  ctx.globalAlpha=p.status==='done'?.68:1;
  const img=images[courier.sprite];
  const w=img.naturalHeight?Math.min(37,37*img.naturalWidth/img.naturalHeight):36;
  pose(ctx,courier.sprite,w,run,stride,p.ground?null:p.vy<0);
  drawOutfit(ctx,p.accessory,courier.sprite,-w/2,-38,w,38,.78);
  ctx.restore();
  ctx.fillStyle=COURIERS[p.id].color;
  ctx.font='bold 10px monospace';
  ctx.textAlign='center';
  ctx.fillText('P'+(p.id+1),p.x+p.w/2,p.y-13);
  ctx.textAlign='left';
}

function machine(ctx,box,t,elapsed) {
  const {kind,x,y,w,h}=box;
  if (kind==='ray'||kind==='arc'||kind==='teeth'||kind==='blast') {
    hazardEffect(ctx,box,t);
    return;
  }
  if (kind==='saw'&&box.railY!==undefined) {
    ctx.fillStyle='#252b41';
    ctx.fillRect(x+w/2-2,box.railY-26,4,h+52);
    ctx.fillStyle='#a38763';
    ctx.fillRect(x+w/2,box.railY-26,1,h+52);
  }
  if (kind==='pendulum'&&box.anchorY!==undefined) {
    ctx.strokeStyle='#2e263a';
    ctx.lineWidth=4;
    ctx.beginPath();
    ctx.moveTo(box.anchorX,box.anchorY);
    ctx.lineTo(x+w/2,y+4);
    ctx.stroke();
    ctx.fillStyle='#dfaa61';
    ctx.fillRect(box.anchorX-3,box.anchorY-3,6,6);
  }
  if (kind==='fan'||kind==='saw') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x,y,w,h);
    ctx.clip();
    ctx.translate(x+w/2,y+h/2);
    ctx.rotate(t*5);
    image(ctx,kind,-w/2,-h/2,w,h);
    ctx.restore();
  } else if (kind==='piston') {
    if (box.reach>0) {
      ctx.fillStyle='#233049';
      ctx.fillRect(x+w*.36,y-box.reach,w*.28,box.reach+3);
      ctx.fillStyle='#f7946e';
      ctx.fillRect(x+w*.42,y-box.reach,w*.10,box.reach);
    }
    image(ctx,kind,x,y,w,h);
    if (box.warning) {
      ctx.fillStyle='#fff5ad';
      ctx.fillRect(x+w/2-4,y-5,8,3);
    }
  } else {
    const shake=kind==='crumble'&&elapsed>=box.collapseAt-.58&&!reduced.matches?Math.sin(t*72)*2:0;
    flipped(ctx,kind,{...box,x:x+shake});
    if (kind==='emitter') {
      ctx.fillStyle=elapsed%2.15>.39&&elapsed%2.15<.76?'#f7b6ff':'#957adb';
      ctx.fillRect(x+(box.face===-1?2:w-6),y+h*.40,4,3);
    }
    if (box.warning||(kind==='laser'&&elapsed%2.8>.65&&elapsed%2.8<1.12)) {
      ctx.fillStyle=Math.floor(t*8)%2?'#ffeab0':'#f99263';
      ctx.fillRect(x+w/2-4,y+3,8,3);
    }
    if (kind==='belt') {
      ctx.fillStyle='#e3ef9d';
      const drift=(t*32)%13;
      for (let i=0;i<w-15;i+=13) ctx.fillRect(x+i+(box.face===-1?13-drift:drift),y+5,4,2);
    }
    if (kind==='ferry'&&!reduced.matches) {
      ctx.fillStyle='#87e8d0';
      ctx.fillRect(x+12,y+h+(t*30)%5,3,3);
      ctx.fillRect(x+w-17,y+h+(t*30+2)%5,3,3);
    }
  }
  if (box.owner!==undefined&&kind!=='spark') {
    ctx.fillStyle=COURIERS[box.owner].color;
    ctx.fillRect(x+2,y+h-2,5,2);
  }
}

function hazardEffect(ctx,{kind,x,y,w,h},time) {
  ctx.save();
  if (kind==='ray') {
    ctx.fillStyle='#fa654b88';
    ctx.fillRect(x,y-2,w,h+4);
    ctx.fillStyle='#ffdfa1';
    ctx.fillRect(x,y+2,w,h-3);
  } else if (kind==='arc') {
    ctx.strokeStyle='#bdf8f7';
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(x,y+h);
    for (let i=1;i<7;i++) ctx.lineTo(x+w*i/7,y+Math.abs(Math.sin(i*2.7+time*15))*h*.72);
    ctx.lineTo(x+w,y+h);
    ctx.stroke();
  } else if (kind==='teeth') {
    ctx.fillStyle='#f49d71';
    for (let i=0;i<4;i++) {
      const tooth=w/4;
      ctx.beginPath();
      ctx.moveTo(x+i*tooth,y+h);
      ctx.lineTo(x+i*tooth+tooth/2,y);
      ctx.lineTo(x+(i+1)*tooth,y+h);
      ctx.fill();
    }
  } else {
    ctx.fillStyle='#f99e6380';
    ctx.fillRect(x,y,w,h);
    ctx.strokeStyle='#ffe8ad';
    ctx.lineWidth=3;
    ctx.strokeRect(x+3,y+3,w-6,h-6);
  }
  ctx.restore();
}

function bursts(ctx,g,now) {
  const round=g&&g.match+'/'+g.round;
  if (visualRound!==round) {
    visualRound=round;
    visualEvent=(g?.event.id??1)-1;
    effects.length=0;
  }
  if (!g) return;
  const colors={seal:'#ffd474',finish:'#9bffad',hit:'#ffa076',spring:'#96ffc9',place:'#e8eef9',crack:'#ffb66d',jump:'#c9c8ed'};
  for (const ev of g.events) {
    if (ev.id<=visualEvent) continue;
    visualEvent=ev.id;
    if (Number.isFinite(ev.x)&&colors[ev.sound]) effects.push({...ev, at:now,color:colors[ev.sound]});
  }
  while (effects.length&&now-effects[0].at>.55) effects.shift();
  for (const ev of effects) {
    const dt=now-ev.at;
    const count=reduced.matches?3:ev.sound==='jump'?5:12;
    ctx.globalAlpha=Math.max(0,1-dt/.55);
    ctx.fillStyle=ev.color;
    for (let i=0;i<count;i++) {
      const a=i*2.396;
      const speed=21+i*5;
      ctx.fillRect(ev.x+Math.cos(a)*dt*speed,ev.y+Math.sin(a)*dt*speed+dt*dt*70,2+i%3,2+i%3);
    }
    if (ev.sound==='finish') image(ctx,'parcel',ev.x-8,ev.y-28-dt*39,17,17);
  }
  ctx.globalAlpha=1;
}

export function paintBackdrop(ctx,arenaIndex,width,height,time,map=ARENAS[arenaIndex]) {
  const ratio=Math.max(width/WIDTH,height/HEIGHT);
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  ctx.translate((width-WIDTH*ratio)/2,(height-HEIGHT*ratio)/2);
  ctx.scale(ratio,ratio);
  world(ctx,map.theme,reduced.matches?0:time);
  ctx.restore();
}

function paintToken(ctx,map,t) {
  const {x,y}=map.token;
  image(ctx,'seal',x-2,y-1+Math.sin(t*4)*3,22,22);
}

export function paintArena(ctx,map,t=0,drawWorld=true,showToken=false) {
  ctx.imageSmoothingEnabled=false;
  if (drawWorld) world(ctx,map.theme,t);
  for (const box of map.floor) platform(ctx,box,map.theme);
  const door=map.exit;
  ctx.fillStyle='#9fffb148';
  ctx.fillRect(door.x-6,door.y-6,door.w+12,door.h+6);
  image(ctx,'door',door.x-4,door.y-1,door.w+8,door.h+1);
  ctx.fillStyle='#a6ffb0';
  ctx.globalAlpha=.30+.15*Math.sin(t*3);
  ctx.fillRect(door.x+2,door.y+4+(t*23)%41,door.w-4,2);
  ctx.globalAlpha=1;
  sign(ctx,'ENTREGA',door.x-7,door.y-23,'#b7f698');
  sign(ctx,'SALIDA',map.origin.x+4,map.origin.y+19,'#ffbc83');
  if (showToken) paintToken(ctx,map,t);
}

export function paint(ctx,g,arenaIndex,previews,time,viewer=null,drawWorld=true,map=g?gameArena(g):ARENAS[arenaIndex]) {
  const t=reduced.matches?0:time;
  const raceTime=reduced.matches?0:g?.elapsed;
  paintArena(ctx,map,t,drawWorld,!g&&map!==ARENAS[arenaIndex]);

  if (g) {
    if (g.phase==='race') {
      const {solids,hazards,props}=raceGeometry(g,g.elapsed);
      for (const box of [...solids,...props,...hazards]) if (box.kind) machine(ctx,box,raceTime,g.elapsed);
    } else {
      for (const part of g.placed) {
        if (g.phase!=='result'||part.collapseAt===undefined) machine(ctx,part,t,0);
      }
    }
    if (showSeal(g,viewer)) paintToken(ctx,map,t);
    const racing=g.phase==='race';
    for (const p of g.players) figure(ctx,p,racing?raceTime:t,racing);
    bursts(ctx,g,time);
  } else if (map===ARENAS[arenaIndex]) {
    const a=map.floor[3], b=map.floor[4];
    figure(ctx,{id:0,x:a.x+35,y:a.y-30,w:20,h:30,ground:true,face:1,vx:35},t);
    figure(ctx,{id:1,x:b.x+18,y:b.y-30,w:20,h:30,ground:true,face:-1,vx:40},t+.4);
    image(ctx,'parcel',b.x-30,b.y-36+Math.sin(t*3)*4,17,17);
  }
  const guideSolids=previews?.some(({part})=>part.kind==='laser'||part.kind==='emitter')?raceSolids(g,0):[];
  for (const {part,valid,own,target} of previews??[]) {
    const color=COURIERS[part.owner].color;
    const outline=valid?(own?'#b7f698':color):'#ff796f';
    const movement=placementGuide(part,guideSolids);
    const body=movement?.body??placementBody(part);
    const horizontal=part.kind==='fan';
    const vertical=part.kind==='saw';
    if (target) {
      ctx.strokeStyle='#ffcc80';
      ctx.lineWidth=3;
      ctx.strokeRect(target.x-3,target.y-3,target.w+6,target.h+6);
    }
    if (movement) {
      const path=movement.path.map(([x,y])=>[x+(vertical?part.w/2+7:0),y-(horizontal?part.h/2+8:0)]);
      ctx.save();
      ctx.globalAlpha=own?1:.65;
      ctx.beginPath();
      ctx.moveTo(...path[0]);
      for (const point of path.slice(1)) ctx.lineTo(...point);
      ctx.strokeStyle='#282239';
      ctx.lineWidth=4;
      ctx.stroke();
      ctx.strokeStyle=outline;
      ctx.lineWidth=2;
      ctx.setLineDash([4,4]);
      ctx.stroke();
      ctx.fillStyle=outline;
      for (const [x,y] of [path[0],path.at(-1)]) ctx.fillRect(x-2,y-2,4,4);
      ctx.restore();
    }
    ctx.globalAlpha=own?.82:.48;
    machine(ctx,body,0,0);
    ctx.globalAlpha=1;
    ctx.strokeStyle=outline;
    ctx.lineWidth=2;
    ctx.strokeRect(body.x-.5,body.y-.5,body.w+1,body.h+1);
    ctx.fillStyle=color;
    ctx.font='bold 9px monospace';
    ctx.fillText('P'+(part.owner+1),part.x,part.y-(horizontal?15:5));
    if (DIRECTIONAL.has(part.kind)&&!movement) {
      ctx.fillStyle=ctx.strokeStyle;
      ctx.font='bold 19px monospace';
      ctx.fillText(part.face===1?'→':'←',part.face===1?part.x+part.w+5:part.x-17,part.y+part.h*.7);
    }
  }
}
