// remote.js — stub; add your signaling to enable remote camera
export const Remote = (function(){ return { init(){ /* add Firebase/WebSocket signaling here */ } }; })();
document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('remoteStatus');
  const hostBtn = document.getElementById('remoteHostBtn');
  const joinBtn = document.getElementById('remoteJoinBtn');
  if (hostBtn) hostBtn.addEventListener('click', function(){ if(status) status.textContent='Remote host: waiting for signaling setup.'; });
  if (joinBtn) joinBtn.addEventListener('click', function(){ if(status) status.textContent='Remote join: waiting for signaling setup.'; });
});
