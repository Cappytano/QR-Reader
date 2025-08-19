#!/usr/bin/env bash
set -e
mkdir -p vendor vendor/tesseract-core vendor/lang-data
get(){ local url="$1"; local out="$2"; if [ -f "$out" ]; then return; fi; echo "Downloading $out"; curl -L "$url" -o "$out"; }
# zxing-wasm (IIFE reader + WASM)
get "https://cdn.jsdelivr.net/npm/zxing-wasm@2.2.1/dist/iife/reader/index.js" "vendor/zxing-wasm-reader.iife.js"
get "https://cdn.jsdelivr.net/npm/zxing-wasm@2.2.1/dist/reader/zxing_reader.wasm" "vendor/zxing_reader.wasm"
# jsQR
get "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js" "vendor/jsQR.js"
# Tesseract.js + worker + core + language
get "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" "vendor/tesseract.min.js"
get "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js" "vendor/worker.min.js"
get "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js" "vendor/tesseract-core/tesseract-core.wasm.js"
get "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.wasm" "vendor/tesseract-core/tesseract-core.wasm.wasm"
get "https://tessdata.projectnaptha.com/5/eng.traineddata.gz" "vendor/lang-data/eng.traineddata.gz"
# SheetJS (XLSX)
get "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" "vendor/xlsx.full.min.js"
echo "Done. Commit the files under /vendor to your repo."
