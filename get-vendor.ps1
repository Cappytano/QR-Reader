# Download pinned vendor libs locally (no CDN at runtime)
$ProgressPreference='SilentlyContinue'
mkdir vendor -ea 0 | Out-Null
function Get-IfMissing($url,$out){ if(Test-Path $out){ return }; Write-Host "Downloading $out"; Invoke-WebRequest -Uri $url -OutFile $out }
# zxing-wasm (IIFE reader + WASM)
Get-IfMissing "https://cdn.jsdelivr.net/npm/zxing-wasm@2.2.1/dist/iife/reader/index.js" "vendor/zxing-wasm-reader.iife.js"
Get-IfMissing "https://cdn.jsdelivr.net/npm/zxing-wasm@2.2.1/dist/reader/zxing_reader.wasm" "vendor/zxing_reader.wasm"
# jsQR
Get-IfMissing "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js" "vendor/jsQR.js"
# Tesseract.js
Get-IfMissing "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" "vendor/tesseract.min.js"
# SheetJS (XLSX)
Get-IfMissing "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" "vendor/xlsx.full.min.js"
Write-Host "Done. Commit the files under /vendor to your repo."
