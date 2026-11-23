import { ROOM_VERSION, createLink } from './network.js?v=15';

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

const realtime=message=>message.type==='motion'||message.type==='preview';
const RTC_SETUP_TIMEOUT=18000,RTT_PROBE_TIMEOUT=1800,MIN_RTT_GAIN=5;
const MAX_FIREBASE_WRITES=2;
function median(values) {
  const samples=[...values].sort((a,b)=>a-b);
  if (samples.length) return (samples[Math.floor((samples.length-1)/2)]+samples[Math.floor(samples.length/2)])/2;
}

function roomTransport(host,sendFirebase,deliver) {
  let rtc,preferred=false,probe,setupTimer,ackTimer,ackDelay=500;
  let sent=0,received=0;
  const pending=new Map(),waiting=new Map();

  function stopProbe() {
    for (const timer of probe?.timers??[]) clearTimeout(timer);
    probe=null;
  }

  function close(flush=false) {
    const connection=rtc;
    rtc=null;
    preferred=false;
    stopProbe();
    clearTimeout(setupTimer);
    clearTimeout(ackTimer);
    connection?.close();
    if (flush) for (const packet of pending.values()) sendFirebase(packet);
    pending.clear();
  }

  function watchAcknowledgement() {
    clearTimeout(ackTimer);
    if (pending.size) ackTimer=setTimeout(()=>close(true),ackDelay);
  }

  function selectRoute() {
    const direct=median(probe.direct.values()),viaFirebase=median(probe.firebase.values());
    preferred=Number.isFinite(direct)&&(viaFirebase===undefined||direct+MIN_RTT_GAIN<viaFirebase);
    if (preferred) ackDelay=Math.max(500,4*direct);
    stopProbe();
  }

  function measure() {
    clearTimeout(setupTimer);
    probe={sent:new Map(),direct:new Map(),firebase:new Map(),timers:[]};
    for (let id=1;id<=3;id++) probe.timers.push(setTimeout(()=>{
      const ping={type:'room-rtc-ping',id};
      probe.sent.set(id,performance.now());
      rtc.send(ping);
      sendFirebase(ping);
    },(id-1)*150));
    probe.timers.push(setTimeout(selectRoute,RTT_PROBE_TIMEOUT));
  }

  function connect(signal) {
    if (rtc||typeof RTCPeerConnection!=='function') return;
    try {
      const connection=createLink(0,measure,link=>{if(rtc===link) close(true);},
        (link,message)=>{if(rtc===link) receive(message,true);});
      rtc=connection;
      setupTimer=setTimeout(()=>close(true),RTC_SETUP_TIMEOUT);
      const description=host?connection.invite():connection.answer(signal);
      description.then(code=>{
        if (rtc===connection) sendFirebase({type:host?'room-rtc-offer':'room-rtc-answer',code});
      }).catch(()=>{if(rtc===connection) close(true);});
    } catch { close(true); }
  }

  function receive(message,direct=false) {
    if (typeof message?.type!=='string') return;
    switch (message.type) {
      case 'room-rtc-hello':
        if (host&&!direct) connect();
        return;
      case 'room-rtc-offer':
        if (!host&&!direct&&typeof message.code==='string') connect(message.code);
        return;
      case 'room-rtc-answer':
        if (host&&!direct&&typeof message.code==='string') rtc?.connect(message.code).catch(()=>close(true));
        return;
      case 'room-rtc-ping': {
        const pong={type:'room-rtc-pong',id:message.id};
        if (direct) rtc?.send(pong);
        else sendFirebase(pong);
        return;
      }
      case 'room-rtc-pong': {
        if (!probe?.sent.has(message.id)) return;
        const samples=direct?probe.direct:probe.firebase;
        if (!samples.has(message.id)) samples.set(message.id,performance.now()-probe.sent.get(message.id));
        if (probe.direct.size===3&&probe.firebase.size===3) selectRoute();
        return;
      }
      case 'room-rtc-ack':
        if (direct&&Number.isSafeInteger(message.sequence)&&message.sequence<=sent) {
          const first=pending.keys().next().value;
          if (first!==undefined&&message.sequence>=first) {
            for (const sequence of pending.keys()) if (sequence<=message.sequence) pending.delete(sequence);
            watchAcknowledgement();
          }
        }
        return;
    }

    // The same reliable sequence spans both routes, including retransmissions after fallback.
    const sequence=message.roomSequence;
    if (!Number.isSafeInteger(sequence)) { deliver(message); return; }
    if (sequence<=received||sequence>received+256) return;
    waiting.set(sequence,{message,direct});
    let acknowledge=false;
    while (waiting.has(received+1)) {
      const packet=waiting.get(++received);
      waiting.delete(received);
      acknowledge||=packet.direct;
      deliver(packet.message);
    }
    if (acknowledge&&rtc?.open) rtc.send({type:'room-rtc-ack',sequence:received});
  }

  return {
    start() { if (!host&&typeof RTCPeerConnection==='function') sendFirebase({type:'room-rtc-hello'}); },
    close,
    receive,
    get bufferedAmount() { return preferred?rtc?.motionBufferedAmount:undefined; },
    sendFastInput(message) { if (preferred) rtc?.sendFastInput(message); },
    sendExtraMotion(message) { if (preferred) rtc?.sendExtraMotion(message); },
    send(message) {
      if (realtime(message)) {
        if (preferred&&rtc?.motionBufferedAmount!==undefined) rtc.sendMotion(message);
        else sendFirebase(message);
        return;
      }
      const packet={...message,roomSequence:++sent};
      if (!preferred||!rtc?.open) { sendFirebase(packet); return; }
      pending.set(sent,packet);
      if (pending.size===1) watchAcknowledgement();
      rtc.send(packet);
    },
  };
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
      let fastInFlight=0,latestFast=null,queued=0;
      const handlers=new Map(),listeners=[];
      const transport=roomTransport(host,sendFirebase,message=>{
        if (peer.open) handlers.get('data')?.(message);
      });
      function receive(snapshot) {
        if (!peer.open||typeof snapshot.val()!=='string') return;
        let message;
        try { message=JSON.parse(snapshot.val()); } catch { return; }
        transport.receive(message);
      }
      function flushFast() {
        if (!peer.open||fastInFlight>=MAX_FIREBASE_WRITES||latestFast===null) return;
        const value=latestFast;
        latestFast=null;
        fastInFlight++;
        set(outgoingFast,value).catch(()=>{}).finally(()=>{
          fastInFlight--;
          flushFast();
        });
      }
      function sendFirebase(message) {
        if (!peer.open) return;
        const value=JSON.stringify(message);
        if (realtime(message)) {
          // Keep only the freshest state when both writes are still in flight.
          latestFast=value;
          flushFast();
          return;
        }
        queued+=value.length;
        push(outgoing,value).catch(()=>peer.end()).finally(()=>{queued-=value.length;});
      }
      const peer={
        uid:peerUid,
        open:true,
        dataChannel:{get bufferedAmount() { return transport.bufferedAmount??queued; }},
        on(event,handler) { handlers.set(event,handler); },
        send:transport.send,
        sendFastInput:transport.sendFastInput,
        sendExtraMotion:transport.sendExtraMotion,
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
          transport.close();
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
        transport.start();
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
