# QR-Reader — v7.0

**Full edition**: Multi‑engine (BarcodeDetector → ZXing → jsQR), delayed scale weight + photo (OCR/WebHID/WebBLE), CSV/XLSX/ZIP export, CSV+XLSX import, remote camera (WebRTC), phone→PC (Serial), PWA, localhost server.

## One-time vendor step (prevents 404s)
Populate `/vendor` locally (no CDNs at runtime), then commit:
```
Windows PowerShell: .\get-vendor.ps1
macOS/Linux:       bash get-vendor.sh
```
This will create:
```
vendor/zxing.min.js
vendor/zxing-browser.min.js
vendor/jsQR.js
vendor/tesseract.min.js
vendor/xlsx.full.min.js
```

## Run locally
```
npm i
npm start   # http://localhost:8080
```

## Deploy on GitHub Pages
Push all files (including `/vendor`). Enable Pages → deploy from branch root.

## Remote camera
Edit `remote.js`: set `window.QR_REMOTE.firebaseConfig = { /* your Firebase config */ }` and enable Anonymous auth + Realtime Database. Or replace the signaling with your own WebSocket server.
