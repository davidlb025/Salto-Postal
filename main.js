import {
  ARENAS, COURIERS, ACCESSORIES, avatar, defaultProfile, editProfile, voteResult, gameArena,
  PIECES, DIRECTIONAL, WIDTH, HEIGHT, MAX_ROUNDS, ROUND_LIMIT, MAX_SCORE, SCORE_LIMIT,
  MOVEMENT_MIN, MOVEMENT_MAX, DEFAULT_WEIGHTS, MAX_PLAYERS, PICK_SECONDS, RACE_SECONDS, RACE_TICK,
  roomRules, newGame, canVoteReset, voteReset, resetVoteStatus, rankPlayers,
  pieceAt, canPlace, trashTarget, canDraft, canBuildFor, setPreview, draft, build, disconnect, step,
  beginRace, stepRaceRunner, settleRunner, finishRace, triggerRacePiece, ferryPosition,
} from './game.js?v=24';
import { paint, paintBackdrop, drawPortraitOutfit } from './render.js?v=24';
import { MAP_FORMAT_VERSION, arenaFromMap, downloadMap, readMap, readMapFile } from './map-data.js?v=10';
import { openMapEditor } from './map-editor.js?v=24';
import { pieceURL } from './props.js?v=11';
import { ROOM_VERSION, createLink, shortSession, peerLink, normalizeCode, validCode, setRelay, clearRelay, hasRelay } from './network.js?v=15';
import { relaySession, usesRoomRelay as usesWebSocketRelay } from './relay.js?v=15';
import { managedSession, usesManagedRooms } from './managed-room.js?v=16';
import { BuildMotion, RemoteRunners, motionPacket, raceTick, readRunnerPose, stateVersion } from './motion.js?v=24';

const usesRoomRelay=usesWebSocketRelay||usesManagedRooms;
const openRoomSession=usesWebSocketRelay?relaySession:usesManagedRooms?managedSession:shortSession;

const $ = id=>document.getElementById(id);
const validSeat=id=>Number.isInteger(id)&&id>=0&&id<MAX_PLAYERS;
const guestSeats=Array.from({length:MAX_PLAYERS-1},(_,i)=>i+1);
const canvas=$('game'), ctx=canvas.getContext('2d'), dialog=$('dialog'), playfield=$('playfield');
const touchDevice=matchMedia('(pointer: coarse) and (hover: none)');
const touchLayoutKey='salto-postal-touch-layout';
const keys=new Set(),touch=new Map();
let touchPhase='',jumpQueued=false;
const links=new Map();
const cursors=new Map();
const buildPoints=new Map();
const buildMotion=new BuildMotion();
const remoteRunners=new RemoteRunners();
const pendingRaceMessages=[];
const runnerPoses=new Map();
const RACE_PROTOCOL=3;
const RACE_TICK_MS=RACE_TICK*1000;
const FINISH_GRACE=1500,RESULT_HOLD=180;
const RACE_PROTOCOL_NOTICE='Recarga el juego y pide a toda la sala que use la misma versión.';
let raceStart=null,bestClockRtt=Infinity,nextClockProbe=0,endingRace=null;
let publishedState='',nextMotion=0;
let profiles={0:defaultProfile(0)}, roomStatus='', roomError=false, connectedToRoom=false;
let settings=roomRules(),buildDrag=null;
let sentPreview='',sentPreviewAt=0,canvasView={scale:1,x:0,y:0};
let roomSession=null,roomCode='',hostedManually=false;
let roomMap=null,roomMapKey='',roomMapRevision=0;
let mode='menu', game=null, arena=0, self=0, roster=[0];
const effects=new Map([
  'pick','place','scrap','reject','start','go','jump','spring',
  'crack','arm','hit','seal','finish','round','fail','podium',
].map(kind=>[kind,null]));
let muted=false,audio,soundGain,soundMatch,soundPhase,lastEvent=0,lastFrame=performance.now();
let uiKey='', buildKey='', draftKey='', dialogPage='', pending=null, hostLink=null, countText='';

const button = (label, action, cls='secondary')=>{
  const node=document.createElement('button');
  node.className=cls;
  node.textContent=label;
  node.onclick=action;
  return node;
};

function loadEffect(kind) {
  const cached=effects.get(kind);
  if (cached) return cached;
  const pending=fetch(new URL(`./assets/sfx/${kind}.mp3`,import.meta.url))
    .then(response=>{
      if (!response.ok) throw new Error(`Sound ${kind}: ${response.status}`);
      return response.arrayBuffer();
    })
    .then(bytes=>audio.decodeAudioData(bytes))
    .catch(()=>{
      effects.set(kind,null);
      return null;
    });
  effects.set(kind,pending);
  return pending;
}

function playEffect(kind) {
  if (!audio||muted||audio.state!=='running'||!effects.has(kind)) return;
  const requestedAt=performance.now();
  loadEffect(kind).then(buffer=>{
    if (!buffer||muted||audio.state!=='running'||performance.now()-requestedAt>250) return;
    const source=audio.createBufferSource();
    source.buffer=buffer;
    source.connect(soundGain);
    source.start();
  });
}

function enableAudio() {
  if (muted) return;
  const AudioEngine=globalThis.AudioContext??globalThis.webkitAudioContext;
  if (!AudioEngine) return;
  if (!audio) {
    audio=new AudioEngine();
    soundGain=audio.createGain();
    soundGain.gain.value=.7;
    soundGain.connect(audio.destination);
    for (const kind of effects.keys()) loadEffect(kind);
  }
  if (audio.state!=='running') audio.resume().catch(()=>{});
}
window.addEventListener('pointerdown',enableAudio);
window.addEventListener('keydown',enableAudio);
$('sound').onclick=()=>{
  muted=!muted;
  $('sound').setAttribute('aria-pressed',String(!muted));
  if (soundGain) soundGain.gain.value=muted?0:.7;
  if (!muted) enableAudio();
};

