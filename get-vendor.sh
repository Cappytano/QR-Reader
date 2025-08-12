#!/usr/bin/env bash
set -e
mkdir -p vendor

get() {
  local url="$1" ; local out="$2"
  if [ -f "$out" ]; then return; fi
  echo "Downloading $out"
  curl -L "$url" -o "$out"
}

# JSZip
get "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js" "vendor/jszip.min.js"
# XLSX
get "https://cdn.jsdelivr.net/npm/xlsx@0.19.3/dist/xlsx.full.min.js" "vendor/xlsx.full.min.js"
# jsQR
get "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js" "vendor/jsQR.js"
# ZXing (UMD builds)
get "https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js" "vendor/zxing.min.js"
get "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/umd/index.min.js" "vendor/zxing-browser.min.js"
# Tesseract
get "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js" "vendor/tesseract.min.js"

echo "Done. Files in /vendor"
