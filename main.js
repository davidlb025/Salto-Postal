import {
  ARENAS, COURIERS, ACCESSORIES, avatar, defaultProfile, editProfile, voteResult,
  PIECES, DIRECTIONAL, WIDTH, HEIGHT, MAX_ROUNDS, ROUND_LIMIT, MAX_SCORE, SCORE_LIMIT,
  MOVEMENT_MIN, MOVEMENT_MAX, DEFAULT_WEIGHTS,
  roomRules, newGame, canVoteReset, voteReset, resetVoteStatus, rankPlayers,
  pieceAt, canPlace, trashTarget, canDraft, canBuildFor, setPreview, draft, build, disconnect, step,
} from './game.js?v=7';
import { paint, paintBackdrop, drawAccessory } from './render.js?v=7';
import { pieceURL } from './props.js';
import { ROOM_VERSION, createLink, shortSession, peerLink, normalizeCode, validCode, setRelay, clearRelay, hasRelay } from './network.js?v=7';
import { relaySession, usesRoomRelay as usesWebSocketRelay } from './relay.js?v=7';
import { managedSession, usesManagedRooms } from './managed-room.js?v=7';

const usesRoomRelay=usesWebSocketRelay||usesManagedRooms;
const openRoomSession=usesWebSocketRelay?relaySession:usesManagedRooms?managedSession:shortSession;
import { MotionBuffer, motionPacket, stateVersion } from './motion.js?v=7';

const $ = id=>document.getElementById(id);
const canvas=$('game'), ctx=canvas.getContext('2d'), dialog=$('dialog');
const touchDevice=matchMedia('(pointer: coarse) and (hover: none)');
const touchLayoutKey='salto-postal-touch-layout';
const keys=new Set(),touch=new Map(),remoteKeys=new Map(),remoteJumps=new Set();
let touchPhase='',touchJump=false;
const links=new Map();
const cursors=new Map();
const buildPoints=new Map();
const motion=new MotionBuffer();
let publishedState='',nextMotion=0,nextInput=0;
let profiles={0:defaultProfile(0)}, roomStatus='', roomError=false, connectedToRoom=false;
let settings=roomRules(),buildDrag=null;
let sentPreview='',sentPreviewAt=0,canvasView={scale:1,x:0,y:0};
let roomSession=null,roomCode='',hostedManually=false;
let mode='menu', game=null, arena=0, self=0, roster=[0];
let muted=false,audio,lastEvent=0,lastFrame=performance.now(),lastInput=-1;
let uiKey='', buildKey='', draftKey='', dialogPage='', pending=null, hostLink=null, countText='', lastMatch;

const button = (label, action, cls='secondary')=>{
  const node=document.createElement('button');
  node.className=cls;
  node.textContent=label;
  node.onclick=action;
  return node;
};

function tone(kind) {
  if (!audio || muted || audio.state!=='running') return;
  const notes={
    pick:[475,605], place:[360,560], jump:[230,360], spring:[305,680], hit:[155,70],
    start:[453,660], go:[453,660,906], finish:[440,555,740], podium:[523,659,784,1047], fail:[190,120],
    seal:[440,620,910], crack:[210,155], arm:[310,445], scrap:[320,440,590],
  }[kind];
  if (!notes) return;
  notes.forEach((frequency,i)=>{
    const at=audio.currentTime+i*.048, osc=audio.createOscillator(), gain=audio.createGain();
    osc.type='triangle';
    osc.frequency.value=frequency;
    gain.gain.setValueAtTime(.045,at);
    gain.gain.exponentialRampToValueAtTime(.001,at+.09);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at+.1);
  });
}
function enableAudio() {
  if (muted) return;
  if (!audio && globalThis.AudioContext) audio=new AudioContext();
  audio?.resume().catch(()=>{});
}
window.addEventListener('pointerdown',enableAudio);
window.addEventListener('keydown',enableAudio);
$('sound').onclick=()=>{
  muted=!muted;
  $('sound').textContent=muted?'♫̸':'♪';
  $('sound').setAttribute('aria-pressed',String(!muted));
  $('sound').setAttribute('aria-label',muted?'Sonido silenciado':'Sonido activado');
};

function modal(title, page, markup) {
  dialogPage=page;
  $('dialog-title').textContent=title;
  $('dialog-body').innerHTML=markup;
  clearInputs();
  if (!dialog.open) dialog.showModal();
}
$('close').onclick=()=>dialog.close();
dialog.addEventListener('close',()=>{
  if (dialogPage==='host' && pending) pending.close();
  if (['guest','short-guest'].includes(dialogPage)&&!hostLink?.open) reset();
  dialogPage='';
});
$('help').onclick=()=>{
  modal('Cómo jugar','help',`
    <p><strong>Elige.</strong> Todos pueden coger una pieza de la caja a la vez. La primera persona que la reclama se la queda.</p>
    <p><strong>Coloca.</strong> Todos construyen a la vez. En táctil, ajusta la pieza y pulsa Colocar. Con teclado, usa WASD o las flechas y confirma con E o Enter.</p>
    <p><strong>Entrega.</strong> Entra en el escáner verde. Cada entrega vale 3 puntos si alguien se queda fuera. El primero en llegar recibe 1 punto, incluso si todos entregan.</p>
    <p><strong>Bonos.</strong> Suma 1 por cada rival eliminado por una trampa tuya y 1 de estilo si recoges el sello dorado y entregas. La partida termina al alcanzar la meta de puntos o el límite de rondas de la sala.</p>
    <p>Corre con A/D o las flechas. Salta con W, ↑ o espacio.</p>
    ${touchDevice.matches?'<p>Abre <strong>Táctil</strong> para elegir flechas o joystick.</p>':''}`);
};

let touchLayout='arrows';
try {
  if (localStorage.getItem(touchLayoutKey)==='joystick') touchLayout='joystick';
} catch { /* The device can still use the current selection. */ }

function applyTouchLayout() {
  $('stage').dataset.touchLayout=touchLayout;
  for (const layout of document.querySelectorAll('.touch [data-touch-layout]')) {
    layout.hidden=layout.dataset.touchLayout!==touchLayout;
  }
}
applyTouchLayout();

function syncTouchDevice() {
  $('touch-settings').hidden=!touchDevice.matches;
  if (!touchDevice.matches&&dialogPage==='touch-settings') dialog.close();
  uiKey='';
}
touchDevice.addEventListener('change',syncTouchDevice);
syncTouchDevice();

$('touch-settings').onclick=()=>{
  modal('Controles táctiles','touch-settings',`
    <fieldset class="touch-options">
      <legend>Movimiento</legend>
      <label><input type="radio" name="touch-layout" value="arrows" ${touchLayout==='arrows'?'checked':''}><span>Flechas</span></label>
      <label><input type="radio" name="touch-layout" value="joystick" ${touchLayout==='joystick'?'checked':''}><span>Joystick</span></label>
    </fieldset>`);
  for (const option of dialog.querySelectorAll('[name="touch-layout"]')) option.onchange=()=>{
    clearTouch();
    sendInput();
    touchLayout=option.value;
    applyTouchLayout();
    try { localStorage.setItem(touchLayoutKey,touchLayout); } catch { /* Keep the selection in this tab. */ }
  };
};

function activeLinks() { return [...links.values()].filter(link=>link.open); }
function sendAll(message) { for (const link of activeLinks()) link.send(message); }
const resetVoteButton=$('reset-vote');
resetVoteButton.onclick=()=>{
  if (!canVoteReset(game,self)) return;
  const vote=!game.resetVotes.includes(self);
  if (mode==='guest') {
    hostLink?.send({type:'reset-vote',match:game.match,round:game.round,vote});
  } else if (mode==='host'&&voteReset(game,self,vote)) publishState();
};

