QR Logger — v4.1 (Android + Desktop tuned)
===========================================

Changes vs v4:
- Default camera = Auto (phones → back, desktop → front)
- Windows-friendly camera constraints (prefers 1280×720/1920×1080 @ ~30fps, continuous autofocus when supported)
- Keeps Android permission flow & banner, device picker, CSV/XLSX import/export, BarcodeDetector→jsQR fallback

Deploy (GitHub Pages):
1) Replace your repo's index.html with this file; commit & push.
2) Open https://<username>.github.io/<repo>/ in Chrome/Edge.
3) On Android: tap Request Permission → Allow → Start Camera.

Built: 2025-08-11T18:04:51.235508Z
