// remote.js (module) — WebRTC remote camera scaffold using Firebase RTDB (supply your config)
/*
  To enable:
  1. Include Firebase SDKs (app + database) or roll your own signaling.
  2. Set window.QR_REMOTE.firebaseConfig = { ... } in a separate script or before this module loads.
  3. Call "Create Session" on the host; on phone, open /remote.html (or same page set to 'remote' mode) and "Join" with the pairing code.
*/
export const Remote = (function(){
  function notReady(msg){ const el = document.getElementById('remoteStatus'); if(el){ el.textContent = msg; } }
  // Placeholder to avoid errors if no Firebase is present
  return { init(){ notReady('Remote camera requires signaling (Firebase/WebSocket). Edit remote.js to add your keys.'); } };
})();
document.addEventListener('DOMContentLoaded', () => {
  const srcSel = document.getElementById('cameraSource');
  const hostBtn = document.getElementById('remoteHostBtn');
  const joinBtn = document.getElementById('remoteJoinBtn');
  const status = document.getElementById('remoteStatus');
  if(!srcSel || !hostBtn || !joinBtn) return;
  hostBtn.addEventListener('click', ()=>{ status.textContent='Remote host: waiting for signaling setup.'; });
  joinBtn.addEventListener('click', ()=>{ status.textContent='Remote join: waiting for signaling setup.'; });
});
