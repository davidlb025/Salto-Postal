export const ROOM_VERSION=8;
const SIGNAL_PREFIX = 'SP'+ROOM_VERSION+'-';
const routeError='La sala respondió, pero WebRTC no encontró una ruta. Pide al anfitrión que cree una sala en el servidor de salas y comparta el enlace nuevo.';
const discovery={urls:'stun:stun.l.google.com:19302'};
let relay=null;

export function setRelay(urls,username,credential) {
  const servers=urls.trim().split(/[\s,]+/).filter(Boolean);
  if (!servers.length||servers.length>4||servers.some(url=>!/^turns?:[\w.:[\]-]+(?:\?transport=(?:udp|tcp))?$/i.test(url))) {
    throw new Error('Introduce entre una y cuatro direcciones turn: o turns:.');
  }
  if (!username.trim()||!credential) throw new Error('Faltan el usuario y la contraseña del relé.');
  relay={urls:servers,username:username.trim(),credential};
}

export function clearRelay() { relay=null; }
export function hasRelay() { return relay!==null; }

function iceConfiguration() {
  return {iceServers:relay?[discovery,relay]:[discovery]};
}

function signal(pc) {
  return SIGNAL_PREFIX + btoa(JSON.stringify(pc.localDescription.toJSON()));
}

function readSignal(code, type) {
  const trimmed = code.trim();
  try {
    if (!trimmed.startsWith(SIGNAL_PREFIX) || trimmed.length>50000) throw new Error();
    const desc = JSON.parse(atob(trimmed.slice(SIGNAL_PREFIX.length)));
    if (desc.type!==type || typeof desc.sdp!=='string') throw new Error();
    return desc;
  } catch {
    throw new Error(type==='offer' ? 'Pega el código de invitación completo.' : 'Pega el código de respuesta completo.');
  }
}

function collectICE(pc) {
  if (pc.iceGatheringState==='complete') return Promise.resolve();
  return new Promise(resolve=>{
    const done = () => {
      clearTimeout(timeout);
      pc.removeEventListener('icegatheringstatechange',check);
      resolve();
    };
    const check = () => { if (pc.iceGatheringState==='complete') done(); };
    const timeout = setTimeout(done,relay?12000:7000);
    pc.addEventListener('icegatheringstatechange',check);
  });
}

function motionTransport(pc,receive) {
  let channel;
  try {
    channel=pc.createDataChannel('postal-motion',{negotiated:true,id:4,ordered:false,maxRetransmits:0});
  } catch {
    return null;
  }
  channel.addEventListener('message',event=>{
    if (typeof event.data!=='string'||event.data.length>8192) return;
    let packet;
    try { packet=JSON.parse(event.data); } catch { return; }
    if (packet?.type==='motion'||packet?.type==='preview') receive(packet);
  });
  return channel;
}

function sendMotion(channel,control,packet,fallback) {
  if (channel?.readyState==='open') {
    if (channel.bufferedAmount<4096) {
      try { channel.send(JSON.stringify(packet)); } catch { /* A newer snapshot will follow. */ }
    }
  } else if (control?.bufferedAmount<2048) fallback(packet);
}

export function createLink(id, onOpen, onDrop, onMessage) {
  if (!globalThis.RTCPeerConnection) throw new Error('Este navegador no ofrece WebRTC.');
  const pc = new RTCPeerConnection(iceConfiguration());
  let channel,motion,closed=false;
  const link = {
    id, open:false,
    close() { drop(); },
    send(message) {
      if (channel?.readyState==='open') {
        try { channel.send(JSON.stringify(message)); } catch { drop(); }
      }
    },
    sendMotion(packet) { sendMotion(motion,channel,packet,message=>link.send(message)); },
    async invite() {
      bind(pc.createDataChannel('salto-postal'));
      await pc.setLocalDescription(await pc.createOffer());
      await collectICE(pc);
      return signal(pc);
    },
    async answer(code) {
      await pc.setRemoteDescription(readSignal(code,'offer'));
      await pc.setLocalDescription(await pc.createAnswer());
      await collectICE(pc);
      return signal(pc);
    },
    async connect(code) { await pc.setRemoteDescription(readSignal(code,'answer')); },
  };
  function drop() {
    if (closed) return;
    closed=true;
    link.open=false;
    pc.close();
    onDrop(link);
  }
  function bind(data) {
    channel=data;
    const opened = () => {
      if (closed||link.open) return;
      motion=motionTransport(pc,message=>onMessage(link,message));
      link.open=true;
      onOpen(link);
    };
    channel.addEventListener('open',opened);
    if (channel.readyState==='open') opened();
    channel.addEventListener('close',drop);
    channel.addEventListener('message',event=>{
      if (typeof event.data!=='string' || event.data.length>55000) return;
      let message;
      try { message=JSON.parse(event.data); } catch { return; }
      if (message && typeof message==='object') onMessage(link,message);
    });
  }
  pc.addEventListener('datachannel',event=>bind(event.channel));
  pc.addEventListener('connectionstatechange',()=>{ if (pc.connectionState==='failed') drop(); });
  return link;
}


