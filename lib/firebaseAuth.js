import { auth, db } from "./firebase.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { 
  doc, 
  setDoc, 
  getDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ✅ Google login
const googleProvider = new GoogleAuthProvider();

// -------------------------------------------
// Helper: ensure user doc exists
// -------------------------------------------
async function ensureUserDoc(user) {
  const userRef = doc(db, "users", user.uid);
  const docSnap = await getDoc(userRef);

  if (!docSnap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      name: user.displayName || "Unnamed User",
      photoURL: user.photoURL || "",
      points: 0,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp()
    });
  } else {
    // Update last login timestamp
    await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
  }
}

// -------------------------------------------
// Sign up with email + password
// -------------------------------------------
export async function signUpUser(email, password, name) {
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCred.user;
    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid,
      email,
      name,
      points: 0,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp()
    });
    return user;
  } catch (err) {
    console.error("Sign-up failed:", err);
    throw err;
  }
}

// -------------------------------------------
// Log in with email + password
// -------------------------------------------
export async function loginUser(email, password) {
  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    const user = userCred.user;
    await ensureUserDoc(user);
    return user;
  } catch (err) {
    console.error("Login failed:", err);
    throw err;
  }
}

// -------------------------------------------
// Google Sign-in
// -------------------------------------------
export async function googleLogin() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    await ensureUserDoc(user);
    return user;
  } catch (err) {
    console.error("Google login failed:", err);
    throw err;
  }
}

// -------------------------------------------
// Logout
// -------------------------------------------
export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("Logout failed:", err);
    throw err;
  }
}

// -------------------------------------------
// Auth state listener (optional global check)
// -------------------------------------------
onAuthStateChanged(auth, async (user) => {
  if (user) {
    await ensureUserDoc(user);
    console.log("User logged in:", user.email);
  } else {
    console.log("User logged out");
  }
});