function syncResetVote(g) {
  const visible=canVoteReset(g,self);
  if (resetVoteButton.hidden===visible) resetVoteButton.hidden=!visible;
  if (!visible) return;
  const {votes,total,scheduled,unanimous}=resetVoteStatus(g);
  const label=scheduled?'Reinicio previsto':unanimous?'Reinicio acordado':`Votar reinicio ${votes}/${total}`;
  const pressed=String(g.resetVotes.includes(self));
  if (resetVoteButton.textContent!==label) resetVoteButton.textContent=label;
  if (resetVoteButton.getAttribute('aria-pressed')!==pressed) resetVoteButton.setAttribute('aria-pressed',pressed);
  if (resetVoteButton.disabled!==scheduled) resetVoteButton.disabled=scheduled;
}

function publishState() {
  if (mode!=='host'||!game) return;
  const version=stateVersion(game);
  if (version===publishedState) return;
  publishedState=version;
  sendAll({type:'state',game});
}
function broadcastLobby(returnToLobby=false) {
  roster=[0,...activeLinks().map(link=>link.id)].sort((a,b)=>a-b);
  profiles=Object.fromEntries(roster.map(id=>[id,profiles[id]??defaultProfile(id)]));
  const selected=voteResult(roster,profiles,arena);
  for(const link of activeLinks()) link.send({type:'lobby',id:link.id,roster,arena:selected,profiles,rules:settings,returnToLobby});
  if(dialogPage==='host') refreshHost();
}
function changeProfile(patch) {
  if (game) return;
  if (mode==='guest') hostLink?.send({type:'profile',patch});
  else if (mode==='host') {
    profiles[0]=editProfile(profiles[0],patch);
    broadcastLobby();
  }
}
function canStartRoom() {
  return roster.length>=2&&roster.every(id=>profiles[id]?.ready);
}
function pointLabel(points) {
  return `${points} ${points===1?'pto':'pts'}`;
}
function showRoomRules() {
  if (mode!=='host'||game) return;
  const field=(name,label,min,max)=>`<label>${label}<input class="network-field" name="${name}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" required value="${settings[name]}"></label>`;
  modal('Ajustes de partida','room-rules',`
    <form id="room-rules-form">
      <div class="rules-fields">
        ${field('maxRounds','Rondas máximas',1,ROUND_LIMIT)}
        <label>Reiniciar objetos cada<input class="network-field" name="resetEvery" type="number" inputmode="numeric" min="0" max="${ROUND_LIMIT}" step="1" required value="${settings.resetEvery}" aria-describedby="reset-help"></label>
      </div>
      <p id="reset-help">Indica el número de rondas. Con 0, solo se limpian por votación.</p>
      <div class="rules-fields movement-fields">
        ${field('jump','Salto (%)',MOVEMENT_MIN,MOVEMENT_MAX)}
        ${field('speed','Velocidad (%)',MOVEMENT_MIN,MOVEMENT_MAX)}
        ${field('winPoints','Puntos para ganar',1,SCORE_LIMIT)}
      </div>
      <details class="rules-advanced">
        <summary>Ajustes avanzados</summary>
        <p>La caja reserva plazas para rutas y trampas. Cuanto más alto el peso de una pieza, más opciones tiene de salir. Con 0 queda fuera. El muelle y la papelera se ajustan en porcentaje.</p>
        <div class="rules-weights">${Object.entries(PIECES).map(([kind,item])=>`
          <label><span>${item.name}${['spring','trash'].includes(kind)?' (%)':''}</span><input class="network-field" type="number" name="${kind}" data-weight min="0" max="100" step="1" required value="${settings.weights[kind]}"></label>
        `).join('')}</div>
        <button type="button" id="restore-weights" class="ghost">Restablecer probabilidades</button>
      </details>
      <div class="actions"><button type="submit" class="primary">Guardar</button></div>
    </form>`);
  const form=$('room-rules-form'), weights=[...form.querySelectorAll('[data-weight]')];
  $('restore-weights').onclick=()=>{
    for (const input of weights) input.value=DEFAULT_WEIGHTS[input.name];
  };
  form.addEventListener('invalid',event=>{
    const section=event.target.closest('details');
    if (section) section.open=true;
  },true);
  form.onsubmit=event=>{
    event.preventDefault();
    if (mode!=='host'||game) return;
    settings=roomRules({
      maxRounds:form.elements.maxRounds.valueAsNumber,
      resetEvery:form.elements.resetEvery.valueAsNumber,
      winPoints:form.elements.winPoints.valueAsNumber,
      jump:form.elements.jump.valueAsNumber,
      speed:form.elements.speed.valueAsNumber,
      weights:Object.fromEntries(weights.map(input=>[input.name,input.valueAsNumber])),
    });
    broadcastLobby();
    dialog.close();
  };
}
function startMatch() {
  if (mode!=='host'||game||!canStartRoom()) return;
  arena=voteResult(roster,profiles,arena);
  game=newGame(roster,arena,profiles,settings);
  lastEvent=0;
  buildPoints.clear();
  clearInputs();
  publishState();
}
function reset() {
  const peers=[...links.values(),hostLink].filter(Boolean);
  mode='menu';
  game=null;
  motion.reset();
  publishedState='';
  lastInput=-1;
  remoteKeys.clear();
  remoteJumps.clear();
  roster=[0];
  self=0;
  profiles={0:defaultProfile(0)};
  settings=roomRules();
  connectedToRoom=false;
  pending=hostLink=null;
  links.clear();
  for(const link of peers) link.close();
  roomSession?.close();
  roomSession=null;
  roomCode='';
  roomStatus='';
  roomError=false;
  hostedManually=false;
  clearInputs();
}
$('exit').onclick=()=>{
  reset();
  if(dialog.open) dialog.close();
};

function setStatus(message) {
  const node=$('connection-status');
  if(node) node.textContent=message;
}
function copyField(field,feedback=setStatus) {
  const input=$(field);
  input.select();
  if(navigator.clipboard) navigator.clipboard.writeText(input.value).then(
    ()=>feedback('Código copiado.'),()=>feedback('Copia el código seleccionado.'));
  else feedback('Copia el código seleccionado.');
}
function showOnline() {
  modal('Jugar en línea','online',`
    <p>Comparte un código de seis caracteres para jugar con hasta tres amigos.</p>
    <div class="actions"><button class="primary" id="host-room">Crear sala</button><button id="join-room">Unirme a una sala</button></div>
    ${usesRoomRelay?'':'<div class="actions"><button id="manual-online" class="ghost">Conexión manual</button><button id="network-online" class="ghost">Opciones de red</button></div>'}`);
  $('host-room').onclick=()=>{ mode='host'; dialog.close(); openShortHost(); };
  $('join-room').onclick=()=>showShortGuest();
  if (!usesRoomRelay) {
    $('manual-online').onclick=showManual;
    $('network-online').onclick=()=>showNetworkOptions(showOnline);
  }
}
$('online').onclick=showOnline;

function showNetworkOptions(back) {
  if (mode==='guest'&&!hostLink?.open) reset();
  modal('Opciones de red','network',`
    <p>Si la sala responde pero las redes impiden conectar, añade un relé TURN. Usa las credenciales temporales de tu proveedor en ambos dispositivos antes de crear o unirte a la sala.</p>
    <form id="relay-form">
      <label>Servidor TURN<input id="relay-url" class="network-field" placeholder="turns:servidor:443?transport=tcp" required spellcheck="false" autocapitalize="off"></label>
      <label>Usuario temporal<input id="relay-user" class="network-field" required autocomplete="off"></label>
      <label>Contraseña temporal<input id="relay-key" class="network-field" type="password" required autocomplete="off"></label>
      <div class="actions"><button class="primary">Aplicar relé</button><button type="button" id="relay-clear" class="ghost">Volver a conexión directa</button></div>
    </form>
    <p class="status" id="connection-status" role="status"></p>
    <button id="relay-back" class="ghost">Volver</button>`);
  setStatus(hasRelay()?'Hay un relé configurado para esta pestaña.':'Las credenciales duran hasta que recargues la página.');
  $('relay-form').onsubmit=event=>{
    event.preventDefault();
    try {
      setRelay($('relay-url').value,$('relay-user').value,$('relay-key').value);
      back();
    } catch (error) { setStatus(error.message); }
  };
  $('relay-clear').hidden=!hasRelay();
  $('relay-clear').onclick=()=>{ clearRelay(); back(); };
  $('relay-back').onclick=back;
}

