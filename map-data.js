export const WIDTH=960;
export const HEIGHT=450;
export const MAX_PLATFORMS=48;
export const MAP_FORMAT_VERSION=1;
const format='salto-postal-map';
const themes=new Set(['dock','iris','canal','amber','boreal','mirror','deep','garden','mercury','crystal','orbit','salt']);
const arenas=new WeakMap();

const between=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const geometry=({x,y,w})=>({x,y,w});

export function blankMap() {
  return {
    format,version:MAP_FORMAT_VERSION,name:'Mapa sin título',theme:'dock',gravity:1090,
    origin:{x:40,y:384,w:152},destination:{x:815,y:342,w:109},seal:{x:480,y:284},platforms:[],
  };
}

export function mapFromArena(arena) {
  return {
    ...blankMap(),name:arena.name,theme:arena.theme,gravity:arena.gravity??1090,
    origin:geometry(arena.origin),destination:geometry(arena.destination),
    seal:{x:arena.token.x+9,y:arena.token.y+9},
    platforms:arena.floor.filter(box=>box!==arena.origin&&box!==arena.destination).map(geometry),
  };
}

export function arenaFromMap(map) {
  if (arenas.has(map)) return arenas.get(map);
  const origin={...map.origin,h:18},destination={...map.destination,h:18};
  const {name,theme,gravity}=map;
  const arena={
    name,theme,gravity,origin,destination,
    floor:[origin,...map.platforms.map(box=>({...box,h:16})),destination],
    exit:{x:destination.x+destination.w-54,y:destination.y-53,w:39,h:53},
    token:{x:map.seal.x-9,y:map.seal.y-9,w:18,h:18},
  };
  arenas.set(map,arena);
  return arena;
}

function readPlatform(value,minWidth,minY,height,label) {
  if (!value||!between(value.w,minWidth,WIDTH)||!between(value.x,0,WIDTH-value.w)||
    !between(value.y,minY,HEIGHT-height)) throw new Error(`${label} queda fuera del escenario o tiene un ancho inválido.`);
  return geometry(value);
}

export function readMap(value) {
  if (value?.format!==format||value.version!==MAP_FORMAT_VERSION) {
    throw new Error('Elige un archivo JSON compatible con el creador de Salto Postal.');
  }
  const name=typeof value.name==='string'?value.name.trim():'';
  if (!name||name.length>40||/[\x00-\x1f\x7f]/u.test(name)) {
    throw new Error('Escribe un nombre de entre 1 y 40 caracteres.');
  }
  if (!themes.has(value.theme)||![955,1090].includes(value.gravity)) throw new Error('El fondo o la gravedad del mapa no son válidos.');
  if (!Array.isArray(value.platforms)||value.platforms.length>MAX_PLATFORMS) {
    throw new Error(`Un mapa admite hasta ${MAX_PLATFORMS} plataformas.`);
  }
  if (!between(value.seal?.x,9,WIDTH-9)||!between(value.seal?.y,9,HEIGHT-9)) throw new Error('Coloca el sello dentro del escenario.');
  const map={
    format,version:MAP_FORMAT_VERSION,name,theme:value.theme,gravity:value.gravity,
    origin:readPlatform(value.origin,130,30,18,'La salida'),
    destination:readPlatform(value.destination,55,53,18,'La meta'),
    seal:{x:value.seal.x,y:value.seal.y},
    platforms:value.platforms.map(box=>readPlatform(box,24,0,16,'La plataforma')),
  };
  const {origin,floor,exit,token}=arenaFromMap(map);
  const start={x:origin.x+17,y:origin.y-30,w:113,h:30};
  if (floor.some((box,index)=>floor.slice(index+1).some(other=>overlap(box,other)))) {
    throw new Error('Separa las plataformas para que no se solapen.');
  }
  if (floor.some(box=>overlap(box,start)||overlap(box,exit))||overlap(start,exit)) {
    throw new Error('Deja espacio sobre la salida y delante del escáner de meta.');
  }
  if (floor.some(box=>overlap(box,token))||overlap(token,exit)) {
    throw new Error('Deja el sello en un espacio libre.');
  }
  return map;
}

export async function readMapFile(file) {
  if (file.size>24*1024) throw new Error('El archivo supera el límite de 24 KB.');
  let value;
  try { value=JSON.parse(await file.text()); }
  catch { throw new Error('El archivo no contiene un JSON válido.'); }
  return readMap(value);
}

export function downloadMap(map) {
  const slug=map.name.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const url=URL.createObjectURL(new Blob([JSON.stringify(map,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download=`salto-postal-${slug||'mapa'}.json`;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
