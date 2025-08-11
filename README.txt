QR Logger — v5.1 (Patched + A11y + Cross‑Browser)
=====================================================

Deploy
------
1) Upload these files to your GitHub Pages repo (root).
2) Keep the `icons/` folder and `manifest.webmanifest` at the root.
3) Commit → push → open your Pages URL. You should see an "Install App" button.

Pair by Code (optional)
-----------------------
- Edit `pairing-config.js` and paste your Firebase Web config.
- Enable Firestore (production mode is fine) and deploy. The "Pair by Code" UI will work.

Service Worker
--------------
- Minimal, network-first SW to satisfy PWA install on Chrome/Edge.