function copyRoomLink() {
  const url=new URL('./',location.href);
  url.searchParams.set('sala',roomCode);
  url.searchParams.set('v',ROOM_VERSION);
  const showLink=()=>{
    modal('Enlace de sala','room-link','<label>Comparte este enlace<input id="room-link" class="network-field" readonly></label>');
    $('room-link').value=url.href;
    $('room-link').select();
  };
  if (!navigator.clipboard) { showLink(); return; }
  navigator.clipboard.writeText(url.href).then(()=>{
    if ($('room-status')) $('room-status').textContent='Enlace copiado.';
  },showLink);
}

function showManual() {
  reset();
  modal('Conexión manual','manual',`
    <p>Intercambia una invitación y una respuesta WebRTC por cada jugador.</p>
    <div class="actions"><button class="primary" id="manual-host">Crear sala manual</button><button id="manual-guest">Usar invitación manual</button></div>
    <button class="ghost" id="back-online">Volver</button>`);
  $('manual-host').onclick=()=>{mode='host';hostedManually=true;showHost();};
  $('manual-guest').onclick=showGuest;
  $('back-online').onclick=showOnline;
}

function openShortHost() {
  roomSession?.close();
  roomCode='';
  roomError=false;
  roomStatus='Creando código…';
  roomSession=openRoomSession(null,acceptShortPeer,(error,code)=>{
    if (code) roomCode=code;
    else if (usesRoomRelay&&error) roomCode='';
    roomError=!!error;
    roomStatus=error||'';
  });
}

function acceptShortPeer(connection) {
  const id=[1,2,3].find(slot=>!links.has(slot));
  if (mode!=='host'||game||!id) {
    const reject=()=>{
      connection.send({type:'reject',reason:game?'La partida ya ha empezado.':'La sala está completa.'});
      setTimeout(()=>connection.close(),350);
    };
    if (connection.open) reject(); else connection.on('open',reject);
    return;
  }
  const link=peerLink(connection,id,()=>{
    if (game) { link.close(); return; }
    broadcastLobby();
    setStatus(COURIERS[id].name+' se ha unido.');
  },()=>{
    links.delete(id);
    remoteKeys.delete(id);
    remoteJumps.delete(id);
    if (mode!=='host') return;
    if (game) disconnect(game,id);
    broadcastLobby();
  },onHostMessage);
  links.set(id,link);
}

function showShortGuest(code='',notice='') {
  modal('Unirme a una sala','short-guest',`
    <form id="join-form"><label>Código de sala<input id="join-code" class="room-code" required maxlength="8"
      autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234"></label>
    <button class="primary" id="connect-short">Entrar</button></form>
    ${usesRoomRelay?'':'<div class="actions"><button id="short-manual" class="ghost">Usar invitación manual</button><button id="guest-network" class="ghost">Opciones de red</button></div>'}
    <p class="status" id="connection-status" role="status"></p>`);
  $('join-code').value=code;
  setStatus(notice);
  if (!usesRoomRelay) {
    $('short-manual').onclick=()=>{ reset(); showGuest(); };
    $('guest-network').onclick=()=>{
      const input=$('join-code').value;
      showNetworkOptions(()=>showShortGuest(input));
    };
  }
  $('join-form').onsubmit=event=>{
    event.preventDefault();
    joinShortRoom();
  };
}

function joinShortRoom() {
  if ($('connect-short').disabled) return;
  const code=normalizeCode($('join-code').value);
  if (!validCode(code)) { setStatus('Introduce los seis caracteres del código.'); return; }
  mode='guest';
  $('connect-short').disabled=true;
  setStatus('Buscando la sala…');
  function failed(message) {
    if (mode!=='guest') return;
    reset();
    if (dialogPage==='short-guest'&&dialog.open) {
      $('connect-short').disabled=false;
      setStatus(message);
    } else modal('Conexión cerrada','notice','<p>El anfitrión se ha desconectado.</p>');
  }
  roomSession=openRoomSession(code,(connection,firstMessage)=>{
    function receive(link,message) {
        if (message.type==='reject') { failed(message.reason); return; }
        if (message.type==='lobby'&&dialogPage==='short-guest') dialog.close();
        receiveGuest(link,message);
    }
    const link=peerLink(connection,0,()=>setStatus('Conectado. Esperando confirmación de la sala…'),
      (_link,reason)=>failed(reason||'Se cerró la conexión con la sala.'),receive);
    hostLink=link;
    if (firstMessage) queueMicrotask(()=>{
      if (hostLink===link&&link.open) receive(link,firstMessage);
    });
  },(message,progress)=>{
    if (progress) setStatus(message);
    else if (message&&!hostLink?.open) failed(message);
  });
}

function showHost() {
  modal('Invitación manual','host',`
    <p id="manual-count"></p>
    <div class="actions"><button id="invite">Invitar a alguien</button><button id="manual-lobby" class="primary">Volver al lobby</button></div>
    <div id="exchange" hidden>
      <label>1. Envía esta invitación<textarea id="offer-code" rows="2" readonly></textarea></label>
      <div class="actions"><button id="copy-offer">Copiar invitación</button></div>
      <label>2. Pega la respuesta<textarea id="answer-code" rows="2" spellcheck="false"></textarea></label>
      <div class="actions"><button id="accept-code" class="primary">Conectar</button><button id="cancel-invite">Cancelar invitación</button></div>
    </div>
    <p id="connection-status" class="status" role="status"></p>`);
  $('copy-offer').onclick=()=>copyField('offer-code');
  $('invite').onclick=invite;
  $('accept-code').onclick=accept;
  $('cancel-invite').onclick=()=>{ pending?.close(); setStatus('Invitación cancelada.'); };
  $('manual-lobby').onclick=()=>dialog.close();
  refreshHost();
}

function refreshHost() {
  if (!$('manual-count')) return;
  $('manual-count').textContent=roster.length+' de 4 en la cuadrilla';
  if ($('invite')) {
    $('invite').disabled=!!pending||roster.length===4;
    $('exchange').hidden=!pending;
  }
}
function onHostMessage(link,message) {
  if (!link.open) return;
  if (!game) {
    if (message.type==='profile'&&message.patch&&typeof message.patch==='object'&&profiles[link.id]) {
      profiles[link.id]=editProfile(profiles[link.id],message.patch);
      broadcastLobby();
    }
    return;
  }
  if (message.match!==game.match||message.round!==game.round) return;
  if (message.type==='reset-vote') {
    if (voteReset(game,link.id,message.vote)) publishState();
    return;
  }
  if (message.type==='input'&&game.phase==='race'&&Number.isInteger(message.bits)&&message.bits>=0&&message.bits<=7) {
    const before=remoteKeys.get(link.id)??0;
    if ((message.bits&4)&&!(before&4)) remoteJumps.add(link.id);
    remoteKeys.set(link.id,message.bits);
    return;
  }
  if (message.type==='preview') {
    if (Number.isFinite(message.sequence)&&message.sequence>(link.previewSequence??-1)&&
      (message.point===null||typeof message.point==='object')&&setPreview(game,link.id,message.point)) link.previewSequence=message.sequence;
    return;
  }
  const changed=message.type==='draft'?draft(game,link.id,message.kind)
    :message.type==='build'&&build(game,link.id,message.kind,message.x,message.y,message.face);
  if (changed) publishState();
  else if (message.type==='draft'&&canDraft(game,link.id)) link.send({type:'claimed'});
  else if (message.type==='build'&&canBuildFor(game,link.id)) link.send({type:'blocked'});
}

