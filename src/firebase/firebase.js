// src/firebase/firebase.js
import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

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

// No override; use the bucket from config
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
