# QR-Reader / QR Logger — v5.3.2

**Bug‑fix release**: fixes CSV/ZIP export token errors and stray toolbar markup.
Includes scale (OCR/HID/BLE), photo capture, adjustable delay, Date/Time columns, and PWA assets.

## Deploy to GitHub Pages
1. Upload all files at the repo **root**.
2. Commit & push → wait ~1 min → Shift+Reload the site.
3. If previously installed as a PWA, uninstall/reinstall once.

## Windows localhost
```bat
npm i
node server.js
```
App at: http://localhost:8080/

Notes: WebHID/WebBluetooth require HTTPS and user gesture. OCR needs good contrast.
