# QR-Reader / QR Logger — v6.1.2 (No external libs)

**What changed**
- Removed all external vendor script tags and implemented:
  - Built‑in **ZIP writer** (store mode) for exporting ZIP with CSV + photos.
  - Built‑in **XLSX writer** (single‑sheet, inline strings) for Excel export.
- Scanning uses native **BarcodeDetector** for multi‑format barcodes (Chrome/Edge).
- CSV import kept; Excel import is disabled in this build.
- Bluetooth/Serial **phone input** kept. Remote WebRTC unchanged (requires your Firebase config).
- Fixed any syntax issues reported on earlier builds.

**Note on OCR:** This build doesn’t embed Tesseract because of size. OCR weight capture UI is present; choose HID/BLE/phone for weight, or I can ship a Tesseract‑bundled variant if you prefer.
