# Download pinned vendor libs locally (no CDN at runtime)
$ProgressPreference='SilentlyContinue'
mkdir vendor -ea 0 | Out-Null
function Get-IfMissing($url,$out){ if(Test-Path $out){ return }; Write-Host "Downloading $out"; Invoke-WebRequest -Uri $url -OutFile $out }
# ZXing
Get-IfMissing "https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js" "vendor/zxing.min.js"
Get-IfMissing "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/umd/index.min.js" "vendor/zxing-browser.min.js"
# jsQR
Get-IfMissing "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js" "vendor/jsQR.js"
# Tesseract
Get-IfMissing "https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js" "vendor/tesseract.min.js"
# SheetJS
Get-IfMissing "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" "vendor/xlsx.full.min.js"
Write-Host "Done. Commit the files under /vendor to your repo."
