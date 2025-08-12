# QR-Reader / QR Logger — v5.3.4

**Comprehensive fix release**: removes optional-chaining edge cases, fixes filename regex hyphen, corrects CSV/ZIP newlines,
adds button `type="button"`, and keeps CSS vendor order (`-webkit-backdrop-filter` first).

Features included:
- QR scanning (BarcodeDetector → jsQR fallback)
- Adjustable delayed capture → weight + photo
- Weight via OCR (Tesseract), USB/HID scales (WebHID), BLE Weight Scale / UART (WebBluetooth)
- Table with Date/Time/Weight/Photo, editable notes, duplicate consolidation
- Export: CSV, Excel (.xlsx), **ZIP (CSV + photos)**, Import CSV/XLSX
- PWA: manifest, icons, service worker (cache `qr-logger-v5-3-4`), offline-ready

## Deploy to GitHub Pages
Upload the contents to your repo **root** → commit → wait ~1 min → Shift+Reload.
If you installed the PWA before, uninstall once so the new SW is picked up.

## Windows localhost
```
npm i
node server.js
```
App at: http://localhost:8080/
