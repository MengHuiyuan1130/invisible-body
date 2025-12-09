// Your Firebase configuration (from console)
const firebaseConfig = {
  apiKey: "AIzaSyDSOR8rbl0bBDpUDcHVoTsZosYSCvsk_To",
  authDomain: "hacking-project-8c4a5.firebaseapp.com",
  databaseURL: "https://hacking-project-8c4a5-default-rtdb.firebaseio.com",
  projectId: "hacking-project-8c4a5",
  storageBucket: "hacking-project-8c4a5.firebasestorage.app",
  messagingSenderId: "1037897357546",
  appId: "1:1037897357546:web:a0a1703731fc6b8752df93",
  measurementId: "G-FGWBXKVWJ4"
};

// Initialize Firebase (compat syntax)
firebase.initializeApp(firebaseConfig);

// Initialize Realtime Database
const db = firebase.database();

console.log("Firebase initialized successfully!", db);

window.SESSION_ID = "session-001";