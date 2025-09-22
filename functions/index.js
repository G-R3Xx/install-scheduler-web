// functions/index.js
const { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();

/**
 * Maintain completedPhotoCount on job doc
 */
exports.completedPhotoAdded = onDocumentCreated('jobs/{jobId}/completedPhotos/{photoId}', async (event) => {
  const { jobId } = event.params;
  await db.doc(`jobs/${jobId}`).update({
    completedPhotoCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
});

exports.completedPhotoDeleted = onDocumentDeleted('jobs/{jobId}/completedPhotos/{photoId}', async (event) => {
  const { jobId } = event.params;
  await db.doc(`jobs/${jobId}`).update({
    completedPhotoCount: admin.firestore.FieldValue.increment(-1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
});

/**
 * Maintain hoursTotal on job doc
 */
exports.timeEntryAdded = onDocumentCreated('jobs/{jobId}/timeEntries/{entryId}', async (event) => {
  const { jobId } = event.params;
  const data = event.data?.data() || {};
  const hours = Number(data.hours || 0);
  if (!hours) return;
  await db.doc(`jobs/${jobId}`).update({
    hoursTotal: admin.firestore.FieldValue.increment(hours),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
});

// if you ever allow editing time entries:
exports.timeEntryUpdated = onDocumentUpdated('jobs/{jobId}/timeEntries/{entryId}', async (event) => {
  const { jobId } = event.params;
  const before = Number(event.data.before.data()?.hours || 0);
  const after = Number(event.data.after.data()?.hours || 0);
  const diff = after - before;
  if (!diff) return;
  await db.doc(`jobs/${jobId}`).update({
    hoursTotal: admin.firestore.FieldValue.increment(diff),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
});

exports.timeEntryDeleted = onDocumentDeleted('jobs/{jobId}/timeEntries/{entryId}', async (event) => {
  const { jobId } = event.params;
  const data = event.data?.data() || {};
  const hours = Number(data.hours || 0);
  if (!hours) return;
  await db.doc(`jobs/${jobId}`).update({
    hoursTotal: admin.firestore.FieldValue.increment(-hours),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
});
