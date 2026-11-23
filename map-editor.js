import { ARENAS } from './game.js?v=22';
import { WIDTH, HEIGHT, MAX_PLATFORMS, blankMap, mapFromArena, arenaFromMap, readMap, readMapFile, downloadMap } from './map-data.js?v=10';
import { paintArena } from './render.js?v=22';

const tools={
  platform:['Plataforma','Pulsa para colocar un tramo o arrastra de lado a lado para dibujar su ancho.'],
  move:['Mover','Arrastra una plataforma, la salida, la meta o el sello.'],
  origin:['Salida','Coloca la plataforma de salida. Deja espacio para los cuatro jugadores.'],
  destination:['Meta','Coloca la plataforma con el escáner de entrega.'],
  seal:['Sello','Coloca el sello de estilo en el aire.'],
  erase:['Borrar','Pulsa sobre una plataforma del recorrido para quitarla.'],
};
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const snap=value=>Math.round(value/4)*4;
let editor;

export function openMapEditor(options={}) {
  editor??=createEditor();
  editor(options);
}

function createEditor() {
  const dialog=document.createElement('dialog');
  dialog.className='map-editor';
  dialog.setAttribute('aria-labelledby','editor-title');
  dialog.innerHTML=`
    <div class="dialog-head"><h2 id="editor-title">Creador de mapas</h2><button type="button" id="editor-close" class="ghost" aria-label="Cerrar creador">×</button></div>
    <div class="editor-source">
      <div class="editor-field"><label for="editor-base">Empezar desde</label><select id="editor-base"><option value="" selected disabled>Elegir base</option><option value="blank">Mapa en blanco</option></select></div>
      <button type="button" id="editor-open" class="ghost">Abrir archivo JSON</button>
      <input id="editor-file" type="file" accept=".json,application/json" hidden>
    </div>
    <div class="editor-workspace">
      <div class="editor-board">
        <div class="editor-tools" role="group" aria-label="Herramientas del mapa"></div>
        <canvas width="${WIDTH}" height="${HEIGHT}" tabindex="0" aria-label="Lienzo de la pista" aria-describedby="editor-hint editor-keys"></canvas>
        <p id="editor-hint"></p>
        <p id="editor-keys">Teclado en el lienzo · Flechas para apuntar, Enter para confirmar.</p>
      </div>
      <div class="editor-fields">
        <div class="editor-field"><label for="editor-name">Nombre del mapa</label><input id="editor-name" class="network-field" type="text" required maxlength="40" autocomplete="off"></div>
        <div class="editor-field"><label for="editor-theme">Fondo</label><select id="editor-theme"></select></div>
        <div class="editor-field"><label for="editor-gravity">Gravedad</label><select id="editor-gravity"><option value="1090">Normal</option><option value="955">Baja</option></select></div>
        <p id="editor-count"></p>
        <button type="button" id="editor-undo" class="ghost">Deshacer</button>
      </div>
    </div>
    <footer class="editor-footer">
      <p id="editor-status" role="status"></p>
      <div class="actions">
        <button type="button" id="editor-download" class="primary">Descargar mapa</button>
        <button type="button" id="editor-use" class="primary" hidden>Usar en esta sala</button>
      </div>
    </footer>`;
  document.getElementById('stage').append(dialog);
  const $=id=>dialog.querySelector('#'+id);
  const canvas=dialog.querySelector('canvas');
  const ctx=canvas.getContext('2d');
  const name=$('editor-name'), base=$('editor-base'), theme=$('editor-theme'), gravity=$('editor-gravity');
  const status=$('editor-status'), undo=$('editor-undo'), use=$('editor-use'), file=$('editor-file');
  const buttons=new Map(), history=[];
  let draft=blankMap(), tool='platform', onUse, session=0, importId=0;
  let point={x:480,y:224}, hover=false, gesture=null, keyboardAnchor=null, frame=0;

  for (const [index,arena] of ARENAS.entries()) {
    base.add(new Option(arena.name,index));
    theme.add(new Option(arena.name,arena.theme));
  }
  for (const [id,[label]] of Object.entries(tools)) {
    const button=document.createElement('button');
    button.type='button';
    button.textContent=label;
    button.onclick=()=>{
      tool=id;
      keyboardAnchor=null;
      status.textContent='';
      updateTools();
    };
    buttons.set(id,button);
    dialog.querySelector('.editor-tools').append(button);
  }

  function updateTools() {
    for (const [id,button] of buttons) button.setAttribute('aria-pressed',String(tool===id));
    $('editor-hint').textContent=tools[tool][1];
    canvas.dataset.tool=tool;
  }

  function syncFields() {
    name.value=draft.name;
    theme.value=draft.theme;
    gravity.value=draft.gravity;
    $('editor-count').textContent=`${draft.platforms.length} / ${MAX_PLATFORMS} plataformas`;
    undo.disabled=!history.length;
    name.removeAttribute('aria-invalid');
  }

  function change(next,message='') {
    history.push(draft);
    if (history.length>50) history.shift();
    draft=next;
    status.textContent=message;
    syncFields();
  }

  function undoChange() {
    if (!history.length) return;
    draft=history.pop();
    status.textContent='Cambio deshecho.';
    syncFields();
  }

  function atPointer(event) {
    const rect=canvas.getBoundingClientRect();
    return {
      x:clamp(snap((event.clientX-rect.left)*WIDTH/rect.width),0,WIDTH),
      y:clamp(snap((event.clientY-rect.top)*HEIGHT/rect.height),0,HEIGHT),
    };
  }

  function findPart({x,y},platformOnly=false) {
    if (!platformOnly&&Math.abs(x-draft.seal.x)<=12&&Math.abs(y-draft.seal.y)<=12) return {key:'seal',box:draft.seal};
    const within=(box,height)=>x>=box.x-4&&x<=box.x+box.w+4&&y>=box.y-4&&y<=box.y+height+4;
    const index=draft.platforms.findLastIndex(box=>within(box,16));
    if (index>=0) return {key:'platforms',index,box:draft.platforms[index]};
    if (platformOnly) return null;
    if (within(draft.origin,18)) return {key:'origin',box:draft.origin};
    const {exit}=arenaFromMap(draft);
    if (within(draft.destination,18)||within(exit,exit.h)) return {key:'destination',box:draft.destination};
    return null;
  }

  function fit(key,box) {
    if (key==='seal') return {x:clamp(box.x,9,WIDTH-9),y:clamp(box.y,9,HEIGHT-9)};
    const minY=key==='destination'?53:key==='origin'?30:0;
    return {x:clamp(box.x,0,WIDTH-box.w),y:clamp(box.y,minY,HEIGHT-(key==='platforms'?16:18)),w:box.w};
  }

  function proposal(start,end) {
    if (tool==='erase') return findPart(end,true);
    if (tool==='move') {
      const part=findPart(start);
      if (!part) return null;
      const {key,box}=part;
      return {...part,box:fit(key,{...box,x:box.x+end.x-start.x,y:box.y+end.y-start.y})};
    }
    if (tool==='seal') return {key:'seal',box:fit('seal',end)};
    if (tool==='platform') {
      const w=Math.abs(end.x-start.x);
      const box=w>=24?{x:Math.min(start.x,end.x),y:start.y,w}:{x:start.x-40,y:start.y,w:80};
      return {key:'platforms',box:fit('platforms',box)};
    }
    const {w}=draft[tool];
    return {key:tool,box:fit(tool,{x:end.x-Math.round(w/2),y:end.y,w})};
  }

  function drawPreview({key,box}) {
    const {x,y}=box;
    const bounds=key==='seal'?[x-9,y-9,18,18]:[x,y,box.w,key==='platforms'?16:18];
    ctx.strokeStyle=tool==='erase'?'#ff986e':'#d2f8a6';
    ctx.lineWidth=2;
    ctx.setLineDash([5,3]);
    ctx.strokeRect(...bounds);
    ctx.setLineDash([]);
  }

  function draw() {
    if (!dialog.open) return;
    paintArena(ctx,arenaFromMap(draft),0,true,true);
    ctx.beginPath();
    for (let x=16;x<WIDTH;x+=16) { ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,HEIGHT); }
    for (let y=16;y<HEIGHT;y+=16) { ctx.moveTo(0,y+.5);ctx.lineTo(WIDTH,y+.5); }
    ctx.lineWidth=1;
    ctx.strokeStyle='#f0d5bb22';
    ctx.stroke();
    if (hover||gesture||keyboardAnchor) {
      const start=gesture?.start??keyboardAnchor??point;
      const next=proposal(start,point);
      if (next) drawPreview(next);
      ctx.fillStyle='#fff0cc';
      ctx.fillRect(point.x-6,point.y-1,13,2);
      ctx.fillRect(point.x-1,point.y-6,2,13);
    }
    frame=requestAnimationFrame(draw);
  }

  function commit(start,end) {
    const next=proposal(start,end);
    if (!next) {
      status.textContent=tool==='erase'?'Apunta a una plataforma del recorrido.':'Elige una pieza del mapa para moverla.';
      return;
    }
    const {key,box,index}=next;
    const updated={...draft};
    if (key==='platforms') {
      updated.platforms=[...draft.platforms];
      if (tool==='erase') updated.platforms.splice(index,1);
      else if (tool==='move') updated.platforms[index]=box;
      else updated.platforms.push(box);
    } else updated[key]=box;
    try {
      readMap({...updated,name:blankMap().name});
      change(updated,tool==='erase'?'Plataforma eliminada.':'');
    } catch (error) { status.textContent=error.message; }
  }

  canvas.addEventListener('pointerdown',event=>{
    if (event.button!==0||gesture) return;
    point=atPointer(event);
    keyboardAnchor=null;
    gesture={id:event.pointerId,start:point};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if (gesture&&gesture.id!==event.pointerId) return;
    point=atPointer(event);
    hover=event.pointerType==='mouse';
  });
  canvas.addEventListener('pointerleave',()=>{hover=false;});
  canvas.addEventListener('pointerup',event=>{
    if (gesture?.id!==event.pointerId) return;
    point=atPointer(event);
    commit(gesture.start,point);
    gesture=null;
  });
  canvas.addEventListener('lostpointercapture',event=>{if (gesture?.id===event.pointerId) gesture=null;});
  canvas.addEventListener('keydown',event=>{
    const deltas={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]};
    const delta=deltas[event.key];
    if (delta) {
      point={x:clamp(point.x+delta[0],0,WIDTH),y:clamp(point.y+delta[1],0,HEIGHT)};
      hover=true;
    } else if (event.key==='Enter'&&!event.repeat) {
      if (tool==='move'&&!keyboardAnchor&&findPart(point)) {
        keyboardAnchor=point;
        status.textContent='Mueve con las flechas y pulsa Enter para soltar.';
      } else {
        commit(keyboardAnchor??point,point);
        keyboardAnchor=null;
      }
    } else return;
    event.preventDefault();
  });
  dialog.addEventListener('keydown',event=>{
    if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.shiftKey&&event.target!==name) {
      undoChange();
      event.preventDefault();
    }
  });

  base.onchange=()=>{
    const value=base.value;
    base.value='';
    change(value==='blank'?blankMap():mapFromArena(ARENAS[Number(value)]),'Base cargada.');
  };
  name.oninput=()=>{
    draft={...draft,name:name.value};
    name.removeAttribute('aria-invalid');
  };
  theme.onchange=()=>change({...draft,theme:theme.value});
  gravity.onchange=()=>change({...draft,gravity:Number(gravity.value)});
  undo.onclick=undoChange;
  $('editor-open').onclick=()=>file.click();
  file.onchange=async()=>{
    const selected=file.files[0];
    file.value='';
    if (!selected) return;
    const opened=session, attempt=++importId;
    try {
      const map=await readMapFile(selected);
      if (dialog.open&&opened===session&&attempt===importId) change(map,'Mapa abierto.');
    } catch (error) {
      if (dialog.open&&opened===session&&attempt===importId) status.textContent=error.message;
    }
  };

  function save(action) {
    try { action(readMap(draft)); }
    catch (error) {
      status.textContent=error.message;
      if (!name.value.trim()) { name.setAttribute('aria-invalid','true');name.focus(); }
    }
  }
  $('editor-download').onclick=()=>save(map=>{
    downloadMap(map);
    status.textContent='Mapa preparado para descargar.';
  });
  use.onclick=()=>save(map=>{
    onUse?.(map);
    dialog.close();
  });
  $('editor-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
    cancelAnimationFrame(frame);
    gesture=keyboardAnchor=null;
  });

  return ({map=null,onUse:apply=null})=>{
    if (dialog.open) return;
    session++;
    onUse=apply;
    if (map) {
      draft=map;
      history.length=0;
    }
    use.hidden=!onUse;
    $('editor-download').classList.toggle('primary',!onUse);
    status.textContent='';
    hover=false;
    updateTools();
    syncFields();
    dialog.showModal();
    draw();
  };
}
