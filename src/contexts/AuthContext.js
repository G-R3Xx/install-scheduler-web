// src/contexts/AuthContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../firebase/firebase';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { doc, setDoc, getDoc, collection, onSnapshot } from 'firebase/firestore';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [userList, setUserList] = useState([]);

  function signup(email, password) {
    return createUserWithEmailAndPassword(auth, email, password)
      .then((cred) =>
        setDoc(doc(db, 'users', cred.user.uid), {
          email: cred.user.email,
          role: 'staff'
        })
      );
  }

  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  function logout() {
    return signOut(auth);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoadingAuth(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setUserProfile(null);
      return;
    }

    getDoc(doc(db, 'users', currentUser.uid))
      .then((snap) => {
        if (snap.exists()) setUserProfile(snap.data());
        else setUserProfile(null);
      })
      .catch(console.error);
  }, [currentUser]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const users = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      setUserList(users);
    });

    return () => unsubscribe();
  }, []);

  const userMap = userList.reduce((map, user) => {
    map[user.id] = user;
    return map;
  }, {});

  const value = {
    currentUser,
    userProfile,
    profile: userProfile,
    userList,
    userMap,
    signup,
    login,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {!loadingAuth && children}
    </AuthContext.Provider>
  );
}