async function invite() {
  if (pending || roster.length===4) return;
  const id=[1,2,3].find(i=>!links.has(i));
  let link;
  try {
    link=createLink(id,()=>{
      if (pending===link) pending=null;
      broadcastLobby();
      setStatus(COURIERS[id].name+' se ha unido.');
    },()=>{
      links.delete(id);
      if(pending===link) pending=null;
      remoteKeys.delete(id);
      remoteJumps.delete(id);
      if (mode!=='host') return;
      if(game) disconnect(game,id);
      broadcastLobby();
      if (dialogPage==='host') setStatus('Conexión cerrada. Puedes generar otra invitación.');
    },onHostMessage);
    links.set(id,link);
    pending=link;
    $('offer-code').value='';
    $('answer-code').value='';
    $('copy-offer').disabled=true;
    $('accept-code').disabled=true;
    refreshHost();
    setStatus('Preparando invitación…');
    const code=await link.invite();
    if (pending!==link || dialogPage!=='host') return;
    $('offer-code').value=code;
    $('copy-offer').disabled=false;
    $('accept-code').disabled=false;
    setStatus('Envía el código completo a un jugador.');
  } catch(error) {
    link?.close();
    setStatus(error.message);
  }
}

async function accept() {
  const link=pending;
  if(!link) return;
  $('accept-code').disabled=true;
  try {
    await link.connect($('answer-code').value);
    if(pending===link) setStatus('Conectando… Puedes cancelar si la conexión no se establece.');
  } catch(error) {
    if(pending===link) {
      $('accept-code').disabled=false;
      setStatus(error.message);
    }
  }
}

function showGuest() {
  modal('Unirme a una sala','guest',`
    <label>1. Pega la invitación<textarea id="guest-offer" rows="2" spellcheck="false"></textarea></label>
    <button id="create-answer" class="primary">Generar respuesta</button>
    <div id="guest-output" hidden>
      <label>2. Envía tu respuesta al anfitrión<textarea id="guest-answer" rows="2" readonly></textarea></label>
      <button id="copy-answer">Copiar respuesta</button>
    </div>
    <p id="connection-status" class="status" role="status"></p>`);
  $('copy-answer').onclick=()=>copyField('guest-answer');
  $('create-answer').onclick=answer;
}

async function answer() {
  $('create-answer').disabled=true;
  mode='guest';
  let link;
  try {
    link=createLink(0,()=>{
      setStatus('Conexión establecida. Esperando al anfitrión…');
      if(dialogPage==='guest') dialog.close();
    },()=>{
      if(hostLink!==link || mode!=='guest') return;
      reset();
      modal('Conexión cerrada','notice','<p>Se perdió la conexión con el anfitrión. Puedes volver a entrar con una invitación nueva.</p>');
    },receiveGuest);
    hostLink=link;
    setStatus('Preparando respuesta…');
    const code=await link.answer($('guest-offer').value);
    if(hostLink!==link || dialogPage!=='guest') return;
    $('guest-answer').value=code;
    $('guest-output').hidden=false;
    setStatus('Envía la respuesta al anfitrión para que confirme la conexión.');
  } catch(error) {
    if (dialogPage!=='guest' || (link && hostLink!==link)) return;
    hostLink=null;
    link?.close();
    $('create-answer').disabled=false;
    setStatus(error.message);
  }
}

function receiveGuest(_link,message) {
  if (message.type==='lobby'&&Array.isArray(message.roster)&&COURIERS[message.id]&&message.profiles) {
    self=message.id;
    roster=message.roster.filter(id=>COURIERS[id]);
    profiles=message.profiles;
    settings=roomRules(message.rules);
    connectedToRoom=true;
    if (message.returnToLobby) {
      game=null;
      motion.reset();
      lastInput=-1;
    }
    if (ARENAS[message.arena]) arena=message.arena;
  }
  if (message.type==='state'&&message.game?.players&&ARENAS[message.game.arena]) {
    if (!game||message.game.event.id<lastEvent) lastEvent=0;
    const next=message.game;
    if (game?.match===next.match&&game.round===next.round&&game.phase===next.phase) next.elapsed=Math.max(game.elapsed,next.elapsed);
    else lastInput=-1;
    game=message.game;
  }
  if (message.type==='motion'&&game&&motion.push(game,message,performance.now())) {
    game.elapsed=Math.max(game.elapsed,message.elapsed);
  }
  if (message.type==='claimed'||message.type==='blocked') tone('fail');
}

function clearInputs() {
  keys.clear();
  clearTouch();
  releaseBuildDrag();
  sendInput();
}
function clearTouch() {
  const held=[...touch];
  touch.clear();
  touchJump=false;
  for (const [id,{node}] of held) {
    releaseTouchControl(node);
    if (node.hasPointerCapture(id)) node.releasePointerCapture(id);
  }
}
function releaseTouchControl(node) {
  node.removeAttribute('data-pressed');
  if (node.hasAttribute('data-stick')) {
    node.style.removeProperty('--stick-x');
    node.style.removeProperty('--stick-y');
  }
}
function touchBits(phase) {
  let bits=0;
  for (const press of touch.values()) if (press.phase===phase) bits|=press.bit;
  return bits;
}
function ownInput() {
  let bits=Number(keys.has('KeyA')||keys.has('ArrowLeft'))|
    (Number(keys.has('KeyD')||keys.has('ArrowRight'))<<1);
  if (keys.has('KeyW')||keys.has('ArrowUp')) bits|=4;
  if (keys.has('Space')) bits|=4;
  if (!dialog.open) bits|=touchBits('race');
  return bits;
}
function sendInput(force=false) {
  if(mode!=='guest'||!hostLink?.open||game?.phase!=='race') return;
  const bits=ownInput();
  if(force||bits!==lastInput) {
    hostLink.send({type:'input',match:game.match,round:game.round,bits});
    lastInput=bits;
  }
}
const gameKeys=new Set(['Space','KeyA','KeyD','KeyW','ArrowLeft','ArrowRight','ArrowUp']);
window.addEventListener('keydown',event=>{
  if(dialog.open||!game) return;
  if (game.phase==='build') {
    buildKeypress(event);
    return;
  }
  if(!gameKeys.has(event.code) ||
    (event.code==='Space' && document.activeElement?.matches('button'))) return;
  event.preventDefault();
  if (game.phase==='draft') {
    draftKeypress(event);
    return;
  }
  keys.add(event.code);
  sendInput();
});
window.addEventListener('keyup',event=>{ keys.delete(event.code); sendInput(); });
window.addEventListener('blur',clearInputs);
document.addEventListener('visibilitychange',()=>{if(document.hidden) clearInputs();});
window.addEventListener('resize',()=>{
  releaseBuildDrag();
  if (touch.size) {
    clearTouch();
    sendInput();
  }
});

function steerStick(press,event) {
  const {node,phase,centerX,centerY,radius}=press;
  const x=event.clientX-centerX;
  const y=phase==='build'?event.clientY-centerY:0;
  const scale=Math.min(1,radius/(Math.hypot(x,y)||1));
  const deadZone=radius*.34;
  node.style.setProperty('--stick-x',x*scale+'px');
  node.style.setProperty('--stick-y',y*scale+'px');
  return (x<-deadZone?1:x>deadZone?2:0)|(y<-deadZone?4:y>deadZone?8:0);
}

