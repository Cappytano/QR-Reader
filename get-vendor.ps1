# Download pinned vendor libs locally (no CDN at runtime)
$ProgressPreference='SilentlyContinue'
mkdir vendor -ea 0 | Out-Null
mkdir vendor\tesseract-core -ea 0 | Out-Null
mkdir vendor\lang-data -ea 0 | Out-Null
function Get-IfMissing($url,$out){ if(Test-Path $out){ return }; Write-Host "Downloading $out"; Invoke-WebRequest -Uri $url -OutFile $out }

# zxing-wasm (IIFE reader + WASM)
Get-IfMissing "https://cdn.jsdelivr.net/npm/zxing-wasm@2.2.1/dist/iife/reader/index.js" "vendor/zxing-wasm-reader.iife.js"
Get-IfMissing "https://cdn.jsdelivr.net/npm/zxing-wasm@2.2.1/dist/reader/zxing_reader.wasm" "vendor/zxing_reader.wasm"

# jsQR
Get-IfMissing "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js" "vendor/jsQR.js"

# Tesseract.js + worker + core + language
Get-IfMissing "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js" "vendor/tesseract.min.js"
Get-IfMissing "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js" "vendor/worker.min.js"
Get-IfMissing "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.1/tesseract-core.wasm.js" "vendor/tesseract-core/tesseract-core.wasm.js"
Get-IfMissing "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.1/tesseract-core.wasm" "vendor/tesseract-core/tesseract-core.wasm"
Get-IfMissing "https://tessdata.projectnaptha.com/5/eng.traineddata.gz" "vendor/lang-data/eng.traineddata.gz"

# SheetJS (XLSX)
Get-IfMissing "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" "vendor/xlsx.full.min.js"

Write-Host "Done. Commit the files under /vendor to your repo."
