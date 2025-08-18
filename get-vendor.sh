#!/usr/bin/env bash
set -e
mkdir -p vendor
get(){ local url="$1"; local out="$2"; if [ -f "$out" ]; then return; fi; echo "Downloading $out"; curl -L "$url" -o "$out"; }
# ZXing
get "https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js" "vendor/zxing.min.js"
get "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/umd/index.min.js" "vendor/zxing-browser.min.js"
# jsQR
get "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js" "vendor/jsQR.js"
# Tesseract
get "https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js" "vendor/tesseract.min.js"
# SheetJS
get "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" "vendor/xlsx.full.min.js"
echo "Done. Commit the files under /vendor to your repo."
