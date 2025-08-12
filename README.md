# QR-Reader / QR Logger — v6.1.1

## Local libraries (no CDN)
All third‑party libs load from **/vendor** (offline). I’ve included placeholders and two helper scripts to download exact versions:
- Windows: `get-vendor.ps1`
- macOS/Linux: `get-vendor.sh`

**What’s loaded locally**
- `vendor/jszip.min.js` (ZIP export)
- `vendor/xlsx.full.min.js` (Excel import/export)
- `vendor/jsQR.js` (QR fallback)
- `vendor/zxing.min.js` + `vendor/zxing-browser.min.js` (Multi‑format: UPC/EAN/Code39/Code128/ITF/Codabar/Code93 + DataMatrix/PDF417/Aztec/QR)
- `vendor/tesseract.min.js` (OCR weight from camera)

> If a file isn’t present, features gracefully degrade; BarcodeDetector still works for many codes on Chrome/Edge.

## Barcode formats supported
- With **BarcodeDetector** (Chrome/Edge): QR, Aztec, Data Matrix, PDF417, Code‑128, Code‑39, Code‑93, Codabar, ITF, EAN‑13/8, UPC‑A/E (browser‑dependent).
- With **ZXing fallback**: QR, Aztec, Data Matrix, PDF417, Code‑128/39/93, Codabar, ITF, EAN‑13/8, UPC‑A/E.  
  *MaxiCode / Micro QR* support may be limited in the JS port. If those are critical, we can add an alternate decoder (e.g., ZBar WASM or a commercial SDK).

## Remote phone via Bluetooth/Serial (Windows COM)
Click **Connect Phone (Bluetooth/Serial)** to open a COM port connected to your paired Android phone (SPP). Send newline‑delimited JSON:
```json
{"t":"qr","content":"TEXT","img":"data:image/jpeg;base64,...","ts":1700000000000}
```

## Galaxy S24 assumptions
The Android sample (below) uses **CameraX** at 1920×1080, continuous AF/AE, and ML Kit’s **BarcodeScanning** with all relevant formats.

## Scripts
- `Start-QR-Logger-Server.bat` or `Start-QR-Logger-Server.ps1` → local server for Windows 11.
- `get-vendor.ps1` / `get-vendor.sh` → download vendor libs into `/vendor` (run once).

