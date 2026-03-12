import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebase";

const ROLE_RANK = {
  staff: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function roleRank(role) {
  return ROLE_RANK[String(role || "staff").toLowerCase()] || 0;
}

function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return 0;
}

export function normalizeUserRecord(id, data = {}) {
  const email = data.email || "";
  const emailLower = data.emailLower || normalizeEmail(email);

  return {
    id,
    ...data,
    email,
    emailLower,
    uid: data.uid || data.authUid || "",
    authUid: data.authUid || data.uid || "",
    role: String(data.role || "staff").toLowerCase(),
    status: data.status || "active",
    mergedInto: data.mergedInto || "",
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    displayName:
      data.displayName ||
      [data.firstName, data.lastName].filter(Boolean).join(" ").trim() ||
      data.name ||
      "",
    shortName: data.shortName || "",
  };
}

export function pickBestProfile(candidates = [], authUser = null) {
  if (!Array.isArray(candidates) || !candidates.length) return null;

  const authUid = authUser?.uid || "";
  const authEmail = normalizeEmail(authUser?.email);

  const deduped = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate || !candidate.id) continue;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    deduped.push(candidate);
  }

  deduped.sort((a, b) => {
    const aRole = roleRank(a.role);
    const bRole = roleRank(b.role);
    if (bRole !== aRole) return bRole - aRole;

    const aUidMatch =
      a.id === authUid || a.uid === authUid || a.authUid === authUid ? 1 : 0;
    const bUidMatch =
      b.id === authUid || b.uid === authUid || b.authUid === authUid ? 1 : 0;
    if (bUidMatch !== aUidMatch) return bUidMatch - aUidMatch;

    const aEmailMatch = a.emailLower === authEmail ? 1 : 0;
    const bEmailMatch = b.emailLower === authEmail ? 1 : 0;
    if (bEmailMatch !== aEmailMatch) return bEmailMatch - aEmailMatch;

    const aNamed =
      (a.shortName ? 1 : 0) +
      (a.displayName ? 1 : 0) +
      (a.firstName ? 1 : 0) +
      (a.lastName ? 1 : 0);
    const bNamed =
      (b.shortName ? 1 : 0) +
      (b.displayName ? 1 : 0) +
      (b.firstName ? 1 : 0) +
      (b.lastName ? 1 : 0);
    if (bNamed !== aNamed) return bNamed - aNamed;

    const aUpdated = timestampToMs(a.updatedAt || a.createdAt);
    const bUpdated = timestampToMs(b.updatedAt || b.createdAt);
    return bUpdated - aUpdated;
  });

  return deduped[0] || null;
}

export function resolveCurrentUserProfile(authUser, allUsers = []) {
  if (!authUser) return null;

  const authUid = authUser.uid || "";
  const authEmail = normalizeEmail(authUser.email);

  const candidates = allUsers.filter((user) => {
    if (!user) return false;
    if (user.mergedInto) return false;
    if (String(user.status || "").toLowerCase() === "merged") return false;

    const uidMatch =
      user.id === authUid || user.uid === authUid || user.authUid === authUid;
    const emailMatch = !!authEmail && user.emailLower === authEmail;

    return uidMatch || emailMatch;
  });

  return pickBestProfile(candidates, authUser);
}

export function collapseUsersForDisplay(allUsers = []) {
  const activeUsers = allUsers.filter((user) => {
    if (!user) return false;
    if (user.mergedInto) return false;
    if (String(user.status || "").toLowerCase() === "merged") return false;
    return true;
  });

  const grouped = new Map();

  for (const user of activeUsers) {
    const key =
      user.uid ||
      user.authUid ||
      user.emailLower ||
      `doc:${user.id}`;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, user);
      continue;
    }

    const best = pickBestProfile([existing, user], {
      uid: user.uid || user.authUid || existing.uid || existing.authUid || "",
      email: user.email || existing.email || "",
    });

    grouped.set(key, best);
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const roleDiff = roleRank(b.role) - roleRank(a.role);
    if (roleDiff !== 0) return roleDiff;

    const aName =
      a.displayName ||
      [a.firstName, a.lastName].filter(Boolean).join(" ").trim() ||
      a.email ||
      "";
    const bName =
      b.displayName ||
      [b.firstName, b.lastName].filter(Boolean).join(" ").trim() ||
      b.email ||
      "";

    return aName.localeCompare(bName);
  });
}

export async function ensureUserProfile(user) {
  if (!user?.uid) return null;

  const authUid = user.uid;
  const authEmail = user.email || "";
  const authEmailLower = normalizeEmail(authEmail);
  const authDisplayName = user.displayName || "";

  const usersCol = collection(db, "users");
  const authDocRef = doc(db, "users", authUid);

  const authDocSnap = await getDoc(authDocRef);

  const candidates = [];

  if (authDocSnap.exists()) {
    candidates.push(normalizeUserRecord(authDocSnap.id, authDocSnap.data()));
  }

  if (authEmailLower) {
    const emailLowerQuery = query(
      usersCol,
      where("emailLower", "==", authEmailLower),
      limit(10)
    );
    const emailLowerSnap = await getDocs(emailLowerQuery);

    emailLowerSnap.forEach((snap) => {
      candidates.push(normalizeUserRecord(snap.id, snap.data()));
    });

    if (emailLowerSnap.empty && authEmail) {
      const emailQuery = query(usersCol, where("email", "==", authEmail), limit(10));
      const emailSnap = await getDocs(emailQuery);

      emailSnap.forEach((snap) => {
        candidates.push(normalizeUserRecord(snap.id, snap.data()));
      });
    }
  }

  const bestExisting = pickBestProfile(candidates, user);

  if (!bestExisting) {
    const freshProfile = {
      uid: authUid,
      authUid,
      email: authEmail,
      emailLower: authEmailLower,
      displayName: authDisplayName,
      firstName: "",
      lastName: "",
      shortName: "",
      role: "staff",
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    };

    await setDoc(authDocRef, freshProfile, { merge: true });

    return {
      id: authUid,
      ...freshProfile,
    };
  }

  const bestRef = doc(db, "users", bestExisting.id);

  const mergedPatch = {
    uid: authUid,
    authUid,
    email: bestExisting.email || authEmail,
    emailLower: bestExisting.emailLower || authEmailLower,
    displayName: bestExisting.displayName || authDisplayName,
    firstName: bestExisting.firstName || "",
    lastName: bestExisting.lastName || "",
    shortName: bestExisting.shortName || "",
    role: bestExisting.role || "staff",
    status: bestExisting.status === "merged" ? "active" : bestExisting.status || "active",
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  };

  await setDoc(bestRef, mergedPatch, { merge: true });

  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    if (candidate.id === bestExisting.id) continue;

    const sameEmail =
      !!authEmailLower && candidate.emailLower === authEmailLower;

    const sameUid =
      candidate.id === authUid ||
      candidate.uid === authUid ||
      candidate.authUid === authUid;

    if (!sameEmail && !sameUid) continue;

    try {
      await updateDoc(doc(db, "users", candidate.id), {
        mergedInto: bestExisting.id,
        status: "merged",
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      // ignore merge clean-up failures
      console.warn("Profile merge clean-up skipped:", error);
    }
  }

  return {
    ...bestExisting,
    ...mergedPatch,
    id: bestExisting.id,
  };
}