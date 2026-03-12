// work-manager/src/firebase/firebase.js
import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

// ✅ Paste the SAME firebaseConfig you use in the installs app.
// Usually found in: src/firebase/firebase.js (installs)
const firebaseConfig = {
  apiKey: 'AIzaSyCsrnB6h5HL5D8ITFvUv7pI1vKhtBfrZTE',
  authDomain: 'install-scheduler.firebaseapp.com',
  projectId: 'install-scheduler',
  // 👇 match exactly what Console shows in your URL
  storageBucket: 'install-scheduler.firebasestorage.app',
  messagingSenderId: '704284032157',
  appId: '1:704284032157:web:369dcf586d8214db09e874',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "australia-southeast1");