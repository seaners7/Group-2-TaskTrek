// src/lib/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, onAuthStateChanged  } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCVZmortwiPrLezWCxQo53u60b4-IGgeWw",
  authDomain: "tasktrek-e7a04.firebaseapp.com",
  projectId: "tasktrek-e7a04",
  storageBucket: "tasktrek-e7a04.firebasestorage.app",
  messagingSenderId: "900463967783",
  appId: "1:900463967783:web:9dc9485517aa908fbdd802",
  measurementId: "G-6BCT9FME3V"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Global User State ---
let currentUser = null;
let currentUserData = null; // To store data from 'users' collection

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const userDocRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists()) {
      currentUserData = docSnap.data();
      // Dispatch a custom event to notify pages that user data is loaded
      window.dispatchEvent(new CustomEvent('user-loaded', { detail: { user, userData: currentUserData } }));
    }
  } else {
    currentUser = null;
    currentUserData = null;
    // Redirect to login if user is not logged in and not on an auth page
    if (!window.location.pathname.includes('auth.html') && !window.location.pathname.includes('index.html')) {
      window.location.href = 'auth.html';
    }
  }
});

// --- Helper Functions ---


/**
 * Gets the current user's UID.
 * @returns {string|null} The user's UID or null if not logged in.
 */
function getCurrentUserId() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

/**
 * Formats a Firestore Timestamp or Date object into a relative time string.
 * @param {object|Date} timestamp - The timestamp or date to format.
 * @returns {string} A relative time string (e.g., "2h ago").
 */
function formatTimeAgo(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : timestamp;
  if (!(date instanceof Date) || isNaN(date)) {
    return 'a while ago';
  }
  const seconds = Math.floor((new Date() - date) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " years ago";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " months ago";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " days ago";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " hours ago";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " minutes ago";
  return Math.floor(seconds) + " seconds ago";
}

// Export everything to be used by other scripts
export {
  app,
  auth,
  db,
  currentUser,
  currentUserData,
  onAuthStateChanged,
  doc,
  getDoc,
  updateDoc,
  increment,
  serverTimestamp,
  getCurrentUserId,
  formatTimeAgo
};