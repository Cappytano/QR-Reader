# QR-Reader — v7.1.5 (Core only)

This package includes all non-vendor files you need to deploy (GitHub Pages or localhost).
**/vendor** libs must be added separately for scanning/OCR/Excel.

## Files
- index.html
- styles.css
- app.js
- remote.html
- remote.js
- manifest.webmanifest
- sw.js
- server.js
- package.json
- .nojekyll
- icons/icon-192.png
- icons/icon-512.png

## Expected `/vendor`
```
vendor/
  zxing-wasm-reader.iife.js
  zxing_reader.wasm
  jsQR.js
  tesseract.min.js
  worker.min.js
  tesseract-core/
    tesseract-core.wasm.js
    tesseract-core.wasm
  xlsx.full.min.js
  lang-data/
    eng.traineddata.gz
```

## Run locally
```bash
npm i
npm start   # http://localhost:8080
```
