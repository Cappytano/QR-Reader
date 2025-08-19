# QR-Reader — v7.1.1

**Fix:** Resolved `Unexpected token ')'` by rewriting the in‑browser ZIP builder (store‑only). Also ships proper PNG icons to eliminate the manifest icon error.

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
vendor/xlsx.full.min.js
```

## Local dev
```
npm i
npm start   # http://localhost:8080
```

## GitHub Pages
Push all files (including `/vendor`). Enable Pages → deploy from branch root.
