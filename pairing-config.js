// pairing-config.js — enable/disable Remote Camera and provide Firebase config.
// 1) Set enabled:true
// 2) Paste your firebaseConfig object from Firebase console (Project settings → Web app).
// 3) Ensure Anonymous Auth is enabled and Firestore is created.
// Example minimal Firestore rules (adjust to your needs):
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /qr_remote_sessions/{code} {
//       allow read, write: if true; // dev only; tighten for production
//       match /callerCandidates/{doc} { allow read, write: if true; }
//       match /calleeCandidates/{doc} { allow read, write: if true; }
//     }
//   }
// }

window.QR_REMOTE = {
  enabled: false, // <-- flip to true after adding your config
  firebaseConfig: {
    // apiKey: "",
    // authDomain: "",
    // projectId: "",
    // storageBucket: "",
    // messagingSenderId: "",
    // appId: ""
  }
};