const disclosures=[$('match-details'),$('game-options')];
function closeDisclosure(details,restoreFocus=false) {
  if (!details.open) return;
  details.open=false;
  if (restoreFocus) details.querySelector('summary').focus({preventScroll:true});
}
for (const details of disclosures) {
  details.querySelector('summary').addEventListener('click',()=>{
    clearInputs();
    for (const other of disclosures) if (other!==details) closeDisclosure(other);
  });
  details.addEventListener('keydown',event=>{
    if (event.key==='Escape'&&details.open) {
      event.preventDefault();
      closeDisclosure(details,true);
    }
  });
}
document.addEventListener('pointerdown',event=>{
  for (const details of disclosures) if (!details.contains(event.target)) closeDisclosure(details);
});
$('game-options').addEventListener('click',event=>{
  if (event.target.closest('button')) closeDisclosure($('game-options'),true);
},{capture:true});

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
    ${touchDevice.matches?'<p>En <strong>Opciones → Controles táctiles</strong> puedes elegir flechas o joystick.</p>':''}`);
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
  if (mode!=='host'||!game||game.phase==='race') return;
  if (game.phase==='countdown'&&!Number.isFinite(game.raceStartsAt)) {
    resetRaceNetwork();
    raceStart=game.raceStartsAt=performance.now()+(game.deadline-game.elapsed)*1000;
  }
  const version=stateVersion(game);
  if (version===publishedState) return;
  publishedState=version;
  sendAll({type:'state',game});
}
function broadcastLobby(returnToLobby=false) {
  roster=[0,...activeLinks().map(link=>link.id)].sort((a,b)=>a-b);
  profiles=Object.fromEntries(roster.map(id=>[id,profiles[id]??defaultProfile(id)]));
  const selected=voteResult(roster,profiles,arena);
  for(const link of activeLinks()) {
    link.send({type:'lobby',raceProtocol:RACE_PROTOCOL,id:link.id,roster,arena:selected,profiles,rules:settings,returnToLobby,customMap:roomMap});
  }
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
  return roster.length>=2&&roster.every(id=>profiles[id]?.ready)&&!waitingForMapSupport()&&activeLinks().every(link=>link.supportsRace);
}
function waitingForMapSupport() {
  return mode==='host'&&!!roomMap&&activeLinks().some(link=>!link.supportsMaps);
}
function setRoomMap(map) {
  const key=map?JSON.stringify(map):'';
  if (key===roomMapKey) return;
  roomMap=map;
  roomMapKey=key;
  roomMapRevision++;
}

function useRoomMap(map) {
  if (mode!=='host'||game) return;
  setRoomMap(map);
  profiles=Object.fromEntries(roster.map(id=>[id,{...profiles[id],ready:false}]));
  broadcastLobby();
}

function showRoomMap() {
  if (mode!=='host'||game) return;
  modal('Mapa de la sala','room-map',`
    <p id="room-map-current"></p>
    <div class="actions">
      <button id="import-room-map" class="primary">Cargar archivo JSON</button>
      <button id="edit-room-map">${roomMap?'Editar mapa':'Crear mapa'}</button>
      ${roomMap?'<button id="remove-room-map" class="ghost">Quitar mapa personalizado</button>':''}
    </div>
    <input type="file" id="room-map-file" accept=".json,application/json" hidden>
    <p id="room-map-status" role="status"></p>`);
  $('room-map-current').textContent=roomMap?roomMap.name:'Crea un mapa o carga un archivo de Salto Postal. Todos jugarán en esa pista.';
  const fileInput=$('room-map-file');
  const status=$('room-map-status');
  let upload=0;
  $('import-room-map').onclick=()=>fileInput.click();
  fileInput.onchange=async()=>{
    const file=fileInput.files[0];
    fileInput.value='';
    if (!file) return;
    const attempt=++upload;
    try {
      const map=await readMapFile(file);
      if (attempt!==upload||!dialog.open||dialogPage!=='room-map'||$('room-map-file')!==fileInput||mode!=='host'||game) return;
      useRoomMap(map);
      dialog.close();
    } catch (error) { if (attempt===upload) status.textContent=error.message; }
  };
  $('edit-room-map').onclick=()=>{
    dialog.close();
    openMapEditor({map:roomMap,onUse:useRoomMap});
  };
  if (roomMap) $('remove-room-map').onclick=()=>{
    useRoomMap(null);
    dialog.close();
  };
}
$('create-map').onclick=()=>openMapEditor();
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
      <div class="rules-fields">
        ${field('pickTime','Elegir piezas (s)',PICK_SECONDS.min,PICK_SECONDS.max)}
        ${field('raceTime','Carrera (s)',RACE_SECONDS.min,RACE_SECONDS.max)}
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
      pickTime:form.elements.pickTime.valueAsNumber,
      raceTime:form.elements.raceTime.valueAsNumber,
      weights:Object.fromEntries(weights.map(input=>[input.name,input.valueAsNumber])),
    });
    broadcastLobby();
    dialog.close();
  };
}
function startMatch() {
  if (mode!=='host'||game||!canStartRoom()) return;
  arena=voteResult(roster,profiles,arena);
  game=newGame(roster,arena,profiles,settings,roomMap);
  resetRaceNetwork();
  lastEvent=0;
  buildPoints.clear();
  clearInputs();
  publishState();
}
function resetRaceNetwork() {
  buildMotion.reset();
  remoteRunners.reset();
  pendingRaceMessages.length=0;
  runnerPoses.clear();
  raceStart=null;
  bestClockRtt=Infinity;
  nextClockProbe=0;
  endingRace=null;
}
function reset() {
  const peers=[...links.values(),hostLink].filter(Boolean);
  mode='menu';
  game=null;
  resetRaceNetwork();
  publishedState='';
  roster=[0];
  self=0;
  profiles={0:defaultProfile(0)};
  settings=roomRules();
  setRoomMap(null);
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
  const id=guestSeats.find(slot=>!links.has(slot));
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
    if (mode!=='host') return;
    if (game) disconnectPlayer(id);
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
  $('manual-count').textContent=`${roster.length} de ${MAX_PLAYERS} en la cuadrilla`;
  if ($('invite')) {
    $('invite').disabled=!!pending||roster.length===MAX_PLAYERS;
    $('exchange').hidden=!pending;
  }
}
function onHostMessage(link,message) {
  if (!link.open) return;
  if (!game) {
    if (message.type==='map-support'&&message.version===MAP_FORMAT_VERSION) {
      if (message.raceProtocol!==RACE_PROTOCOL) {
        link.send({type:'reject',reason:RACE_PROTOCOL_NOTICE});
        setTimeout(()=>link.close(),350);
        return;
      }
      link.supportsMaps=true;
      link.supportsRace=true;
      return;
    }
    if (link.supportsRace&&message.type==='profile'&&message.patch&&typeof message.patch==='object'&&profiles[link.id]) {
      profiles[link.id]=editProfile(profiles[link.id],message.patch);
      broadcastLobby();
    }
    return;
  }
  if (message.match!==game.match||message.round!==game.round) return;
  if (message.type==='runner-clock'&&raceStart!==null&&Number.isFinite(message.sent)) {
    link.send({type:'runner-clock',match:game.match,round:game.round,sent:message.sent,
      now:performance.now()});
    return;
  }
  if (message.type==='reset-vote') {
    if (voteReset(game,link.id,message.vote)) publishState();
    return;
  }
  if (receiveRaceMessage(message,link.id)) return;
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
  if (pending || roster.length===MAX_PLAYERS) return;
  const id=guestSeats.find(i=>!links.has(i));
  let link;
  try {
    link=createLink(id,()=>{
      if (pending===link) pending=null;
      broadcastLobby();
      setStatus(COURIERS[id].name+' se ha unido.');
    },()=>{
      links.delete(id);
      if(pending===link) pending=null;
      if (mode!=='host') return;
      if(game) disconnectPlayer(id);
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

function receiveGuest(link,message) {
  if (mode!=='guest'||link!==hostLink) return;
  if (message.type==='lobby'&&Array.isArray(message.roster)&&validSeat(message.id)&&message.profiles) {
    if (message.raceProtocol!==RACE_PROTOCOL) {
      reset();
      modal('Actualiza el juego','notice','<p>'+RACE_PROTOCOL_NOTICE+'</p>');
      return;
    }
    if (dialogPage==='short-guest') dialog.close();
    if (!link.announcedMaps) {
      link.announcedMaps=true;
      link.send({type:'map-support',version:MAP_FORMAT_VERSION,raceProtocol:RACE_PROTOCOL});
    }
    try { setRoomMap(message.customMap?readMap(message.customMap):null); }
    catch { return; }
    self=message.id;
    roster=message.roster.filter(validSeat);
    profiles=message.profiles;
    settings=roomRules(message.rules);
    connectedToRoom=true;
    if (message.returnToLobby) {
      game=null;
      resetRaceNetwork();
    }
    if (ARENAS[message.arena]) arena=message.arena;
    return;
  }
  if (message.type==='state'&&message.game?.players&&ARENAS[message.game.arena]) {
    const next=message.game;
    const sameRound=game?.match===next.match&&game.round===next.round;
    if (sameRound&&game.phase==='race'&&next.phase!=='result') return;
    if (next.customMap) {
      try { next.customMap=game?.match===next.match&&game.customMap?game.customMap:readMap(next.customMap); }
      catch { return; }
    }
    const now=performance.now();
    if (!sameRound) resetRaceNetwork();
    if (next.phase==='countdown') {
      raceStart??=now+(next.deadline-next.elapsed)*1000;
    }
    if (sameRound&&next.phase==='result'&&game.phase==='race') {
      showRaceEnd(next,game.events,now,game.players.find(p=>p.id===self));
    }
    if (sameRound&&game.phase===next.phase) next.elapsed=Math.max(game.elapsed,next.elapsed);
    game=next;
    return;
  }
  if (message.type==='claimed'||message.type==='blocked') playEffect('reject');
  if (!game||message.match!==game.match||message.round!==game.round) return;
  const now=performance.now();
  if (message.type==='runner-clock'&&game.phase==='countdown'&&Number.isFinite(game.raceStartsAt)&&Number.isFinite(message.now)) {
    const rtt=now-message.sent;
    if (rtt>=0&&rtt<bestClockRtt&&rtt<1500) {
      bestClockRtt=rtt;
      raceStart=game.raceStartsAt-message.now+(message.sent+now)/2;
    }
    return;
  }
  if (message.type==='motion'&&message.phase==='race'&&Array.isArray(message.runners)) {
    if (game.phase==='race'&&message.runners.length<=MAX_PLAYERS) {
      for (const row of message.runners) {
        if (!Array.isArray(row)) continue;
        const [seat,elapsed,pose]=row;
        receiveRaceMessage({type:'motion',phase:'race',seat,elapsed,pose});
      }
    }
    return;
  }
  if (receiveRaceMessage(message)) return;
  if (message.type==='motion'&&message.phase===game.phase&&Number.isFinite(message.elapsed)) {
    if (game.phase==='build') buildMotion.push(game,message,now);
    if (game.phase==='countdown') {
      if (!Number.isFinite(bestClockRtt)) raceStart=Math.min(raceStart,now+(game.deadline-message.elapsed)*1000);
    } else game.elapsed=Math.max(game.elapsed,message.elapsed);
  }
}

function clearInputs() {
  keys.clear();
  clearTouch();
  releaseBuildDrag();
}
function clearTouch() {
  const held=[...touch];
  touch.clear();
  jumpQueued=false;
  for (const [id,{node}] of held) {
    releaseTouchControl(node);
    if (typeof id==='number'&&node.hasPointerCapture(id)) node.releasePointerCapture(id);
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
const gameKeys=new Set(['Space','KeyA','KeyD','KeyW','ArrowLeft','ArrowRight','ArrowUp']);
window.addEventListener('keydown',event=>{
  if(dialog.open||!game||event.target.closest?.('.game-header details[open]')) return;
  if (game.phase==='build') {
    buildKeypress(event);
    return;
  }
  if(!gameKeys.has(event.code) ||
    (event.code==='Space' && document.activeElement?.matches('button,summary'))) return;
  event.preventDefault();
  if (game.phase==='draft') {
    draftKeypress(event);
    return;
  }
  if (!event.repeat&&!(ownInput()&4)&&['Space','KeyW','ArrowUp'].includes(event.code)) jumpQueued=true;
  keys.add(event.code);
});
window.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',clearInputs);
document.addEventListener('visibilitychange',()=>{if(document.hidden) clearInputs();});
window.addEventListener('resize',()=>{
  releaseBuildDrag();
  if (touch.size) clearTouch();
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
    if (event.button!==0||!touchDevice.matches||dialog.open||
      game?.phase!==phase||touchPhase!==phase||(stick&&node.hasAttribute('data-pressed'))) return;
    const press={node,phase,bit:Number(node.dataset.key)};
    if (stick) {
      const rect=node.getBoundingClientRect();
      press.centerX=rect.left+rect.width/2;
      press.centerY=rect.top+rect.height/2;
      press.radius=rect.width*.27;
      press.bit=steerStick(press,event);
    }
    if (phase==='race'&&press.bit===4&&!(ownInput()&4)) jumpQueued=true;
    node.setPointerCapture(event.pointerId);
    touch.set(event.pointerId,press);
    node.setAttribute('data-pressed','');
    if (phase==='build'&&!stick) shiftBuildCursor(Number(press.bit===2)-Number(press.bit===1),Number(press.bit===8)-Number(press.bit===4),8);
  });
  if (stick) node.addEventListener('pointermove',event=>{
    const press=touch.get(event.pointerId);
    if (press?.node!==node) return;
    const bit=steerStick(press,event);
    if (press.bit===bit) return;
    press.bit=bit;
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) node.addEventListener(type,event=>{
    if (!touch.delete(event.pointerId)) return;
    if (![...touch.values()].some(press=>press.node===node)) releaseTouchControl(node);
  });
  if (!stick) node.addEventListener('click',event=>{
    if (event.detail!==0||dialog.open||game?.phase!==phase||touchPhase!==phase) return;
    const bit=Number(node.dataset.key);
    if (phase==='build') shiftBuildCursor(Number(bit===2)-Number(bit===1),Number(bit===8)-Number(bit===4),8);
    else if (bit===4) jumpQueued=true;
    else {
      const press={node,phase,bit};
      touch.set(node,press);
      node.setAttribute('data-pressed','');
      setTimeout(()=>{
        if (touch.get(node)!==press) return;
        touch.delete(node);
        if (![...touch.values()].some(held=>held.node===node)) releaseTouchControl(node);
      },180);
    }
  });
  node.addEventListener('contextmenu',event=>event.preventDefault());
}
$('touch-place').onclick=()=>confirmPlacement(self);
$('build-skip').onclick=()=>act('skip');
$('build-flip').onclick=()=>{
  const point=pointFor(self);
  const face=-point.face;
  buildPoints.set(self,{...point,face});
  showBuildDirection(face);
};
function showBuildDirection(face) {
  $('build-flip').textContent=face===1?'Girar →':'Girar ←';
  $('build-flip').setAttribute('aria-label',face===1?'Girar. Apunta a la derecha.':'Girar. Apunta a la izquierda.');
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
  const fieldWidth=playfield.clientWidth, fieldHeight=playfield.clientHeight;
  if (!width||!height||!fieldWidth||!fieldHeight) return;
  const ratio=Math.min(devicePixelRatio,1920/width,1260/height);
  const w=Math.round(width*ratio),h=Math.round(height*ratio);
  if (canvas.width!==w||canvas.height!==h) {
    canvas.width=w;
    canvas.height=h;
  }
  const scaleX=w/width, scaleY=h/height;
  const scale=Math.min(fieldWidth*scaleX/WIDTH,fieldHeight*scaleY/HEIGHT);
  canvasView={scale,x:(playfield.offsetLeft+fieldWidth/2)*scaleX-WIDTH*scale/2,
    y:(playfield.offsetTop+fieldHeight/2)*scaleY-HEIGHT*scale/2};
}
const canvasObserver=new ResizeObserver(resizeCanvas);
canvasObserver.observe(canvas);
canvasObserver.observe(playfield);
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
  else if (preview) {
    const message=preview.part.kind==='trash'?'Apunta a una pieza para borrarla.':'La pieza no cabe aquí. Prueba otro lugar.';
    $('placement-status').textContent=message;
    playEffect('reject');
  }
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
  full.textContent=active?'Salir de pantalla completa':'Pantalla completa';
});

function renderRoster(g) {
  const statuses={away:'Desconectado',ready:'Preparado',running:'En carrera',out:'Eliminado',done:'Entregado'};
  const ids=g.players.map(p=>p.id);
  $('roster').innerHTML=ids.map(id=>{
    const p=g.players.find(player=>player.id===id), c=avatar(p);
    const current=canDraft(g,id)||canBuildFor(g,id);
    const identity=id===self?'Tú':'P'+(id+1);
    return '<div role="listitem" class="player-row'+(current?' current':'')+(['out','away'].includes(p.status)?' out':'')+'" style="--player:'+COURIERS[id].color+'">'+portrait(p)+
      '<span><strong>'+c.name+(p.seal?' <span aria-label="Sello recogido">✦</span>':'')+'</strong><small>'+identity+' · '+statuses[p.status]+'</small></span><span class="score">'+p.points+' <span class="visually-hidden">puntos</span></span></div>';
  }).join('');
  drawPortraitAccessories($('roster'));
}

function portrait(p) {
  return '<span class="portrait"><img alt="" src="./assets/'+avatar(p).sprite+'.png">'+
    (p.accessory!=='none'?`<canvas width="28" height="28" class="portrait-gear" data-gear="${p.accessory}" data-sprite="${avatar(p).sprite}" aria-hidden="true"></canvas>`:'')+'</span>';
}

function drawPortraitAccessories(container) {
  for (const node of container.querySelectorAll('[data-gear]')) {
    drawPortraitOutfit(node.getContext('2d'),node.dataset.gear,node.dataset.sprite);
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
    ` / ${MAX_PLAYERS} repartidores</p></div><div id="room-invite"></div></div><div class="lobby-pads">`+COURIERS.slice(0,MAX_PLAYERS).map((slot,id)=>{
      const p=profiles[id];
      if (!roster.includes(id)||!p) return '<article class="lobby-pad vacant"><span>P'+(id+1)+'</span><div class="slot-empty"></div><p>Libre</p></article>';
      const c=avatar({id,...p});
      const vote=roomMap?'':'<small>'+(p.vote===null?'Sin voto':ARENAS[p.vote].name)+'</small>';
      return '<article class="lobby-pad'+(p.ready?' ready':'')+'" style="--player:'+slot.color+'"><span>P'+(id+1)+(id===self?' · TÚ':'')+
        '</span>'+portrait({id,...p})+'<strong>'+c.name+'</strong><p>'+ (p.ready?'Listo':'Preparando')+'</p>'+vote+'</article>';
    }).join('')+'</div><div class="lobby-controls">'+
    '<label>Animal<select id="animal-choice">'+COURIERS.map((c,id)=>'<option value="'+id+'"'+(local.animal===id?' selected':'')+'>'+c.species+' · '+c.name+'</option>').join('')+'</select></label>'+
    '<label>Atuendo<select id="gear-choice">'+Object.entries(ACCESSORIES).map(([key,label])=>'<option value="'+key+'"'+(local.accessory===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
    (roomMap?'<div class="lobby-map-choice"><span>Mapa de la sala</span><strong id="active-room-map"></strong></div>'
      :'<label>Voto de pista<select id="vote-choice"><option value=""'+(local.vote===null?' selected':'')+'>Sin voto</option>'+
        ARENAS.map((a,id)=>{
          const count=roster.filter(player=>profiles[player].vote===id).length;
          return '<option value="'+id+'"'+(local.vote===id?' selected':'')+'>'+a.name+(count?' · '+count:'')+'</option>';
        }).join('')+'</select></label>')+'</div><div class="lobby-bottom"><p id="lobby-hint"></p><div class="actions"></div></div>';
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
  if (roomMap) $('active-room-map').textContent=roomMap.name;
  else $('vote-choice').onchange=event=>changeProfile({vote:event.target.value===''?null:Number(event.target.value)});
  const actions=station.querySelector('.lobby-bottom .actions');
  const ready=button(local.ready?'Quitar listo':'Listo',()=>changeProfile({ready:!local.ready}),local.ready?'secondary':'primary');
  ready.id='ready-toggle';
  ready.setAttribute('aria-pressed',String(local.ready));
  actions.append(ready);
  if (roomMap) {
    const download=button('Descargar mapa',()=>downloadMap(roomMap),'ghost');
    download.id='download-room-map';
    actions.prepend(download);
  }
  if (host) {
    const mapButton=button(roomMap?'Cambiar mapa':'Cargar mapa',showRoomMap,'ghost');
    mapButton.id='room-map-settings';
    const rulesButton=button('Ajustes de partida',showRoomRules,'ghost');
    rulesButton.id='room-rules';
    actions.prepend(mapButton,rulesButton);
    const start=button('Empezar partida',startMatch,'primary');
    start.id='host-start';
    start.disabled=!canStartRoom();
    actions.append(start);
  }
  const hint=roster.length<2?'Comparte la sala para empezar.':waitingForMapSupport()?'Pide a tus invitados que actualicen el juego para jugar con este mapa.'
    :canStartRoom()?'Todos listos.':'Todos deben marcarse como listos.';
  $('lobby-hint').textContent=roomMap?hint:`${hint} Pista: ${ARENAS[voteResult(roster,profiles,arena)].name}.`;
  const rulesSummary=document.createElement('p');
  rulesSummary.id='room-rules-summary';
  rulesSummary.textContent=`Hasta ${settings.maxRounds} ${settings.maxRounds===1?'ronda':'rondas'} · `+(settings.resetEvery
    ?`Limpieza cada ${settings.resetEvery} ${settings.resetEvery===1?'ronda':'rondas'}`:'Limpieza por votación')+
    ` · Meta ${pointLabel(settings.winPoints)} · Caja ${settings.pickTime} s · Carrera ${settings.raceTime} s`;
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
  const podium=standings.filter(entry=>entry.rank<=3).map(entry=>({...entry}));
  const winners=podium.filter(entry=>entry.rank===1);
  const runnersUp=podium.filter(entry=>entry.rank!==1);
  const left=runnersUp.filter((_,index)=>index%2===0).reverse();
  const right=runnersUp.filter((_,index)=>index%2===1);
  const slots=[...left,...winners,...right];
  const ranks=[...new Set(podium.map(entry=>entry.rank))].sort((a,b)=>b-a);
  const interval=1450;
  const riseTime=520;
  const spotlight=Math.max(0,ranks.length-1)*interval+riseTime;
  const celebration=spotlight+850;

  sheet.innerHTML='<div class="podium-scene"><header class="podium-header"><h2 tabindex="-1">Podio</h2><p class="podium-result"></p></header>'+
    '<div class="podium-floor"><ol class="podium" role="list"></ol></div>'+
    '<footer class="podium-footer"><div class="podium-actions"></div></footer><div class="podium-confetti" aria-hidden="true"></div></div>';
  const scene=sheet.firstElementChild;
  scene.style.setProperty('--rise-time',riseTime+'ms');
  scene.style.setProperty('--spotlight',spotlight+'ms');
  scene.style.setProperty('--celebration',celebration+'ms');
  const result=scene.querySelector('.podium-result');
  result.textContent=g.result;
  const steps=scene.querySelector('.podium');
  const columns=Math.max(1,slots.length);
  scene.style.setProperty('--columns',columns);

  for (const [index,rank] of ranks.entries()) {
    const group=slots.map((entry,slot)=>({entry,slot})).filter(({entry})=>entry.rank===rank);
    // Center each rank as a group before moving it to its final columns.
    const center=group.reduce((sum,{slot})=>sum+slot+.5,0)/group.length;
    const offset=(slots.length/2-center)*100;
    for (const {entry,slot} of group) {
      entry.slot=slot;
      entry.offset=offset;
      entry.arrival=index*interval;
    }
  }
  scene.style.setProperty('--spot-offset',(left.length+winners.length/2)/columns-.5);
  scene.style.setProperty('--spot-size',winners.length/columns/2);

  for (const {id,rank,slot,offset,arrival} of podium) {
    const player=g.players.find(p=>p.id===id);
    const step=document.createElement('li');
    step.dataset.rank=rank;
    step.style.setProperty('--slot',slot+1);
    step.style.setProperty('--offset',offset+'%');
    step.style.setProperty('--arrival',arrival+'ms');
    step.style.setProperty('--settle',(arrival+(rank===1?0:interval-220))+'ms');
    step.innerHTML='<div class="podium-entry"><div class="podium-courier">'+portrait(player)+
      `<strong>P${id+1} ${avatar(player).name}</strong></div><div class="podium-step"><span class="podium-medal" aria-label="Puesto ${rank}">${rank}</span>`+
      `<small>${pointLabel(player.points)}</small></div></div>`;
    steps.append(step);
  }

  const footer=scene.querySelector('.podium-footer');
  const actions=footer.querySelector('.podium-actions');
  for (const {id,rank} of standings.filter(entry=>entry.rank>3)) {
    const player=g.players.find(p=>p.id===id);
    const row=document.createElement('p');
    row.className='podium-remaining';
    row.textContent=`${rank}º · P${id+1} ${avatar(player).name} · ${pointLabel(player.points)}`;
    footer.insertBefore(row,actions);
  }
  drawPortraitAccessories(scene);

  const skip=button('Saltar animación',()=>{
    scene.classList.add('podium-instant');
    finishReveal();
  },'ghost');
  const back=mode==='host'?button('Volver al lobby',()=>{
    game=null;
    resetRaceNetwork();
    profiles=Object.fromEntries(roster.map(id=>[id,{...profiles[id],ready:false}]));
    broadcastLobby(true);
  },'primary'):null;
  actions.append(skip);
  if (back) {
    back.hidden=true;
    actions.append(back);
  }
  function finishReveal() {
    const moveFocus=document.activeElement===skip;
    skip.hidden=true;
    if (back) back.hidden=false;
    if (moveFocus) (back??scene.querySelector('h2')).focus({preventScroll:true});
  }
  if (!podium.length||matchMedia('(prefers-reduced-motion: reduce)').matches) {
    scene.classList.add('podium-instant');
    finishReveal();
    return;
  }
  result.addEventListener('animationend',finishReveal,{once:true});

  const particles=scene.querySelector('.podium-confetti');
  for (let i=0;i<36;i++) {
    const piece=document.createElement('i');
    piece.style.setProperty('--x',((i*37)%100)+'%');
    piece.style.setProperty('--drift',((i*19)%26-13)+'vw');
    piece.style.setProperty('--lag',((i*127)%1100)+'ms');
    piece.style.setProperty('--fall',(1200+(i*53)%800)+'ms');
    particles.append(piece);
  }
}

function renderWork(g) {
  const sheet=$('sheet');
  const phase=g?.phase;
  const finale=phase==='result'&&g.over;
  sheet.hidden=!['draft','result'].includes(phase);
  sheet.classList.remove('entry');
  sheet.classList.toggle('crate',phase==='draft');
  sheet.classList.toggle('podium-sheet',finale);
  if (!finale&&sheet.dataset.podiumMatch) {
    delete sheet.dataset.podiumMatch;
    sheet.replaceChildren();
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
}

function syncBuildTools(g,id) {
  const canPlacePiece=id!==undefined;
  $('touch-build').hidden=!canPlacePiece;
  $('build-movement').hidden=!touchDevice.matches;
  $('touch-place').hidden=!touchDevice.matches;
  $('build-wait').hidden=g?.phase!=='build'||canPlacePiece;
  if (!canPlacePiece) return;
  const kind=g.picks[id], item=PIECES[kind];
  const piece=$('build-piece');
  if (piece.dataset.kind!==kind) {
    piece.dataset.kind=kind;
    const img=document.createElement('img');
    img.src=pieceURL(kind);
    img.alt='';
    piece.querySelector('img')?.remove();
    piece.prepend(img);
    $('build-piece-name').textContent=item.name;
  }
  $('build-flip').hidden=!DIRECTIONAL.has(kind);
  showBuildDirection(pointFor(id).face);
  const label=kind==='trash'?'Borrar':'Colocar';
  $('touch-place').textContent=label;
  $('touch-place').setAttribute('aria-label',kind==='trash'?'Borrar pieza':`Colocar ${item.name.toLowerCase()}`);
}

function syncUI(g) {
  const phase=g?.phase;
  const key=JSON.stringify([mode,arena,self,roster,!g&&profiles,!g&&settings,!g&&roomCode,!g&&roomStatus,!g&&roomError,connectedToRoom,roomMapRevision,waitingForMapSupport(),
    g?.match,g?.round,phase,g?.over,g?.finishedBuilding,g?.picks,g?.players.map(p=>[p.points,p.status,p.seal])]);
  const nextBuild=phase==='build'?g.match+'/'+g.round:'';
  if (buildKey!==nextBuild) {
    buildPoints.clear();
    keys.clear();
    releaseBuildDrag();
    $('placement-status').textContent='';
    buildKey=nextBuild;
  }
  if (uiKey!==key) {
    uiKey=key;
    const waiting=mode==='host'||mode==='guest';
    const menu=!g&&!waiting;
    document.body.dataset.phase=phase??(menu?'menu':'lobby');
    $('start-screen').hidden=!menu;
    const showingPodium=phase==='result'&&g.over;
    $('match-hud').hidden=!g||showingPodium;
    if ($('match-hud').hidden) closeDisclosure($('match-details'));
    $('exit').hidden=mode==='menu';
    const builderId=builder();
    $('stage').classList.toggle('build',builderId!==undefined);
    $('arena-label').textContent=(g?gameArena(g).name:roomMap?.name)??ARENAS[arena].name;
    $('round-label').textContent=g?'Ronda '+g.round+'/'+(g.rules?.maxRounds??MAX_ROUNDS):'';
    $('phase').textContent={draft:'Selección',build:'Construcción',countdown:'Preparación',race:'Carrera',result:'Resultados'}[phase]??'';
    const goal=g?.rules?.winPoints??MAX_SCORE;
    const remaining=phase==='build'?g.players.filter(p=>canBuildFor(g,p.id)).length:0;
    $('phase-note').textContent=phase==='draft'&&g.objectsReset?'Se reiniciaron los objetos de la pista.'
      :phase==='build'?(remaining===1?'Queda 1 jugador por colocar.':`Quedan ${remaining} jugadores por colocar.`)
        :g?`${goal} ${goal===1?'punto':'puntos'} para ganar.`:'';
    $('game-overlay').hidden=phase!=='countdown';
    $('overlay-title').textContent='';
    $('overlay-text').textContent='Prepárate para correr';
    $('timer').hidden=!g||!!g.over;
    let pad='';
    if (touchDevice.matches) {
      if (phase==='race'&&g.players.some(p=>p.id===self&&p.status==='running')) pad='race';
      else if (builderId!==undefined) pad='build';
    }
    if (touchPhase!==pad) {
      clearTouch();
      touchPhase=pad;
      $('touch').hidden=pad!=='race';
      $('stage').classList.toggle('touch-build-active',pad==='build');
    }
    syncBuildTools(g,builderId);
    countText='';
    if (g) renderRoster(g);
    renderLobby();
    renderWork(g);
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
const SEND_INTERVAL=1000/30;

function sendRaceControl(message) {
  const packet={...message,match:game.match,round:game.round};
  if (mode==='host') sendAll(packet);
  else hostLink?.send(packet);
}

function broadcastMotion() {
  const packet=motionPacket(game);
  if (game.phase!=='race') {
    if (mode==='host'&&!game.over) for (const link of activeLinks()) link.sendMotion(packet);
    return;
  }
  const player=game.players.find(p=>p.id===self);
  const own=player.status==='running'?motionPacket(game,player):null;
  if (mode==='guest') {
    if (own) hostLink?.sendMotion(own);
    return;
  }
  if (own) runnerPoses.set(self,[self,own.elapsed,own.pose]);
  else runnerPoses.delete(self);
  if (!runnerPoses.size) return;
  const runners=[...runnerPoses.values()];
  // The fallback keeps one latest snapshot per peer, so bundle all other runners together.
  for (const link of activeLinks()) {
    const visible=runners.filter(([seat])=>seat!==link.id);
    if (visible.length) link.sendMotion({...packet,runners:visible});
  }
}

function disconnectPlayer(seat) {
  disconnect(game,seat);
  runnerPoses.delete(seat);
  if (game.phase==='race'||game.phase==='countdown') sendRaceControl({type:'runner-away',seat});
}

function receiveRaceMessage(message,sender) {
  const {type}=message;
  const motionFrame=type==='motion'&&message.phase==='race';
  if (!motionFrame&&type!=='runner-end'&&type!=='runner-away'&&type!=='trap-trigger') return false;
  if (sender!==undefined&&type==='runner-away') return true;
  if (game.phase==='countdown') {
    // The clock estimate may let a peer cross the start a few ticks earlier.
    if (!motionFrame&&pendingRaceMessages.length<128) pendingRaceMessages.push({message,sender});
    return true;
  }
  if (game.phase!=='race') return true;
  if (type==='trap-trigger') {
    const {index,at}=message;
    if (Number.isInteger(index)&&Number.isFinite(at)&&at>=0&&at<=game.deadline&&triggerRacePiece(game,index,at)&&mode==='host') {
      sendRaceControl({type,index,at});
    }
    return true;
  }
  const seat=sender??message.seat;
  const player=game.players.find(p=>p.id===seat&&p.id!==self&&p.connected);
  if (!player) return true;
  if (type==='runner-away') {
    disconnect(game,seat);
    return true;
  }
  if (player.status!=='running') return true;
  const pose=readRunnerPose(game,message);
  if (!pose) return true;
  const outcome=type==='runner-end'?message.outcome:null;
  const received=(performance.now()-raceStart)/1000;
  if (!remoteRunners.push(player,pose,message.elapsed,received,outcome)) return true;
  Object.assign(player,pose);
  if (outcome) {
    settleRunner(game,player,outcome,message.elapsed,message.trap);
    runnerPoses.delete(seat);
    if (mode==='host') sendAll(motionPacket(game,player));
  } else if (mode==='host') runnerPoses.set(seat,[seat,message.elapsed,message.pose]);
  return true;
}

function showRaceEnd(result,events,now,owned) {
  const players=owned?.outcome?result.players.map(p=>p.id===owned.id&&p.outcome===owned.outcome?owned:p):result.players;
  endingRace={until:now+RESULT_HOLD,view:{
    ...result,players,phase:'race',elapsed:result.raceEndedAt,deadline:result.rules.raceTime,
    over:false,event:events.at(-1)??result.event,events,
  }};
}

function tickRace(now) {
  if (game.phase==='countdown') {
    if (now<raceStart) {
      game.elapsed=Math.max(0,game.deadline-(raceStart-now)/1000);
      return;
    }
    beginRace(game);
    for (const {message,sender} of pendingRaceMessages.splice(0)) receiveRaceMessage(message,sender);
  }

  const player=game.players.find(p=>p.id===self);
  const endTick=raceTick(game.deadline);
  const target=Math.min(endTick,Math.floor((now-raceStart)/RACE_TICK_MS));
  let tick=raceTick(game.elapsed);
  if (target-tick>12) {
    // After suspension, resume at the current trap phase without replaying stale controls.
    const resume=target-12;
    if (player.status==='running'&&Number.isInteger(player.support)) {
      player.x+=ferryPosition(game,player.support,resume*RACE_TICK).x-ferryPosition(game,player.support,game.elapsed).x;
    }
    tick=resume;
  }
  const running=player.status==='running';
  while (tick<target&&player.status==='running') {
    game.elapsed=Math.min(++tick*RACE_TICK,game.deadline);
    const input=ownInput()|(jumpQueued?8:0);
    jumpQueued=false;
    stepRaceRunner(game,player,input,RACE_TICK,(index,at)=>sendRaceControl({type:'trap-trigger',index,at}));
  }
  game.elapsed=Math.min(target*RACE_TICK,game.deadline);
  if (target===endTick&&player.status==='running') settleRunner(game,player,'timeout',game.deadline);
  if (running&&player.outcome) {
    const packet=motionPacket(game,player);
    if (mode==='host') sendAll(packet);
    else hostLink?.send(packet);
  }
  if (mode==='host'&&(
    game.players.every(p=>p.status!=='running')||now>=raceStart+game.deadline*1000+FINISH_GRACE
  )) {
    const events=game.events;
    finishRace(game);
    showRaceEnd(game,events,now);
  }
}

function presentGame(now) {
  if (endingRace&&now<endingRace.until) return endingRace.view;
  endingRace=null;
  if (!game) return null;
  if (game.phase==='race') return {...game,players:game.players.map(p=>p.id===self?p:remoteRunners.view(game,p))};
  return mode==='guest'?buildMotion.view(game,now):game;
}

let accumulator=0;
function frame(now) {
  const dt=Math.min((now-lastFrame)/1000,.1);
  lastFrame=now;
  if (game?.phase==='race'||(game?.phase==='countdown'&&raceStart!==null)) {
    accumulator=0;
    tickRace(now);
  } else if (game&&mode==='host') {
    accumulator+=dt;
    while (accumulator>=RACE_TICK&&game.phase!=='countdown') {
      step(game,{},RACE_TICK);
      accumulator-=RACE_TICK;
    }
  } else accumulator=0;
  publishState();
  const view=presentGame(now);
  syncUI(view);
  moveBuildCursors(dt);
  if (mode==='guest'&&hostLink?.open&&game?.phase==='countdown'&&now>=nextClockProbe) {
    nextClockProbe=now+250;
    hostLink.send({type:'runner-clock',match:game.match,round:game.round,sent:performance.now()});
  }
  if (view?.match!==soundMatch) {
    soundMatch=view?.match;
    soundPhase=undefined;
    lastEvent=(view?.event.id??1)-1;
  }
  if (view) {
    if (view.phase==='race'&&soundPhase!=='race') {
      const go=view.events.findLast(event=>event.sound==='go');
      if (go) lastEvent=go.id-1;
    } else if (view.phase==='result'&&soundPhase!=='result') {
      lastEvent=view.event.id-1;
    }
    soundPhase=view.phase;
    for (const event of view.events) if (event.id>lastEvent) {
      lastEvent=event.id;
      playEffect(view.phase==='result'&&event.sound==='finish'?'round':event.sound);
    }
  }
  const shownArena=game?.arena??(mode==='host'||connectedToRoom?voteResult(roster,profiles,arena):arena);
  const shownMap=game?gameArena(game):roomMap?arenaFromMap(roomMap):ARENAS[shownArena];
  ctx.setTransform(1,0,0,1,0,0);
  paintBackdrop(ctx,shownArena,canvas.width,canvas.height,now/1000,shownMap);
  const {x,y,scale}=canvasView;
  ctx.setTransform(scale,0,0,scale,x,y);
  paint(ctx,view,shownArena,visiblePlacements(view),now/1000,self,false,shownMap);
  if (now>=nextMotion) {
    nextMotion=Math.max(nextMotion+SEND_INTERVAL,now);
    broadcastPreview();
    if (game) broadcastMotion();
  }
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
