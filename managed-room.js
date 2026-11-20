import { ROOM_VERSION } from './network.js?v=7';

const configUrl=document.querySelector('meta[name="room-config"]')?.content.trim();
export const usesManagedRooms=!!configUrl;
const sdk='https://www.gstatic.com/firebasejs/12.6.0/';
const slots=['1','2','3'];
const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const unavailable='No se pudo conectar con el servicio de salas.';
const missing='La sala ha caducado o no está abierta. Pide al anfitrión un enlace nuevo.';
let client;

async function loadConfig() {
  const response=await fetch(configUrl,{cache:'no-store',credentials:'omit',redirect:'error'});
  if (!response.ok) throw Error(unavailable);
  const config=await response.json();
  if (!config?.apiKey||!config.projectId||!config.databaseURL||!config.appId) throw Error(unavailable);
  return config;
}

function getClient() {
  client??=Promise.all([
    import(sdk+'firebase-app.js'),
    import(sdk+'firebase-auth.js'),
    import(sdk+'firebase-database.js'),
    loadConfig(),
  ]).then(async ([app,auth,api,firebaseConfig])=>{
    const instance=app.initializeApp(firebaseConfig);
    const account=auth.initializeAuth(instance,{persistence:auth.inMemoryPersistence});
    const {user}=await auth.signInAnonymously(account);
    return {api,uid:user.uid,db:api.getDatabase(instance)};
  }).catch(error=>{
    client=null;
    throw error;
  });
  return client;
}

export function managedSession(code,onConnection,onStatus) {
  const host=!code;
  const peers=new Map();
  const unsubscribes=[];
  let closed=false,timer,release;

  function stop(reason) {
    if (closed) return;
    closed=true;
    clearTimeout(timer);
    for (const unsubscribe of unsubscribes) unsubscribe();
    for (const peer of peers.values()) peer.end();
    release?.();
    if (reason) onStatus(reason);
  }

  async function start() {
    const {api,db,uid}=await getClient();
    if (closed) return;
    const {ref,child,onValue,onChildAdded,onDisconnect,get,set,push,remove,runTransaction}=api;
    const connected=ref(db,'.info/connected');
    let online=false;
    const watch=(reference,callback)=>onValue(reference,callback,()=>stop(unavailable));
    unsubscribes.push(watch(connected,snapshot=>{
      if (snapshot.val()) online=true;
      else if (online) stop('Se interrumpió la conexión con el servidor de salas. Abre una sala nueva.');
    }));

    async function reserve(reference,write,read) {
      if (closed) return false;
      const disconnect=onDisconnect(reference);
      try {
        await disconnect.remove();
        if (closed) { await disconnect.cancel(); return false; }
        const success=await write();
        if (!success) { await disconnect.cancel(); return false; }
      } catch (error) {
        await disconnect.cancel().catch(()=>{});
        const exists=await read();
        if (!exists) throw error;
        return false;
      }
      release=()=>remove(reference).then(()=>disconnect.cancel()).catch(()=>{});
      if (closed) { release(); return false; }
      return true;
    }

    function attach(room,slot,peerUid) {
      const wire=child(room,`wires/${slot}/${peerUid}`);
      const outgoing=child(wire,host?'down':'up');
      const incoming=child(wire,host?'up':'down');
      const outgoingFast=child(wire,host?'fastDown':'fastUp');
      const incomingFast=child(wire,host?'fastUp':'fastDown');
      let fastPending=false,queued=0;
      const handlers=new Map(),listeners=[];
      function receive(snapshot) {
        if (!peer.open||typeof snapshot.val()!=='string') return;
        let message;
        try { message=JSON.parse(snapshot.val()); } catch { return; }
        handlers.get('data')?.(message);
      }
      const peer={
        uid:peerUid,
        open:true,
        dataChannel:{get bufferedAmount() { return fastPending?2048:queued; }},
        on(event,handler) { handlers.set(event,handler); },
        send(message) {
          if (!peer.open) return;
          const value=JSON.stringify(message);
          const fast=message.type==='motion'||message.type==='preview';
          if (fast) {
            if (fastPending) return;
            fastPending=true;
            set(outgoingFast,value).catch(()=>{}).finally(()=>{fastPending=false;});
            return;
          }
          queued+=value.length;
          push(outgoing,value).catch(()=>peer.end()).finally(()=>{queued-=value.length;});
        },
        close() {
          peer.end();
          if (host&&!closed) {
            runTransaction(child(room,`seats/${slot}`),value=>value===peerUid?null:undefined,
              {applyLocally:false}).catch(()=>{});
          } else if (!host) stop();
        },
        end() {
          if (!peer.open) return;
          peer.open=false;
          peers.delete(slot);
          for (const unsubscribe of listeners) unsubscribe();
          handlers.get('close')?.();
        },
      };
      peers.set(slot,peer);
      onConnection(peer);
      queueMicrotask(()=>{
        if (!peer.open) return;
        listeners.push(onChildAdded(incoming,snapshot=>{
          receive(snapshot);
          remove(snapshot.ref).catch(()=>{});
        },()=>peer.end()));
        listeners.push(onValue(incomingFast,receive,()=>peer.end()));
      });
    }

    if (host) {
      for (let attempt=0;attempt<5&&!closed;attempt++) {
        const bytes=crypto.getRandomValues(new Uint8Array(6));
        const roomCode=Array.from(bytes,byte=>alphabet[byte&31]).join('');
        const room=ref(db,`rooms/${roomCode}`);
        const claimed=await reserve(room,async()=>{
          await set(room,{meta:{host:uid,version:ROOM_VERSION}});
          return true;
        },async()=>(await get(child(room,'meta'))).exists());
        if (closed) return;
        if (!claimed) continue;
        clearTimeout(timer);
        onStatus('',roomCode);
        unsubscribes.push(watch(child(room,'seats'),snapshot=>{
          for (const slot of slots) {
            const member=snapshot.child(slot).val();
            const peer=peers.get(slot);
            if (peer&&peer.uid!==member) peer.end();
            if (typeof member==='string'&&!peers.has(slot)) attach(room,slot,member);
          }
        }));
        return;
      }
      stop(unavailable);
      return;
    }

    const room=ref(db,`rooms/${code}`);
    const metadata=child(room,'meta');
    const meta=(await get(metadata)).val();
    if (closed) return;
    if (!meta) { stop(missing); return; }
    if (meta.version!==ROOM_VERSION) { stop('Actualiza el juego antes de entrar a la sala.'); return; }
    for (const slot of slots) {
      const seat=child(room,`seats/${slot}`);
      const claimed=await reserve(seat,async()=>{
        const result=await runTransaction(seat,value=>value===null?uid:undefined,{applyLocally:false});
        return result.committed;
      },async()=>(await get(seat)).exists());
      if (closed) return;
      if (!claimed) continue;
      clearTimeout(timer);
      attach(room,slot,uid);
      unsubscribes.push(watch(metadata,snapshot=>{
        if (snapshot.child('host').val()!==meta.host) stop(missing);
      }));
      unsubscribes.push(watch(seat,snapshot=>{
        if (snapshot.val()!==uid) stop('Se cerró tu conexión con la sala.');
      }));
      return;
    }
    stop((await get(metadata)).exists()?'La sala está completa.':missing);
  }

  timer=setTimeout(()=>stop(unavailable),15000);
  queueMicrotask(()=>{ if (!closed) start().catch(()=>stop(unavailable)); });
  return {close:()=>stop()};
}
