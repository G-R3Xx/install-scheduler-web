// src/services/surveyService.js
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { db, storage } from '../firebase/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * Upload a Blob/File to Firebase Storage and return its download URL.
 */
async function uploadToStorage(path, blobOrFile) {
  const r = ref(storage, path);
  await uploadBytes(r, blobOrFile);
  return await getDownloadURL(r);
}

/**
 * createSurvey
 * Saves a survey record (surveys collection) and, if jobId is supplied,
 * writes the captured survey fields into jobs/{jobId} and flips jobType -> 'survey'.
 *
 * @param {{
 *  client: { name:string, company?:string, contact?:string, phone?:string, email?:string, address?:string, description?:string },
 *  signs: Array<{ id:string, name?:string, description?:string, fileOriginal?:File|null, previewBlob?:Blob|null, annotatedBlob?:Blob|null, stageJSON?:any }>,
 *  referencePhotoFiles: File[],
 *  jobId?: string|null
 * }} payload
 * @returns {Promise<string>} surveyId
 */
export async function createSurvey(payload) {
  const {
    client,
    signs = [],
    referencePhotoFiles = [],
    jobId = null,
  } = payload || {};

  // 1) Create surveys/{surveyId} first (so we have an id to group uploads)
  const surveyDocRef = await addDoc(collection(db, 'surveys'), {
    createdAt: serverTimestamp(),
    client: client || {},
    linkedJobId: jobId || null,
    signs: [],
    referencePhotos: [],
  });
  const surveyId = surveyDocRef.id;

  // 2) Upload all assets
  const uploadedSigns = [];
  for (const s of signs) {
    // If no image was provided for this sign, keep metadata only
    let originalUrl = null;
    let annotatedUrl = null;

    if (s.fileOriginal) {
      originalUrl = await uploadToStorage(
        `surveys/${surveyId}/signs/${s.id || Date.now()}_orig.jpg`,
        s.fileOriginal
      );
    } else if (s.previewBlob) {
      // Fallback: previewBlob can be used as "original" if no fileOriginal present
      originalUrl = await uploadToStorage(
        `surveys/${surveyId}/signs/${s.id || Date.now()}_orig.jpg`,
        s.previewBlob
      );
    }

    if (s.annotatedBlob) {
      annotatedUrl = await uploadToStorage(
        `surveys/${surveyId}/signs/${s.id || Date.now()}_annot.jpg`,
        s.annotatedBlob
      );
    }

    uploadedSigns.push({
      id: s.id || null,
      name: s.name || '',
      description: s.description || '',
      originalImageUrl: originalUrl,
      annotatedImageUrl: annotatedUrl,
      stageJSON: s.stageJSON || null,
    });
  }

  const uploadedRefs = [];
  for (const f of referencePhotoFiles) {
    const url = await uploadToStorage(
      `surveys/${surveyId}/reference/${Date.now()}_${f.name || 'ref.jpg'}`,
      f
    );
    uploadedRefs.push(url);
  }

  // 3) Persist assets on surveys/{surveyId}
  await updateDoc(surveyDocRef, {
    signs: uploadedSigns,
    referencePhotos: uploadedRefs,
    updatedAt: serverTimestamp(),
  });

  // 4) If this survey came from a "survey-request" job, mirror the important bits into the job
  if (jobId) {
    const jobRef = doc(db, 'jobs', jobId);
    // Ensure job exists
    const jobSnap = await getDoc(jobRef);
    if (!jobSnap.exists()) {
      // If somehow not present, create a minimal record
      await setDoc(jobRef, { createdAt: serverTimestamp() }, { merge: true });
    }

    await updateDoc(jobRef, {
      jobType: 'survey',                // <-- this moves it to the Surveys tab / list
      description: client?.description || jobSnap.data()?.description || '',
      signs: uploadedSigns,
      referencePhotos: uploadedRefs,
      updatedAt: serverTimestamp(),
      lastSurveyId: surveyId,
    });
  }

  return surveyId;
}

/**
 * convertSurveyToJob
 * Takes a jobs/{jobId} document that currently represents a survey and converts it into a real job.
 * Optionally sets installDate and assignedTo.
 *
 * @param {string} jobId
 * @param {{ installDate?: Date|null, assignedTo?: string[] , keepExistingDescription?: boolean }} options
 */
export async function convertSurveyToJob(jobId, options = {}) {
  const { installDate = null, assignedTo = [], keepExistingDescription = true } = options;

  const updates = {
    jobType: 'job',
    status: 'in progress',
    updatedAt: serverTimestamp(),
  };

  if (installDate instanceof Date) {
    // store as Firestore Timestamp; UI already treats this as local date/time
    updates.installDate = Timestamp.fromDate(installDate);
  }

  if (Array.isArray(assignedTo) && assignedTo.length) {
    updates.assignedTo = assignedTo;
  }

  // keepExistingDescription: no-op here; if false you could blank it
  if (!keepExistingDescription) {
    updates.description = '';
  }

  await updateDoc(doc(db, 'jobs', jobId), updates);
}
