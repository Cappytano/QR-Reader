# QR-Reader / QR Logger — v6.0.0

## New: Two-device **Remote Camera** (pair code + WebRTC)
- Host creates a session (gets a 6‑digit code).
- Camera device joins with the code; its camera stream appears on the host.
- Works over HTTPS with a Firebase project for signaling (anonymous auth, Firestore).

> Fill in `pairing-config.js` with your Firebase config and set `enabled: true`.

## Still included
- QR scan (BarcodeDetector → jsQR)
- Adjustable delayed capture → **weight + photo**
- Weight via **OCR**, **USB/HID**, **Bluetooth** (WSS & UART)
- Table with Date/Time/Weight/Photo, editable notes, de‑dupe
- Export: **CSV**, **Excel**, **ZIP (CSV+photos)**; Import CSV/XLSX
- PWA (manifest/icons/SW), GitHub Pages ready, Windows localhost (`server.js`)

## Setup: Firebase (signaling)
1. Create a Firebase project → Firestore (in Native mode).
2. Enable **Anonymous Auth**.
3. In Project settings → Web app → copy config to `pairing-config.js`.
4. Ensure Firestore rules allow the minimal access (see example in that file).

## Windows localhost
```
npm i
node server.js
```
Open http://localhost:8080/

## APK option (TWA)
- Install `@bubblewrap/cli`, run `bubblewrap init` using your site URL, then `bubblewrap build`.
- This packages the PWA as an installable APK on Android.
