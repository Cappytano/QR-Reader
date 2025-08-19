# QR-Reader — v7.1.3

**Fixes**
- Draggable/resizable **OCR region** on the overlay canvas (mouse/touch).
- OCR now uses a **local Tesseract worker + language** (no CDN needed). Run `get-vendor.*` and commit `/vendor`.
- Export buttons (XLSX / CSV / ZIP) are wired and working.

Engine order: **BarcodeDetector → zxing-wasm → jsQR**.

## One-time vendor step (prevents 404s)
Populate `/vendor` locally, then commit:
```
Windows PowerShell: .\get-vendor.ps1
macOS/Linux:       bash get-vendor.sh
```
This will create:
```
vendor/zxing-wasm-reader.iife.js
vendor/zxing_reader.wasm
vendor/jsQR.js
vendor/tesseract.min.js
vendor/worker.min.js
vendor/tesseract-core/tesseract-core.wasm.js
vendor/tesseract-core/tesseract-core.wasm.wasm
vendor/lang-data/eng.traineddata.gz
vendor/xlsx.full.min.js
```

## Local dev
```
npm i
npm start   # http://localhost:8080
```

## GitHub Pages
Push all files (including `/vendor`). Enable Pages → deploy from branch root.
