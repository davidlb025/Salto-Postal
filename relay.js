import { ROOM_VERSION } from './network.js?v=15';

function roomSocketUrl() {
  if (document.documentElement.dataset.roomTransport==='relay') {
    const url=new URL('./room-socket',location.href);
    url.protocol=url.protocol==='https:'?'wss:':'ws:';
    return url;
  }
  try {
    const url=new URL(document.querySelector('meta[name="room-relay"]')?.content.trim());
    if (url.protocol==='wss:'&&!url.username&&!url.password&&!url.hash) return url;
  } catch {
    // The standalone version can run without a configured relay.
  }
  return null;
}

const relayUrl=roomSocketUrl();
export const usesRoomRelay=!!relayUrl;

export function relaySession(code,onConnection,onStatus) {
  const peers=new Map();
  const unavailable='No se pudo conectar con el servidor de salas.';
  let socket,closed=false,timer;

  function send(message) {
    if (socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function stop(message) {
    if (closed) return;
    closed=true;
    clearTimeout(timer);
    socket?.close();
    for (const peer of peers.values()) peer.end();
    if (message) onStatus(message);
  }

  function attach(id) {
    if (peers.has(id)) return;
    const handlers=new Map();
    const peer={
      open:true,
      dataChannel:{get bufferedAmount() { return socket.bufferedAmount; }},
      on(event,handler) { handlers.set(event,handler); },
      send(data) { if (peer.open) send({op:'data',peer:id,data}); },
      close() {
        if (!peer.open) return;
        send({op:'leave',peer:id});
        peer.end();
      },
      receive(data) { handlers.get('data')?.(data); },
      end() {
        if (!peer.open) return;
        peer.open=false;
        peers.delete(id);
        handlers.get('close')?.();
      },
    };
    peers.set(id,peer);
    onConnection(peer);
  }

  queueMicrotask(()=>{
    if (closed) return;
    try {
      socket=new WebSocket(relayUrl);
    } catch {
      stop(unavailable);
      return;
    }
    timer=setTimeout(()=>stop(unavailable),10000);
    socket.addEventListener('open',()=>send({op:code?'join':'create',code,version:ROOM_VERSION}));
    socket.addEventListener('close',()=>stop(
      code?unavailable:'Se perdió la conexión con el servidor de salas. Crea otra sala.'));
    socket.addEventListener('message',event=>{
      if (closed) return;
      const packet=JSON.parse(event.data);
      switch (packet.op) {
        case 'room':
          clearTimeout(timer);
          onStatus('',packet.code);
          break;
        case 'peer':
          if (code) clearTimeout(timer);
          attach(packet.peer);
          break;
        case 'left':
          peers.get(packet.peer)?.end();
          break;
        case 'data':
          peers.get(packet.peer)?.receive(packet.data);
          break;
        case 'error':
          stop(packet.message);
          break;
      }
    });
  });

  return {close:()=>stop()};
}
