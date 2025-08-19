# QR-Reader — v7.1.4

**Fixes**
- OCR weight automatically normalized to **grams (numeric)**. Inputs like `2.1kg`, `0.45 lb`, `10oz`, `123g` are stored as grams **without units**.
- Added a bottom-right **toast confirmation** when OCR/HID/BLE weight capture completes.
- **Excel export cannot contain > 32,767 chars per cell** (Excel limitation). The Photo column is now exported as a **filename** (e.g., `photo-<id>.jpg`) and long values are truncated. Use **ZIP** export to get actual JPEGs with a CSV.

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