const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const protocol='salto-postal-v'+ROOM_VERSION;
const namespace=protocol+'-';
const returnProtocol=protocol+'-return';
const channelOptions={serialization:'json',reliable:true};

function randomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>alphabet[n&31]).join('');
}

export function normalizeCode(input) {
  return input.trim().toUpperCase().replaceAll(/[-\s]/g,'');
}

export function validCode(code) {
  return code.length===6&&[...code].every(char=>alphabet.includes(char));
}

export function peerLink(connection,id,onOpen,onDrop,onMessage) {
  let motion,closed=false;
  const pc=connection.peerConnection;
  const timer=setTimeout(()=>drop(failureMessage()),25000);
  function failureMessage() {
    return connection.peerConnection?.remoteDescription
      ? routeError
      : 'El anfitrión no respondió. Deja la sala abierta y comprueba que ambos dispositivos usan la misma versión.';
  }
  function checkICE() {
    if (!link.open&&pc?.iceConnectionState==='failed') drop(failureMessage());
  }
  const link={
    id,open:false,
    close:()=>drop(),
    send(message) {
      if (!link.open) return;
      try { connection.send(message); } catch { drop(); }
    },
    sendMotion(packet) { sendMotion(motion,connection.dataChannel,packet,message=>link.send(message)); },
  };
  function drop(reason) {
    if (closed) return;
    closed=true;
    link.open=false;
    clearTimeout(timer);
    pc?.removeEventListener('iceconnectionstatechange',checkICE);
    motion?.close();
    connection.close();
    onDrop(link,reason);
  }
  function opened() {
    if (closed||link.open) return;
    clearTimeout(timer);
    if (pc) motion=motionTransport(pc,message=>onMessage(link,message));
    link.open=true;
    onOpen(link);
  }
  connection.on('open',opened);
  connection.on('close',()=>drop(link.open?undefined:failureMessage()));
  connection.on('error',()=>drop(link.open?'La conexión WebRTC se interrumpió.':failureMessage()));
  connection.on('data',message=>{
    if (link.open&&message&&typeof message==='object'&&typeof message.type==='string') onMessage(link,message);
  });
  pc?.addEventListener('iceconnectionstatechange',checkICE);
  if (connection.open) queueMicrotask(opened);
  return link;
}

