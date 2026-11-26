import { PIECES, DIRECTIONAL, WIDTH, HEIGHT, RACE_TICK, newGame, beginRace, stepRaceRunner,
  settleRunner, pieceAt, canPlace, trashTarget, build } from './game.js?v=26';
import { paint } from './render.js?v=26';

const moveKeys={KeyA:1,ArrowLeft:1,KeyD:2,ArrowRight:2,KeyW:4,ArrowUp:4,Space:4};
const clamp=(value,max)=>Math.max(0,Math.min(max,value));

export function createRouteTrial(stage) {
  const dialog=document.createElement('dialog');
  dialog.className='map-editor route-trial';
  dialog.setAttribute('aria-labelledby','trial-title');
  dialog.innerHTML=`
    <div class="dialog-head"><h2 id="trial-title">Probar mapa</h2><span id="trial-time" role="timer" aria-label="Tiempo restante"></span><button id="trial-back" type="button" class="ghost">Volver al editor</button></div>
    <div class="editor-board">
      <canvas width="${WIDTH}" height="${HEIGHT}" tabindex="0" aria-label="Pista de prueba" aria-describedby="trial-help"></canvas>
      <p id="trial-help"></p>
    </div>
    <div class="trial-touch" role="group" aria-label="Controles táctiles">
      <div class="trial-directions">
        <button type="button" data-input="1" aria-label="Izquierda">←</button>
        <button type="button" data-input="2" aria-label="Derecha">→</button>
      </div>
      <div class="touch-stick touch-stick-race" role="img" aria-label="Joystick para correr">
        <span class="touch-stick-knob" aria-hidden="true"></span>
      </div>
      <button type="button" data-input="4">Saltar</button>
    </div>
    <div class="trial-tools" hidden>
      <label>Pieza temporal <select id="trial-piece"></select></label>
      <button id="trial-flip" type="button" hidden>Girar →</button>
    </div>
    <footer class="editor-footer">
      <p id="trial-status" class="round-note" role="status"></p>
      <div class="actions">
        <button id="trial-base" type="button" hidden>Probar ruta base</button>
        <button id="trial-build" type="button" class="ghost">Montar piezas</button>
        <button id="trial-restart" type="button" class="primary">Reiniciar</button>
      </div>
    </footer>`;
  stage.append(dialog);
  const $=id=>dialog.querySelector('#'+id);
  const canvas=dialog.querySelector('canvas'), ctx=canvas.getContext('2d');
  const buildTools=dialog.querySelector('.trial-tools'), touchControls=dialog.querySelector('.trial-touch');
  const stick=touchControls.querySelector('.touch-stick');
  const select=$('trial-piece'), flip=$('trial-flip'), status=$('trial-status');
  for (const [id,piece] of Object.entries(PIECES)) select.add(new Option(piece.name,id));
  const keys=new Set(), touches=new Map();
  const point={x:WIDTH/2,y:HEIGHT/2};
  let map,rules,profiles,onVerified,onBack,game,pieces,editing,withPieces,face;
  let frame,last,carry,tick,jump,aiming;

  function clearInput() {
    keys.clear();
    for (const [id,{button}] of touches) {
      if (typeof id==='number'&&button.hasPointerCapture(id)) button.releasePointerCapture(id);
    }
    touches.clear();
    resetStick();
    jump=false;
  }

  function resetStick() {
    stick.removeAttribute('data-pressed');
    stick.style.removeProperty('--stick-x');
  }

  function movement() {
    let input=0;
    for (const code of keys) input|=moveKeys[code];
    for (const touch of touches.values()) input|=touch.input;
    return input;
  }

  function refresh() {
    buildTools.hidden=!editing;
    touchControls.hidden=editing;
    $('trial-time').hidden=editing;
    canvas.classList.toggle('trial-racing',!editing);
    $('trial-build').hidden=editing;
    $('trial-base').hidden=!pieces.length||(!editing&&!withPieces);
    $('trial-restart').textContent=editing?'Probar montaje':'Reiniciar';
    const coarse=matchMedia('(pointer: coarse)').matches;
    const raceHelp=coarse?'Usa el mando para correr y pulsa Saltar.'
      :'A/D o ←/→ para correr · W, ↑ o espacio para saltar · R para reiniciar';
    $('trial-help').textContent=editing?'Toca la pista para colocar. Con teclado, apunta con las flechas y confirma con Enter. Q gira la pieza.':raceHelp;
    flip.hidden=!DIRECTIONAL.has(select.value);
    flip.textContent=face===1?'Girar →':'Girar ←';
  }

  function start(assisted) {
    clearInput();
    editing=false;
    withPieces=assisted&&pieces.length>0;
    game=newGame([0],0,profiles,rules,map);
    if (withPieces) game.placed=pieces.map(part=>({...part}));
    beginRace(game);
    carry=tick=0;
    status.textContent=withPieces?'Prueba con piezas temporales.':'Prueba de la ruta base.';
    refresh();
    canvas.focus({preventScroll:true});
  }

  function editPieces() {
    clearInput();
    editing=true;
    aiming=false;
    game=newGame([0],0,profiles,rules,map);
    game.phase='build';
    game.placed=pieces;
    status.textContent='Coloca piezas temporales y pulsa Probar montaje.';
    refresh();
    canvas.focus({preventScroll:true});
  }

  function preview() {
    const part=pieceAt(select.value,point.x,point.y,0,face);
    const target=part.kind==='trash'?trashTarget(game,part):null;
    return {part,target,valid:canPlace(game,part),own:true};
  }

  function place() {
    const kind=select.value;
    game.picks={0:kind};
    game.finishedBuilding={};
    if (build(game,0,kind,point.x,point.y,face)) {
      game.phase='build';
      status.textContent=kind==='trash'?'Pieza retirada.':`${PIECES[kind].name} colocada.`;
      refresh();
    } else status.textContent=kind==='trash'?'Apunta a una pieza temporal para retirarla.':'La pieza no cabe aquí. Busca el contorno verde.';
  }

  function aim(event) {
    const box=canvas.getBoundingClientRect();
    point.x=Math.round((event.clientX-box.left)*WIDTH/box.width);
    point.y=Math.round((event.clientY-box.top)*HEIGHT/box.height);
    aiming=true;
  }

  function rotate() {
    face=-face;
    refresh();
    canvas.focus({preventScroll:true});
  }

  canvas.addEventListener('pointermove',event=>{if (editing) aim(event);});
  canvas.addEventListener('pointerleave',()=>{aiming=false;});
  canvas.addEventListener('click',event=>{
    if (editing&&event.detail) {
      aim(event);
      place();
    }
  });
  canvas.addEventListener('keydown',event=>{
    if (event.altKey||event.ctrlKey||event.metaKey) return;
    const {code,repeat}=event;
    if (editing) {
      const n=event.shiftKey?1:8;
      if (code==='ArrowLeft') point.x=clamp(point.x-n,WIDTH);
      else if (code==='ArrowRight') point.x=clamp(point.x+n,WIDTH);
      else if (code==='ArrowUp') point.y=clamp(point.y-n,HEIGHT);
      else if (code==='ArrowDown') point.y=clamp(point.y+n,HEIGHT);
      else if (code==='Enter') { if (!repeat) place(); }
      else if (code==='KeyQ'&&DIRECTIONAL.has(select.value)) { if (!repeat) rotate(); }
      else return;
      aiming=true;
    } else if (code==='KeyR') {
      if (!repeat) start(withPieces);
    } else if (moveKeys[code]) {
      if (moveKeys[code]===4&&!repeat&&!(movement()&4)) jump=true;
      keys.add(code);
    } else return;
    event.preventDefault();
  });
  canvas.addEventListener('blur',()=>keys.clear());
  dialog.addEventListener('keyup',event=>keys.delete(event.code));
  window.addEventListener('blur',clearInput);
  document.addEventListener('visibilitychange',()=>{if (document.hidden) clearInput();});

  for (const button of touchControls.querySelectorAll('button')) {
    const input=Number(button.dataset.input);
    button.addEventListener('pointerdown',event=>{
      if (event.button!==0||editing) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      if (input===4&&!(movement()&4)) jump=true;
      touches.set(event.pointerId,{input,button});
    });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) {
      button.addEventListener(type,event=>touches.delete(event.pointerId));
    }
    button.addEventListener('click',event=>{
      if (event.detail!==0||editing) return;
      if (input===4) jump=true;
      else {
        const press={input,button};
        touches.set(button,press);
        setTimeout(()=>{if (touches.get(button)===press) touches.delete(button);},180);
      }
    });
  }

  function steer(press,event) {
    const dx=event.clientX-press.center;
    const offset=Math.max(-press.radius,Math.min(press.radius,dx));
    stick.style.setProperty('--stick-x',`${offset}px`);
    press.input=Math.abs(dx)<=press.radius*.34?0:dx<0?1:2;
  }

  stick.addEventListener('pointerdown',event=>{
    if (event.button!==0||editing||stick.hasAttribute('data-pressed')) return;
    event.preventDefault();
    const box=stick.getBoundingClientRect();
    const press={button:stick,center:box.left+box.width/2,radius:box.width*.27};
    steer(press,event);
    touches.set(event.pointerId,press);
    stick.setPointerCapture(event.pointerId);
    stick.setAttribute('data-pressed','');
  });
  stick.addEventListener('pointermove',event=>{
    const press=touches.get(event.pointerId);
    if (press?.button===stick) steer(press,event);
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) {
    stick.addEventListener(type,event=>{if (touches.delete(event.pointerId)) resetStick();});
  }

  function draw(now) {
    if (!dialog.open) return;
    const dt=Math.min(.1,(now-last)/1000);
    last=now;
    const runner=game.players[0];
    if (!editing&&runner.status==='running') {
      carry+=dt;
      while (carry>=RACE_TICK&&runner.status==='running') {
        const input=movement()|(jump?8:0);
        jump=false;
        game.elapsed=Math.min(++tick*RACE_TICK,game.deadline);
        stepRaceRunner(game,runner,input,RACE_TICK);
        carry-=RACE_TICK;
        if (tick>=Math.round(game.deadline/RACE_TICK)) settleRunner(game,runner,'timeout',game.deadline);
      }
      if (runner.outcome==='finish') {
        status.textContent=withPieces?'Entrega con ayuda de construcción.':'Entrega completada · ruta base verificada.';
        if (!withPieces) onVerified();
      } else if (runner.outcome) {
        status.textContent=runner.outcome==='timeout'?'Tiempo agotado. Pulsa Reiniciar.':'Fuera de carrera. Pulsa Reiniciar.';
      }
    }
    if (!editing) {
      const time=`${Math.max(0,game.deadline-Math.floor(game.elapsed))} s`;
      if ($('trial-time').textContent!==time) $('trial-time').textContent=time;
    }
    paint(ctx,game,0,editing&&aiming?[preview()]:[],now/1000,0);
    frame=requestAnimationFrame(draw);
  }

  select.onchange=()=>{face=1;refresh();canvas.focus({preventScroll:true});};
  flip.onclick=rotate;
  $('trial-build').onclick=editPieces;
  $('trial-base').onclick=()=>start(false);
  $('trial-restart').onclick=()=>start(editing||withPieces);
  $('trial-back').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
    cancelAnimationFrame(frame);
    clearInput();
    onBack();
  });

  return (draft,options)=>{
    map=draft;
    ({rules,profiles,onVerified,onBack}=options);
    pieces=[];
    face=1;
    select.value='beam';
    dialog.showModal();
    start(false);
    last=performance.now();
    frame=requestAnimationFrame(draw);
  };
}