for (const node of document.querySelectorAll('.touch [data-key],.touch [data-stick]')) {
  const phase=node.closest('#touch-build')?'build':'race';
  const stick=node.hasAttribute('data-stick');
  node.addEventListener('pointerdown',event=>{
    if (event.button!==0||event.pointerType==='mouse'||!touchDevice.matches||dialog.open||
      game?.phase!==phase||touchPhase!==phase||(stick&&node.hasAttribute('data-pressed'))) return;
    const press={node,phase,bit:Number(node.dataset.key)};
    if (stick) {
      const rect=node.getBoundingClientRect();
      press.centerX=rect.left+rect.width/2;
      press.centerY=rect.top+rect.height/2;
      press.radius=rect.width*.27;
      press.bit=steerStick(press,event);
    }
    if (mode==='host'&&phase==='race'&&press.bit===4&&!(ownInput()&4)) touchJump=true;
    node.setPointerCapture(event.pointerId);
    touch.set(event.pointerId,press);
    node.setAttribute('data-pressed','');
    if (phase==='race') sendInput();
    else if (!stick) shiftBuildCursor(Number(press.bit===2)-Number(press.bit===1),Number(press.bit===8)-Number(press.bit===4),8);
  });
  if (stick) node.addEventListener('pointermove',event=>{
    const press=touch.get(event.pointerId);
    if (press?.node!==node) return;
    const bit=steerStick(press,event);
    if (press.bit===bit) return;
    press.bit=bit;
    if (phase==='race') sendInput();
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) node.addEventListener(type,event=>{
    if (!touch.delete(event.pointerId)) return;
    if (![...touch.values()].some(press=>press.node===node)) releaseTouchControl(node);
    if (phase==='race') sendInput();
  });
  node.addEventListener('contextmenu',event=>event.preventDefault());
}
$('touch-place').onclick=()=>confirmPlacement(self);
function hostInputs() {
  if (game.phase!=='race') {
    remoteKeys.clear();
    remoteJumps.clear();
    return {};
  }
  const input=Object.fromEntries(remoteKeys);
  input[0]=ownInput()|(touchJump?8:0);
  touchJump=false;
  for (const id of remoteJumps) input[id]=(input[id]??0)|8;
  remoteJumps.clear();
  return input;
}
function builder() {
  return canBuildFor(game,self)?self:undefined;
}

function act(kind,x,y) {
  if (!game) return;
  const type=game.phase==='draft'?'draft':'build';
  if (type==='draft'?!canDraft(game,self):!canBuildFor(game,self)) return;
  const face=buildPoints.get(self)?.face;
  if (mode==='guest') {
    hostLink?.send({type,match:game.match,round:game.round,kind,x,y,face});
    return;
  }
  const changed=type==='draft'?draft(game,self,kind):build(game,self,kind,x,y,face);
  if (changed) publishState();
}

function draftKeypress(event) {
  if (!canDraft(game,self)||event.repeat) return;
  const key=['KeyA','ArrowLeft'].includes(event.code)?0:['KeyD','ArrowRight'].includes(event.code)?1:2;
  const list=game.offer;
  const index=list.indexOf(cursors.get(self));
  if (key===2) {
    act(list[Math.max(0,index)]);
    return;
  }
  const next=(Math.max(0,index)+(key===0?-1:1)+list.length)%list.length;
  cursors.set(self,list[next]);
  markCursors();
}

function markCursors() {
  for (const slot of $('sheet').querySelectorAll('[data-piece]')) slot.querySelector('.cursors').replaceChildren();
  if (!canDraft(game,self)) return;
  const selected=game.offer.includes(cursors.get(self))?cursors.get(self):game.offer[0];
  const slot=$('sheet').querySelector('[data-piece="'+selected+'"] .cursors');
  if (!slot) return;
  const chip=document.createElement('span');
  chip.style.background=COURIERS[self].color;
  chip.textContent='P'+(self+1);
  slot.append(chip);
}

const builderKeys=[
  ['KeyA','KeyD','KeyW','KeyS','KeyE'],
  ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter'],
];
const pointFor=id=>buildPoints.get(id)??{x:280+id*132,y:109+id%2*31,face:1};
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));

function resizeCanvas() {
  const width=canvas.clientWidth, height=canvas.clientHeight;
  if (!width||!height) return;
  const ratio=Math.min(devicePixelRatio,1920/width,1260/height);
  const w=Math.round(width*ratio),h=Math.round(height*ratio);
  if (canvas.width!==w||canvas.height!==h) {
    canvas.width=w;
    canvas.height=h;
  }
  const padding=Math.min(height*.23,height<470?45:78)*ratio;
  const scale=Math.min(w/WIDTH,(h-padding*2)/HEIGHT);
  canvasView={scale,x:(w-WIDTH*scale)/2,y:(h-HEIGHT*scale)/2};
}
new ResizeObserver(resizeCanvas).observe(canvas);
resizeCanvas();

function gamePoint(event,id) {
  const rect=canvas.getBoundingClientRect();
  const {x,y,scale}=canvasView;
  return {...pointFor(id),
    x:(event.clientX-rect.left)*canvas.width/rect.width/scale-x/scale,
    y:(event.clientY-rect.top)*canvas.height/rect.height/scale-y/scale};
}

function placement(id,point=pointFor(id)) {
  if (!canBuildFor(game,id)) return null;
  const part=pieceAt(game.picks[id],point.x,point.y,id,point.face);
  if (part.kind==='trash') {
    const target=trashTarget(game,part);
    return {part,valid:!!target,target};
  }
  return {part,valid:canPlace(game,part)};
}

function confirmPlacement(id) {
  const preview=placement(id);
  const point=pointFor(id);
  if (preview?.valid) act(preview.part.kind,point.x,point.y);
  else if (preview) tone('fail');
}

function buildKeypress(event) {
  if (event.code==='Enter'&&document.activeElement?.matches('button,select,input')) return;
  if (!builderKeys.some(set=>set.includes(event.code))) return;
  event.preventDefault();
  if (['Enter','KeyE'].includes(event.code)) {
    if (!event.repeat) confirmPlacement(self);
    return;
  }
  keys.add(event.code);
}

function moveBuildCursors(dt) {
  if (!canBuildFor(game,self)||dialog.open) return;
  const held=touchBits('build');
  const direction=index=>(held&(1<<index))||builderKeys.some(set=>keys.has(set[index]));
  const dx=Number(direction(1))-Number(direction(0)),dy=Number(direction(3))-Number(direction(2));
  if (dx||dy) shiftBuildCursor(dx,dy,dt*(held?175:280)/Math.hypot(dx,dy));
}

function shiftBuildCursor(dx,dy,distance) {
  const point=pointFor(self);
  buildPoints.set(self,{...point,x:clamp(point.x+dx*distance,0,WIDTH),y:clamp(point.y+dy*distance,0,HEIGHT)});
}

function visiblePlacements(view) {
  if (game?.phase!=='build') return [];
  return game.players.flatMap(p=>{
    if (!canBuildFor(game,p.id)) return [];
    const own=p.id===self;
    const point=own?pointFor(p.id):view.previews[p.id];
    return point?[{...placement(p.id,point),own}]:[];
  });
}

function broadcastPreview() {
  if (game?.phase!=='build'||!canBuildFor(game,self)) return;
  const point=pointFor(self);
  const valid=point.x>=0&&point.x<=WIDTH&&point.y>=0&&point.y<=HEIGHT;
  const coords=valid?{x:Math.round(point.x*10)/10,y:Math.round(point.y*10)/10,face:point.face}:null;
  if (mode==='host') setPreview(game,self,coords);
  else if (mode==='guest') {
    const hash=JSON.stringify([game.match,game.round,coords]);
    const now=performance.now();
    if (hash!==sentPreview||now-sentPreviewAt>=250) {
      sentPreview=hash;
      sentPreviewAt=now;
      hostLink?.sendMotion({type:'preview',match:game.match,round:game.round,sequence:now,point:coords});
    }
  }
}

function usesTouchPlacement(event) {
  return event.pointerType==='touch'||(event.pointerType==='pen'&&touchDevice.matches);
}

function releaseBuildDrag() {
  if (!buildDrag) return;
  const {pointer}=buildDrag;
  buildDrag=null;
  if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
}

