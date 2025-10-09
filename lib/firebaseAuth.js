import { getAuth, GoogleAuthProvider, FacebookAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, signOut } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { app } from "./firebase";

const auth = getAuth(app);
const db = getFirestore(app);
const facebookProvider = new FacebookAuthProvider();

//  Sign up with email and password
export async function signUpUser(email, password, firstName, lastName, role = "customer") {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  // Save to Firestore
  await setDoc(doc(db, "users", user.uid), {
    email,
    firstName,
    lastName,
    role,
    createdAt: new Date(),
    verified: user.emailVerified
  });

  await sendEmailVerification(user);
  return user;
}

// Login with email/password
export async function loginUser(email, password) {
  return await signInWithEmailAndPassword(auth, email, password);
}

//  Login with Google
export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = result.user;

  // If first time user, store in Firestore
  const userDoc = doc(db, "users", user.uid);
  const docSnap = await getDoc(userDoc);

  if (!docSnap.exists()) {
    await setDoc(userDoc, {
      email: user.email,
      firstName: user.displayName?.split(" ")[0],
      lastName: user.displayName?.split(" ")[1] || "",
      role: "customer",
      createdAt: new Date(),
      verified: user.emailVerified
    });
  }

  return user;
} 
export const signInWithFacebook = async () => {
  try {
    const result = await signInWithPopup(auth, facebookProvider);
    const user = result.user;
    console.log("Facebook Login Successful:", user);
    alert(`Welcome ${user.displayName}!`);
    // You can redirect here if needed
  } catch (error) {
    console.error("❌ Facebook login failed:", error);
    alert(`Facebook login failed: ${error.message}`);
  }
};

//  Forgot password
export async function forgotPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

//  Logout
export async function logoutUser() {
  await signOut(auth);
}

export { auth };
