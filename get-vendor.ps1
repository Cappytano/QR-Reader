# Downloads vendor libraries locally (run from project root)
$ProgressPreference = 'SilentlyContinue'
mkdir vendor -ea 0 | Out-Null

function Get-IfMissing($url, $out){
  if(Test-Path $out){ return }
  Write-Host "Downloading $out"
  Invoke-WebRequest -Uri $url -OutFile $out
}

# JSZip
Get-IfMissing "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js" "vendor/jszip.min.js"
# XLSX
Get-IfMissing "https://cdn.jsdelivr.net/npm/xlsx@0.19.3/dist/xlsx.full.min.js" "vendor/xlsx.full.min.js"
# jsQR
Get-IfMissing "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js" "vendor/jsQR.js"
# ZXing (UMD builds)
Get-IfMissing "https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js" "vendor/zxing.min.js"
Get-IfMissing "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/umd/index.min.js" "vendor/zxing-browser.min.js"
# Tesseract
Get-IfMissing "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js" "vendor/tesseract.min.js"

Write-Host "Done. Files in /vendor"
