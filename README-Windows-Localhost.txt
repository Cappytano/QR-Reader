QR Logger — Windows 11 optimized (Chrome/Edge)
===================================================

Localhost options
-----------------
1) Double-click `Start-QR-Logger-Server.bat` (recommended on Windows):
   - Uses Node/Express if Node is installed, otherwise Python's http.server.
   - Opens http://localhost:5500 in your default browser.

2) PowerShell:
   - Right-click `Start-QR-Logger-Server.ps1` → Run with PowerShell.
   - If you see an execution policy warning, run PowerShell as Administrator and:
       Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

3) Node.js (manual):
   - Install Node: https://nodejs.org/
   - Open a terminal in this folder and run:
       npm install
       npm start
   - Visit: http://localhost:5500
   - For HTTPS (optional): npm run start:https
     (A self-signed cert is generated; proceed past the browser warning.)

4) Python (manual):
   - python -m http.server 5500
   - Visit: http://localhost:5500

Notes for camera access
-----------------------
- Browser must be on HTTPS or `http://localhost` for camera to work.
- Windows 11: Settings → Privacy & security → Camera → Allow camera access (system and browser).
- Chrome/Edge: Click the camera icon in the address bar → Always allow.

Deploy to GitHub Pages
----------------------
1) Create a new repo and push these files (index.html, server.js, package.json, etc.).
2) In GitHub, go to Settings → Pages → Build and deployment:
   - Source: "Deploy from a branch"
   - Branch: "main" (or your default) / folder: "/root" (or "/docs" if you put files there)
3) Open the Pages URL. (Camera works because GitHub Pages uses HTTPS.)

Deploy to Netlify
-----------------
1) Go to https://app.netlify.com/ → "Add new site" → "Import an existing project".
2) Connect your GitHub repo or drag-and-drop this folder into the Netlify UI.
3) Build settings: no build command needed (static site). Publish directory: root.
4) Click "Deploy site" and open the URL (HTTPS by default).

Troubleshooting
---------------
- "No cameras detected": Click "Request Permission", then "Refresh Cameras".
- "Starting camera…" hangs: another app (Teams/Meet/Zoom) may have locked the camera. Close it.
- Edge on Windows sometimes requires toggling camera permission for the site: lock icon → Site permissions.
- Laptop webcams can be low-res by default; this app requests 1280×720 or 1920×1080 @ ~30fps when possible.