canvas.addEventListener('pointermove',event=>{
  const id=builder();
  if (id===undefined||dialog.open) return;
  if (!usesTouchPlacement(event)) {
    if (!buildDrag) buildPoints.set(id,gamePoint(event,id));
    return;
  }
  if (buildDrag?.pointer!==event.pointerId) return;
  const {x,y,originX,originY}=buildDrag;
  if (!buildDrag.moved&&Math.hypot(event.clientX-originX,event.clientY-originY)<4) return;
  const scale=Math.min(2.2,canvas.width/canvas.getBoundingClientRect().width/canvasView.scale);
  shiftBuildCursor(event.clientX-x,event.clientY-y,scale);
  Object.assign(buildDrag,{x:event.clientX,y:event.clientY,moved:true});
});
canvas.addEventListener('pointerdown',event=>{
  const id=builder();
  if (id===undefined||event.button!==0||dialog.open||buildDrag) return;
  if (usesTouchPlacement(event)) {
    const {clientX:x,clientY:y,pointerId:pointer}=event;
    buildDrag={pointer,x,y,originX:x,originY:y,moved:false};
    canvas.setPointerCapture(pointer);
  } else buildPoints.set(id,gamePoint(event,id));
});
canvas.addEventListener('pointerup',event=>{
  const id=builder();
  if (usesTouchPlacement(event)) {
    if (buildDrag?.pointer!==event.pointerId) return;
    if (!buildDrag.moved&&id!==undefined&&!dialog.open) {
      const point=gamePoint(event,id);
      buildPoints.set(id,{...point,x:clamp(point.x,0,WIDTH),y:clamp(point.y,0,HEIGHT)});
    }
    releaseBuildDrag();
    return;
  }
  if (id===undefined||event.button!==0||dialog.open||buildDrag) return;
  buildPoints.set(id,gamePoint(event,id));
  confirmPlacement(id);
});
for (const type of ['pointercancel','lostpointercapture']) canvas.addEventListener(type,event=>{
  if (buildDrag?.pointer===event.pointerId) releaseBuildDrag();
});
const full=$('fullscreen');
full.hidden=!document.fullscreenEnabled;
full.onclick=async()=>{
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    modal('Pantalla completa','notice','<p>El navegador no pudo activar la pantalla completa. El juego ocupa toda la ventana.</p>');
  }
};
document.addEventListener('fullscreenchange',()=>{
  const active=!!document.fullscreenElement;
  full.setAttribute('aria-pressed',String(active));
  full.setAttribute('aria-label',active?'Salir de pantalla completa':'Activar pantalla completa');
  full.title=full.getAttribute('aria-label');
});

function renderRoster() {
  const statuses={away:'Desconectado',ready:'Preparado',running:'En carrera',out:'Eliminado',done:'Entregado'};
  const ids=game?game.players.map(p=>p.id):roster;
  $('roster').innerHTML=ids.map(id=>{
    const p=game.players.find(player=>player.id===id), c=avatar(p);
    const label=id===self?'Tú':'En línea';
    const current=canDraft(game,id)||canBuildFor(game,id);
    const tip=p?label+' · '+statuses[p.status]+(p.seal?' · Sello recogido':''):label;
    return '<div class="player-row'+(current?' current':'')+(['out','away'].includes(p.status)?' out':'')+'" style="--player:'+COURIERS[id].color+'" title="'+tip+'">'+portrait(p)+
      '<span><strong>'+c.name+(p.seal?' ✦':'')+'</strong><small>P'+(id+1)+' · '+label+'</small></span><span class="score">'+p.points+'</span></div>';
  }).join('');
  drawPortraitAccessories($('roster'));
}

function portrait(p) {
  return '<span class="portrait"><img alt="" src="./assets/'+avatar(p).sprite+'.png">'+
    (p.accessory!=='none'?'<canvas width="28" height="28" class="portrait-gear" data-gear="'+p.accessory+'" aria-hidden="true"></canvas>':'')+'</span>';
}

function drawPortraitAccessories(container) {
  for (const node of container.querySelectorAll('[data-gear]')) {
    const accessory=node.dataset.gear;
    drawAccessory(node.getContext('2d'),accessory,14,accessory==='cap'?4:12,.66);
  }
}

