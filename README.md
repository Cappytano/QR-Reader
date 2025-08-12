# QR-Reader / QR Logger — v5.3.5

Fixes:
- Clean `startFromSelection()` catch block to avoid parser errors on page load.
- OCR Toggle now syncs a global flag so the green ROI box reliably renders.

Includes all features from 5.3.4 (QR scan, delayed weight+photo, OCR/HID/BLE scales, imports/exports, PWA, localhost).

## Deploy
Upload to repo **root**, commit, wait ~1 min, then Shift+Reload. If previously installed as PWA, uninstall/reinstall once.
