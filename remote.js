// Remote camera support (v6.0.0) using Firebase (Firestore) as signaling.
// Requires filling in pairing-config.js with your firebaseConfig and setting QR_REMOTE.enabled=true.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, addDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';

(function(){
  const pcConfig = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] };
  const state = {
    app:null, db:null, auth:null,
    host:{ pc:null, stream:null, code:null, status:'idle' },
    join:{ pc:null, stream:null, code:null, status:'idle' },
    remoteStream:null
  };

  function initIfEnabled(){
    try{
      if(!window.QR_REMOTE || !window.QR_REMOTE.enabled || !window.QR_REMOTE.firebaseConfig){
        console.log('[remote] disabled (set pairing-config.js)');
        return false;
      }
      state.app = initializeApp(window.QR_REMOTE.firebaseConfig);
      state.auth = getAuth(state.app);
      state.db = getFirestore(state.app);
      signInAnonymously(state.auth).catch(function(e){ console.warn('anon auth failed', e); });
      return true;
    }catch(e){ console.warn('[remote] init failed', e); return false; }
  }

  async function createHost(){
    if(!initIfEnabled()) throw new Error('Remote disabled');
    if(state.host.pc){ try{ state.host.pc.close(); }catch(_e){}; state.host.pc=null; }
    const pc = new RTCPeerConnection(pcConfig);
    state.host.pc = pc; state.host.status='creating';
    // We want to RECEIVE remote camera
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.ontrack = function(ev){
      state.remoteStream = ev.streams && ev.streams[0] ? ev.streams[0] : null;
      const video = document.getElementById('video');
      if(state.remoteStream){ video.srcObject = state.remoteStream; video.play().catch(function(){}); }
    };
    pc.oniceconnectionstatechange = function(){ console.log('[host] ice', pc.iceConnectionState); };
    // Code = 6-digit
    const code = String(Math.floor(100000 + Math.random()*900000));
    state.host.code = code;
    const sessRef = doc(state.db, 'qr_remote_sessions', code);
    await setDoc(sessRef, { role:'host', created: Date.now() });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await setDoc(sessRef, { role:'host', created: Date.now(), offer: offer }, { merge: true });

    // ICE
    const callerCandidates = collection(state.db, 'qr_remote_sessions', code, 'callerCandidates');
    pc.onicecandidate = async function(ev){ if(ev.candidate){ await addDoc(callerCandidates, ev.candidate.toJSON()); } };

    // Listen for answer
    onSnapshot(sessRef, async function(snap){
      const data = snap.data();
      if(!data) return;
      if(data.answer && !pc.currentRemoteDescription){
        try{ await pc.setRemoteDescription(data.answer); state.host.status='connected'; }catch(e){ console.warn('setRemoteDesc', e); }
      }
    });

    // Listen for callee ICE
    const calleeCandidates = collection(state.db, 'qr_remote_sessions', code, 'calleeCandidates');
    onSnapshot(calleeCandidates, async function(snapshot){
      snapshot.docChanges().forEach(async function(change){
        if(change.type==='added'){
          try{ await pc.addIceCandidate(change.doc.data()); }catch(e){ console.warn('addIceCandidate', e); }
        }
      });
    });

    return { code: code };
  }

  async function joinAsCamera(code){
    if(!initIfEnabled()) throw new Error('Remote disabled');
    if(state.join.pc){ try{ state.join.pc.close(); }catch(_e){}; state.join.pc=null; }
    const pc = new RTCPeerConnection(pcConfig);
    state.join.pc = pc; state.join.status='joining'; state.join.code = code;
    const sessRef = doc(state.db, 'qr_remote_sessions', code);
    const sessSnap = await getDoc(sessRef);
    if(!sessSnap.exists()){ throw new Error('Session not found'); }
    const data = sessSnap.data();
    if(!data.offer){ throw new Error('Host not ready'); }

    // Add local camera to send
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width:{ideal:1280}, height:{ideal:720} }, audio:false });
    s.getTracks().forEach(function(t){ pc.addTrack(t, s); });

    // Answer
    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await setDoc(sessRef, { answer: answer }, { merge:true });

    // ICE
    const calleeCandidates = collection(state.db, 'qr_remote_sessions', code, 'calleeCandidates');
    pc.onicecandidate = async function(ev){ if(ev.candidate){ await addDoc(calleeCandidates, ev.candidate.toJSON()); } };

    const callerCandidates = collection(state.db, 'qr_remote_sessions', code, 'callerCandidates');
    onSnapshot(callerCandidates, async function(snapshot){
      snapshot.docChanges().forEach(async function(change){
        if(change.type==='added'){
          try{ await pc.addIceCandidate(change.doc.data()); }catch(e){ console.warn('addIceCandidate', e); }
        }
      });
    });

    pc.oniceconnectionstatechange = function(){ console.log('[join] ice', pc.iceConnectionState); };
    return true;
  }

  function getRemoteStream(){ return state.remoteStream; }
  function getHostState(){ return state.host.status; }
  function getJoinState(){ return state.join.status; }

  window.QRRemote = {
    createHost, joinAsCamera, getRemoteStream, getHostState, getJoinState
  };
})();