export function shortSession(code,onConnection,onStatus) {
  const host=!code;
  let room=code||randomCode(),peer,closed=false,registered=false,handshake,recovery;
  const routes=new Map();
  const candidates=new Map();
  let chosen=null,routeTimeout;
  let hiddenAt=0;
  function visibilityChanged() {
    if (document.visibilityState==='hidden') {
      hiddenAt=Date.now();
      return;
    }
    const backgrounded=hiddenAt&&Date.now()-hiddenAt>20000;
    hiddenAt=0;
    if (backgrounded&&registered&&peer?.open) peer.disconnect();
    else reconnect();
  }
  if (host) {
    window.addEventListener('online',reconnect);
    document.addEventListener('visibilitychange',visibilityChanged);
  }

  const session={
    reconnect,
    close() {
      closed=true;
      clearTimeout(handshake);
      clearTimeout(recovery);
      clearTimeout(routeTimeout);
      for (const route of routes.values()) route.dispose();
      routes.clear();
      if (host) {
        window.removeEventListener('online',reconnect);
        document.removeEventListener('visibilitychange',visibilityChanged);
      }
      peer?.destroy();
    },
  };

  function scheduleReconnect() {
    clearTimeout(recovery);
    if (!closed&&registered&&document.visibilityState!=='hidden'&&navigator.onLine!==false) {
      recovery=setTimeout(reconnect,2000);
    }
  }

  function awaitSignaling(current) {
    clearTimeout(handshake);
    handshake=setTimeout(()=>{
      if (closed||peer!==current) return;
      if (host&&registered) {
        current.disconnect();
        onStatus('La sala aún no recupera la señalización. Se volverá a intentar.');
        scheduleReconnect();
      } else {
        current.destroy();
        onStatus('El servicio de señalización tardó demasiado en responder.');
      }
    },12000);
  }

  function reconnect() {
    if (closed||!host||!registered||navigator.onLine===false) return;
    clearTimeout(recovery);
    if (peer?.destroyed) {
      onStatus('Recuperando el código de sala…');
      open(0);
    } else if (peer?.disconnected) {
      onStatus('Recuperando el código de sala…');
      awaitSignaling(peer);
      try { peer.reconnect(); }
      catch { scheduleReconnect(); }
    }
  }

  function guestRoute(connection) {
    if (chosen) { connection.close(); return; }
    candidates.set(connection,connection.peerConnection);
    const selected=message=>{
      // A lobby/reject message is also accepted from an older host that opened a single channel.
      if (closed||chosen||!['route-selected','lobby','reject'].includes(message?.type)) return;
      chosen=connection;
      clearTimeout(routeTimeout);
      connection.off('data',selected);
      onConnection(connection,message.type==='route-selected'?null:message);
      for (const other of candidates.keys()) if (other!==connection) other.close();
      candidates.clear();
    };
    connection.on('data',selected);
  }

  function hostRoute(current,first) {
    if (first.metadata?.reverse!==true) { onConnection(first); return; }
    const guest=first.peer;
    if (routes.has(guest)||routes.size>=8) { first.close(); return; }
    const choices=new Set([first]);
    let winner=null;
    const dispose=()=>{
      clearTimeout(delay);
      clearTimeout(expiry);
      routes.delete(guest);
      for (const connection of choices) if (connection!==winner) connection.close();
    };
    const accept=connection=>{
      if (closed||winner||routes.get(guest)?.dispose!==dispose) return;
      winner=connection;
      connection.send({type:'route-selected'});
      onConnection(connection);
      dispose();
    };
    const delay=setTimeout(()=>{
      if (closed||winner||current.disconnected||current.destroyed) return;
      const reverse=current.connect(guest,{...channelOptions,label:returnProtocol});
      if (!reverse) return;
      choices.add(reverse);
      reverse.on('open',()=>accept(reverse));
    },3500);
    const expiry=setTimeout(dispose,24000);
    routes.set(guest,{dispose});
    first.on('open',()=>accept(first));
    if (first.open) accept(first);
  }

  function open(attempt) {
    if (closed) return;
    if (!globalThis.Peer) {
      onStatus('La señalización automática no está disponible.');
      return;
    }
    const options={config:iceConfiguration()};
    const current=host?new Peer(namespace+room,options):new Peer(options);
    peer=current;
    const active=()=>!closed&&peer===current;
    awaitSignaling(current);
    current.on('open',()=>{
      if (!active()) return;
      clearTimeout(handshake);
      clearTimeout(recovery);
      if (host) {
        registered=true;
        onStatus('',room);
      } else {
        const connection=current.connect(namespace+room,{...channelOptions,label:protocol,metadata:{reverse:true}});
        if (!connection) { onStatus('No se pudo iniciar la conexión.'); return; }
        onStatus('Contactando con la sala…',room);
        guestRoute(connection);
        routeTimeout=setTimeout(()=>{
          const hasAnswer=[...candidates.values()].some(pc=>pc?.remoteDescription);
          onStatus(hasAnswer?routeError:
            'El anfitrión no respondió. Deja la sala abierta y comprueba que ambos dispositivos usan la misma versión.');
        },22000);
      }
    });
    current.on('connection',connection=>{
      if (!active()) { connection.close(); return; }
      if (host&&connection.label===protocol) hostRoute(current,connection);
      else if (!host&&connection.label===returnProtocol&&connection.peer===namespace+room) {
        onStatus('Probando la conexión desde el anfitrión…',room);
        guestRoute(connection);
      } else connection.close();
    });
    current.on('error',error=>{
      if (!active()) return;
      clearTimeout(handshake);
      if (host&&error.type==='unavailable-id'&&!registered&&attempt<3) {
        current.destroy();
        room=randomCode();
        open(attempt+1);
      } else if (error.type==='peer-unavailable'&&!host&&!chosen) {
        onStatus('La sala no está disponible. Deja abierto el lobby del anfitrión y usa el mismo enlace del juego en ambos dispositivos.');
      } else if (host&&registered&&error.type!=='webrtc') {
        onStatus('Se perdió la señalización. La sala intentará recuperar su código.');
        scheduleReconnect();
      } else if ((!host||!registered)&&error.type!=='webrtc') {
        onStatus('No se pudo conectar con el servicio de señalización.');
      }
    });
    current.on('disconnected',()=>{
      if (active()&&host&&registered) {
        clearTimeout(handshake);
        onStatus('Se perdió la señalización. La sala intentará recuperar su código.');
        scheduleReconnect();
      }
    });
  }
  queueMicrotask(()=>open(0));
  return session;
}