function renderLobby() {
  const station=$('station');
  station.hidden=!!game||!(mode==='host'||connectedToRoom);
  if (station.hidden) return;
  const host=mode==='host';
  const local=profiles[self]??defaultProfile(self);
  const focused=station.contains(document.activeElement)?document.activeElement.id:'';
  station.innerHTML='<div class="lobby-title"><div><h2 id="station-title">Estación de reparto</h2><p id="host-count">'+roster.length+
    ' / 4 repartidores</p></div><div id="room-invite"></div></div><div class="lobby-pads">'+COURIERS.map((slot,id)=>{
      const p=profiles[id];
      if (!roster.includes(id)||!p) return '<article class="lobby-pad vacant"><span>P'+(id+1)+'</span><div class="slot-empty"></div><p>Libre</p></article>';
      const c=avatar({id,...p});
      return '<article class="lobby-pad'+(p.ready?' ready':'')+'" style="--player:'+slot.color+'"><span>P'+(id+1)+(id===self?' · TÚ':'')+
        '</span>'+portrait({id,...p})+'<strong>'+c.name+'</strong><p>'+ (p.ready?'Listo':'Preparando')+'</p><small>'+
        (p.vote===null?'Sin voto':ARENAS[p.vote].name)+'</small></article>';
    }).join('')+'</div><div class="lobby-controls">'+
    '<label>Animal<select id="animal-choice">'+COURIERS.map((c,id)=>'<option value="'+id+'"'+(local.animal===id?' selected':'')+'>'+c.species+' · '+c.name+'</option>').join('')+'</select></label>'+
    '<label>Complemento<select id="gear-choice">'+Object.entries(ACCESSORIES).map(([key,label])=>'<option value="'+key+'"'+(local.accessory===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
    '<label>Voto de pista<select id="vote-choice"><option value=""'+(local.vote===null?' selected':'')+'>Sin voto</option>'+
    ARENAS.map((a,id)=>{
      const count=roster.filter(player=>profiles[player].vote===id).length;
      return '<option value="'+id+'"'+(local.vote===id?' selected':'')+'>'+a.name+(count?' · '+count:'')+'</option>';
    }).join('')+'</select></label></div><div class="lobby-bottom"><p id="lobby-hint"></p><div class="actions"></div></div>';
  const inviteSlot=$('room-invite');
  if (host&&hostedManually) inviteSlot.append(button('Invitar manualmente',showHost,'secondary'));
  else if (host) {
    inviteSlot.innerHTML='<label for="room-code">Código de sala</label><div class="actions"><input readonly id="room-code" class="room-code" aria-label="Código de sala"></div>'+
      '<p id="room-status" role="status"></p>';
    $('room-code').value=roomCode;
    const actions=inviteSlot.querySelector('.actions');
    if (roomCode&&!roomError) {
      actions.append(button('Copiar',()=>copyField('room-code',message=>{if($('room-status')) $('room-status').textContent=message;})));
      inviteSlot.append(button('Copiar enlace',copyRoomLink,'ghost invite-link'));
    }
    if (roomError&&roomCode) inviteSlot.append(button('Reconectar',()=>roomSession?.reconnect(),'ghost invite-link'));
    if (roomError&&!roomCode) {
      actions.append(button('Reintentar',openShortHost));
      if (!usesRoomRelay) actions.append(button('Conexión manual',showManual,'ghost'));
    }
    $('room-status').textContent=roomStatus;
  }
  $('animal-choice').onchange=event=>changeProfile({animal:Number(event.target.value)});
  $('gear-choice').onchange=event=>changeProfile({accessory:event.target.value});
  $('vote-choice').onchange=event=>changeProfile({vote:event.target.value===''?null:Number(event.target.value)});
  const actions=station.querySelector('.lobby-bottom .actions');
  const ready=button(local.ready?'Quitar listo':'Listo',()=>changeProfile({ready:!local.ready}),local.ready?'secondary':'primary');
  ready.id='ready-toggle';
  ready.setAttribute('aria-pressed',String(local.ready));
  actions.append(ready);
  if (host) {
    const rulesButton=button('Ajustes de partida',showRoomRules,'ghost');
    rulesButton.id='room-rules';
    actions.prepend(rulesButton);
    const start=button('Empezar partida',startMatch,'primary');
    start.id='host-start';
    start.disabled=!canStartRoom();
    actions.append(start);
  }
  const preferred=ARENAS[voteResult(roster,profiles,arena)].name;
  $('lobby-hint').textContent=(roster.length<2?'Comparte la sala para empezar.':canStartRoom()?'Todos listos.':'Todos deben marcarse como listos.')+' Pista: '+preferred+'.';
  const rulesSummary=document.createElement('p');
  rulesSummary.id='room-rules-summary';
  rulesSummary.textContent=`Hasta ${settings.maxRounds} ${settings.maxRounds===1?'ronda':'rondas'} · `+(settings.resetEvery
    ?`Limpieza cada ${settings.resetEvery} ${settings.resetEvery===1?'ronda':'rondas'}`:'Limpieza por votación')+
    ` · Meta ${pointLabel(settings.winPoints)}`;
  station.querySelector('.lobby-title>div').append(rulesSummary);
  drawPortraitAccessories(station);
  if (focused&&$(focused)) $(focused).focus({preventScroll:true});
}

const scoreKeys=[
  ['goal','Entrega','#7ce4ba'],['first','Primero','#fbca74'],['trap','Trampa','#ff956e'],['style','Estilo','#c2a8fc'],
];

function renderScores(sheet,g) {
  const goal=g.rules?.winPoints??MAX_SCORE;
  const total=Math.max(goal,...g.players.map(p=>p.points));
  const legend=scoreKeys.map(([,label,color])=>'<span style="--reason:'+color+'"><i></i>'+label+'</span>').join('');
  sheet.innerHTML='<div class="score-title"><div><h2></h2><span>Ronda '+g.round+'</span></div>'+
    '<span class="goal-tag">Meta '+goal+'</span></div><div class="legend">'+legend+'</div>';
  sheet.querySelector('h2').textContent=g.result;
  const scores=document.createElement('div');
  scores.className='scoreboard';
  for (const p of g.players) {
    const c=avatar(p);
    const row=document.createElement('div');
    row.className='score-row';
    const stamps=[];
    for (const round of ['past','new']) for (const [key,,color] of scoreKeys) {
      const count=round==='new'?p.score[key]:p.totalScore[key]-p.score[key];
      for (let i=0;i<count;i++) stamps.push({color,round});
    }
    const bars=Array.from({length:total},(_,i)=>{
      const stamp=stamps[i];
      return '<i class="stamp'+(stamp?' '+stamp.round:'')+(i===goal-1?' finish-cell':'')+'"'+
        (stamp?' style="--stamp:'+stamp.color+';--i:'+i+'"':'')+'></i>';
    }).join('');
    const reasons=scoreKeys.filter(([key])=>p.score[key]).map(([key,label])=>label+' +'+p.score[key]).join(' · ');
    row.innerHTML='<strong>'+portrait(p)+'<span>P'+(p.id+1)+' '+c.name+'</span></strong><div class="score-track" style="--cells:'+Math.min(total,25)+
      '" aria-hidden="true">'+bars+'</div><strong class="score-total">'+p.points+'</strong><div class="breakdown">'+(p.connected?(reasons||'+0 esta ronda'):'Desconectado')+'</div>';
    scores.append(row);
  }
  sheet.append(scores);
  drawPortraitAccessories(sheet);
}

function renderPodium(sheet,g) {
  if (sheet.dataset.podiumMatch===g.match) return;
  sheet.dataset.podiumMatch=g.match;
  const standings=g.standings??rankPlayers(g.players);
  const podium=standings.filter(entry=>entry.rank<=3);
  const classic=podium.map(entry=>entry.rank).join() === '1,2,3';
  const highestRank=Math.max(1,...podium.map(entry=>entry.rank));
  sheet.style.setProperty('--winner-reveal',(highestRank-1)*200+'ms');
  sheet.innerHTML='<div class="podium-header"><h2>Podio</h2><p></p></div><div class="podium-confetti" aria-hidden="true"></div>';
  sheet.querySelector('p').textContent=g.result;
  const particles=sheet.querySelector('.podium-confetti');
  for (let i=0;i<20;i++) {
    const piece=document.createElement('i');
    piece.style.setProperty('--x',((i*37)%100)+'%');
    piece.style.setProperty('--drift',((i*19)%96-48)+'px');
    piece.style.setProperty('--lag',(i%6)*55+'ms');
    particles.append(piece);
  }
  const steps=document.createElement('ol');
  steps.className='podium'+(classic?' podium-classic':'');
  steps.style.setProperty('--columns',Math.max(1,podium.length));
  for (const {id,rank} of podium) {
    const player=g.players.find(p=>p.id===id);
    const step=document.createElement('li');
    step.dataset.rank=rank;
    step.style.setProperty('--arrival',(highestRank-rank)*200+'ms');
    step.innerHTML=portrait(player)+
      `<strong>P${id+1} ${avatar(player).name}</strong><div class="podium-step"><span aria-label="Puesto ${rank}">${rank}</span><small>${pointLabel(player.points)}</small></div>`;
    steps.append(step);
  }
  sheet.append(steps);
  for (const {id,rank} of standings.filter(entry=>entry.rank>3)) {
    const player=g.players.find(p=>p.id===id);
    const row=document.createElement('p');
    row.className='podium-remaining';
    row.textContent=`${rank}º · P${id+1} ${avatar(player).name} · ${pointLabel(player.points)}`;
    sheet.append(row);
  }
  drawPortraitAccessories(sheet);
  if (mode==='host') sheet.append(button('Volver al lobby',()=>{
    game=null;
    profiles=Object.fromEntries(roster.map(id=>[id,{...profiles[id],ready:false}]));
    broadcastLobby(true);
  },'primary'));
}

function renderWork() {
  const work=$('work'), sheet=$('sheet'), g=game;
  work.replaceChildren();
  work.hidden=true;
  const phase=g?.phase;
  const finale=phase==='result'&&g.over;
  sheet.hidden=!['draft','result'].includes(phase);
  sheet.classList.remove('entry');
  sheet.classList.toggle('crate',phase==='draft');
  sheet.classList.toggle('podium-sheet',finale);
  if (!finale&&sheet.dataset.podiumMatch) {
    delete sheet.dataset.podiumMatch;
    sheet.style.removeProperty('--winner-reveal');
  }
  if (phase==='draft') {
    const currentDraft=g.match+'/'+g.round;
    if (draftKey!==currentDraft) {
      draftKey=currentDraft;
      sheet.classList.add('entry');
      cursors.clear();
      for (const [index,p] of g.players.entries()) cursors.set(p.id,g.lot[index]);
    }
    const own=canDraft(g,self);
    sheet.innerHTML='<div class="crate-top"><div class="crate-label"><h2>Caja de reparto</h2></div><button id="skip-pick" class="ghost">Pasar</button></div>'+
      '<p class="crate-instruction">'+(own?'La primera persona que coja una pieza se la queda.':'Esperando a que el resto coja su pieza.')+'</p>';
    $('skip-pick').hidden=!own;
    $('skip-pick').onclick=()=>act('skip');
    const catalog=document.createElement('div');
    catalog.className='catalog';
    for (const [i,kind] of g.lot.entries()) {
      const item=PIECES[kind], owner=Object.keys(g.picks).find(id=>g.picks[id]===kind);
      const taken=owner!==undefined;
      const courier=taken?avatar(g.players.find(p=>p.id===Number(owner))):null;
      const node=button(taken?'P'+(Number(owner)+1)+' · '+courier.name:item.name,()=>act(kind),'piece'+(taken?' taken':''));
      node.title=taken?courier.name+' se llevó '+item.name:item.detail;
      node.dataset.piece=kind;
      node.style.setProperty('--i',i);
      node.disabled=!own||taken;
      const img=document.createElement('img');
      img.src=taken?'./assets/'+courier.sprite+'.png':pieceURL(kind);
      img.alt='';
      const markers=document.createElement('span');
      markers.className='cursors';
      markers.setAttribute('aria-hidden','true');
      node.prepend(img);
      node.append(markers);
      catalog.append(node);
    }
    sheet.append(catalog);
    const caption=document.createElement('div');
    caption.className='crate-bottom';
    if (own) {
      caption.textContent='Toca una pieza o elígela con ← → y confirma con ↑.';
    } else {
      const choice=g.picks[self];
      caption.textContent=choice?'Has cogido '+PIECES[choice].name+'.':'Has pasado.';
    }
    sheet.append(caption);
    markCursors();
  } else if (finale) renderPodium(sheet,g);
  else if (phase==='result') renderScores(sheet,g);
  else if (phase==='build') {
    work.hidden=false;
    const id=builder();
    if (id===undefined) {
      const wait=document.createElement('p');
      wait.textContent='Esperando al resto de la cuadrilla.';
      work.append(wait);
      return;
    }
    const kind=g.picks[id], item=PIECES[kind];
    const tools=document.createElement('div');
    tools.className='build-tools';
    tools.innerHTML='<div class="placement"><img src="'+pieceURL(kind)+'" alt=""><span><strong>'+item.name+'</strong><small>'+item.detail+'</small></span></div>';
    if (DIRECTIONAL.has(kind)) {
      const flip=button(pointFor(id).face===1?'Girar →':'Girar ←',()=>{
        const point=pointFor(id);
        buildPoints.set(id,{...point,face:-point.face});
        flip.textContent=point.face===1?'Girar ←':'Girar →';
      });
      tools.append(flip);
    }
    tools.append(button('Pasar',()=>act('skip'),'ghost'));
    work.append(tools);
  }
}

function syncUI() {
  const g=game, phase=g?.phase;
  const key=JSON.stringify([mode,arena,self,roster,!g&&profiles,!g&&settings,!g&&roomCode,!g&&roomStatus,!g&&roomError,connectedToRoom,
    g?.match,g?.round,phase,g?.over,g?.finishedBuilding,g?.picks,g?.players.map(p=>[p.points,p.status,p.seal])]);
  const nextBuild=phase==='build'?g.match+'/'+g.round:'';
  if (buildKey!==nextBuild) {
    buildPoints.clear();
    keys.clear();
    releaseBuildDrag();
    buildKey=nextBuild;
  }
  if (uiKey!==key) {
    uiKey=key;
    const waiting=mode==='host'||mode==='guest';
    const menu=!g&&!waiting;
    document.body.dataset.phase=phase??(menu?'menu':'lobby');
    $('start-screen').hidden=!menu;
    $('match-hud').hidden=!g;
    $('controls').hidden=!g;
    $('exit').hidden=mode==='menu';
    $('stage').classList.toggle('build',builder()!==undefined);
    $('arena-label').textContent=ARENAS[g?.arena??arena].name;
    $('round-label').textContent=g?'RONDA '+g.round+' / '+(g.rules?.maxRounds??MAX_ROUNDS):'SALA EN LÍNEA';
    $('phase').textContent={draft:'SELECCIÓN',build:'CONSTRUCCIÓN',countdown:'PREPARACIÓN',race:'CARRERA',result:g?.over?'FIN DE PARTIDA':'RESULTADOS'}[phase]??'SALA P2P';
    const goal=g?.rules?.winPoints??MAX_SCORE;
    const finale=g?.over&&(g.players.some(p=>p.points>=goal)?'META DE PUNTOS ALCANZADA':'LÍMITE DE RONDAS ALCANZADO');
    $('phase-note').textContent=phase==='draft'?(g.objectsReset?'OBJETOS REINICIADOS · ':'CAJA ABIERTA · ')+g.offer.length+' DISPONIBLES':phase==='build'?
      g.players.filter(p=>canBuildFor(g,p.id)).length+' POR COLOCAR'
      :phase==='race'?'ENTREGA TU PAQUETE · ✦ SELLO DE ESTILO'
        :phase==='result'?finale||'SIGUIENTE RONDA EN BREVE':g?`${goal} ${goal===1?'PUNTO':'PUNTOS'} PARA GANAR`:'ESPERANDO A LA CUADRILLA';
    $('game-overlay').hidden=phase!=='countdown';
    $('overlay-title').textContent='';
    $('overlay-text').textContent='Prepárate para correr';
    $('timer').hidden=!g||!!g.over;
    let pad='';
    if (touchDevice.matches) {
      if (phase==='race'&&g.players.some(p=>p.id===self&&p.status==='running')) pad='race';
      else if (canBuildFor(g,self)) pad='build';
    }
    if (touchPhase!==pad) {
      clearTouch();
      touchPhase=pad;
      $('touch').hidden=pad!=='race';
      $('touch-build').hidden=pad!=='build';
      if (pad==='build') $('touch-place').textContent=g.picks[self]==='trash'?'Borrar':'Colocar';
      $('stage').classList.toggle('touch-build-active',pad==='build');
      sendInput();
    }
    countText='';
    if (g) renderRoster();
    renderLobby();
    renderWork();
  }
  syncResetVote(g);
  if (g&&!g.over) {
    const seconds=Math.max(0,Math.ceil(g.deadline-g.elapsed));
    $('timer').textContent=seconds+' s';
    $('timer').classList.toggle('urgent',seconds<=4);
    if (phase==='countdown'&&countText!==String(seconds)) {
      countText=String(seconds);
      const number=document.createElement('span');
      number.textContent=countText;
      number.className='count-hit';
      $('overlay-title').replaceChildren(number);
    } else if (phase==='race'&&g.elapsed<=.58) {
      $('game-overlay').hidden=false;
      if (countText!=='¡YA!') {
        countText='¡YA!';
        const cue=document.createElement('span');
        cue.className='count-hit';
        cue.textContent=countText;
        $('overlay-title').replaceChildren(cue);
        $('overlay-text').textContent='';
      }
    } else if (phase==='race') {
      $('game-overlay').hidden=true;
    }
  }
}
const TICK=1/120;
const SEND_INTERVAL=1000/30;
let accumulator=0;
function frame(now) {
  const dt=Math.min((now-lastFrame)/1000,.1);
  accumulator+=dt;
  lastFrame=now;
  if (game&&mode==='host') {
    while (accumulator>=TICK) {
      step(game,hostInputs(),TICK);
      accumulator-=TICK;
    }
    publishState();
  } else accumulator=0;
  syncUI();
  moveBuildCursors(dt);
  if (now>=nextMotion) {
    nextMotion+=SEND_INTERVAL;
    if (now-nextMotion>=SEND_INTERVAL) nextMotion=now+SEND_INTERVAL;
    broadcastPreview();
    if (game&&mode==='host'&&!game.over) {
      const packet=motionPacket(game);
      for (const link of activeLinks()) link.sendMotion(packet);
    }
  }
  if (mode==='guest'&&now>=nextInput) {
    nextInput=now+200;
    sendInput(true);
  }
  if (game?.match!==lastMatch) {
    lastMatch=game?.match;
    lastEvent=0;
  }
  if (game&&game.event.id!==lastEvent) {
    lastEvent=game.event.id;
    tone(game.event.sound);
  }
  const shownArena=game?.arena??(mode==='host'||connectedToRoom?voteResult(roster,profiles,arena):arena);
  ctx.setTransform(1,0,0,1,0,0);
  paintBackdrop(ctx,shownArena,canvas.width,canvas.height,now/1000);
  const {x,y,scale}=canvasView;
  ctx.setTransform(scale,0,0,scale,x,y);
  const view=mode==='guest'&&game?motion.view(game,now):game;
  paint(ctx,view,shownArena,visiblePlacements(view),now/1000,self,false);
  requestAnimationFrame(frame);
}
const roomParams=new URLSearchParams(location.search);
const linkedRoom=normalizeCode(roomParams.get('sala')??'');
if (validCode(linkedRoom)) {
  const linkedVersion=roomParams.get('v');
  showShortGuest(linkedRoom,linkedVersion&&Number(linkedVersion)!==ROOM_VERSION?
    'El enlace se creó con otra versión del juego. Pide al anfitrión que recargue la página y cree una sala nueva.':'');
}
requestAnimationFrame(frame);
