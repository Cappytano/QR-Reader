# QR-Reader / QR Logger — v5.3.1

Everything you need for GitHub Pages **and** local Windows hosting.

## What’s inside
- `index.html` — Scanner UI with **delayed weight capture**, **photo**, **ZIP export (CSV+photos)**, Excel/CSV, editable table.
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA install + offline, correct paths for GitHub Pages.
- `server.js`, `package.json` — Tiny Node static server (if you want to run from `http://localhost`).
- `Start-QR-Logger-Server.bat` / `.ps1` — one‑click start for Windows.
- `pairing-config.js` — optional template for future “pair-by-code” remote mode.
- `.nojekyll` — prevents GitHub Pages from treating folders/files oddly.

## Deploy to GitHub Pages
1. Upload the **contents of this ZIP** to your repo (root folder). Make sure the paths stay the same (`icons/…`, not nested twice).
2. Commit & push.
3. Go to **Settings → Pages** and set **Branch: `main` / folder: `/ (root)`**.
4. Visit: `https://<your-user>.github.io/<repo>/` (e.g. `https://cappytano.github.io/QR-Reader/`).  
   Hard refresh with **Shift+Reload** if you had an older version cached.

## Run on Windows (localhost)
- Install Node.js (LTS). Then in the folder, run:
  ```bat
  npm i
  node server.js
  ```
- Or double‑click **Start-QR-Logger-Server.bat** (PowerShell variant included).
- App will be at: **http://localhost:8080/**
- On Android Chrome, the camera requires HTTPS; localhost is OK on desktop, but for phones use GitHub Pages (HTTPS) or “Remote mode” later.

## Notes
- WebHID & WebBluetooth need a **user gesture** (click) and **HTTPS**.
- OCR depends on lighting/contrast and camera resolution.
- Export ZIP writes photos into `/photos` and points the CSV “Photo” column to those filenames.
