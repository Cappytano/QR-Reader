# Remote camera (scaffold)

This project ships with a stub `remote.js` that **does not** include a signaling backend by default.  
Add Firebase (or your WebSocket server) to enable pairing-code sessions between Host (PC) and Phone.

Minimal approach:
1. Create a Firebase project. Enable Anonymous auth and Realtime Database.
2. Add your `firebaseConfig` and basic offer/answer exchange.
3. On Host, click "Create Session" → show 6-digit code; on Phone, select "Remote camera" and enter the code.
