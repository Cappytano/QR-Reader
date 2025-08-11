QR Logger — v5.2
====================
What’s inside
-------------
- index.html (scanner + log + remote 2-device + a11y)
- manifest.webmanifest (PWA)
- sw.js (service worker)
- icons/icon-192.png, icons/icon-512.png
- pairing-config.js (optional Firebase pairing placeholder)
- .well-known/assetlinks.json (optional Android app link placeholder)

Deploy (GitHub Pages)
---------------------
1) Upload everything in this ZIP to your repo root (e.g., <user>.github.io/QR-Reader/).
2) Commit + push. Wait ~30s. Hard-refresh the page (Shift+Reload).
3) If you previously installed it as a PWA, uninstall once to clear the old cache.

Remote Mode (two-device)
------------------------
- Host (PC): Open site → Remote Mode → Role: Host → Start → Create Offer.
  * Copy the Offer text or show the Offer QR.
- Camera (phone): Remote Mode → Role: Camera → Start → Scan Offer QR or paste Offer → Apply Offer → Copy/Show Answer back to Host.
- Optional: Pair by Code uses Firebase. Add your config in pairing-config.js and create a `qrRooms` collection in Firestore.

Common tips
-----------
- If camera doesn’t prompt on Android, tap the address-bar lock (ⓘ/🔒) → Permissions → Camera → Allow, then reload.
- Use Torch and Zoom for tiny or low-contrast codes. ROI “Center square” often decodes better than full-frame.
