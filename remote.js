// remote.js - stub for remote camera peer page.
// Loaded as a module on both index.html and remote.html.

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  // Elements only present on remote.html
  var rVideo = document.getElementById('rVideo');
  var rStart = document.getElementById('rStart');
  var rStop = document.getElementById('rStop');
  var rStatus = document.getElementById('rStatus');

  // If these don't exist, we're on the main QR-Reader page.
  if (!rStart || !rStop || !rStatus) {
    return;
  }

  function setStatus(msg) {
    rStatus.textContent = msg || '';
  }

  rStart.addEventListener('click', function () {
    // This build deliberately does NOT include signaling/WebRTC.
    setStatus(
      'Remote peer stub only. Implement your WebRTC signaling ' +
      'and attach an incoming MediaStream to the video element.'
    );
  });

  rStop.addEventListener('click', function () {
    try {
      if (rVideo && rVideo.srcObject && rVideo.srcObject.getTracks) {
        var tracks = rVideo.srcObject.getTracks();
        tracks.forEach(function (t) { t.stop(); });
      }
    } catch (e) {
      // ignore
    }
    if (rVideo) {
      rVideo.srcObject = null;
    }
    setStatus('Stopped.');
  });
})();
