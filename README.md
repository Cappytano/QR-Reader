# QR-Reader / QR Logger — v6.0.2

## New
- **Post-scan cooldown** (default 5s) → reduces constant reads while swapping items.
- **Duplicate suppression** during cooldown → if the same code is seen again, it’s ignored and the 5s pause restarts.
- **Enhanced decoder** (optional): after jsQR fails, tries **qr-scanner** (WASM ZXing) on the same frame to read trickier codes.

## Still included
- Remote camera (WebRTC with pairing code, via Firestore signaling).
- Adjustable delayed capture → **weight + photo** (OCR / HID / BLE).
- Exports: **CSV**, **Excel**, **ZIP (CSV+photos)**; Import CSV/XLSX.
- PWA + Windows localhost.

## Notes
- Toggle Enhanced Decoder in the UI if some QR codes don’t read with BarcodeDetector/jsQR.
- Cooldown and duplicate suppression can be tuned in the UI.
