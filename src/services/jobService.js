import { db } from '../firebase/firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

export function subscribeToAllJobs(onSnapshotCallback) {
  const q = query(collection(db, 'jobs'));
  return onSnapshot(q, onSnapshotCallback);
}

export function subscribeToStaffJobs(uid, onSnapshotCallback) {
  const q = query(
    collection(db, 'jobs'),
    where('assignedTo', '==', uid)
  );
  return onSnapshot(q, onSnapshotCallback);
}
