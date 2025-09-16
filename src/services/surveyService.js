// src/services/surveyService.js
import { db } from '../firebase/firebase';
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { v4 as uuid } from 'uuid';

const storage = getStorage();

/**
 * Upload a file/blob to Firebase Storage and return its download URL.
 */
async function uploadToStorage(path, fileOrBlob) {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, fileOrBlob);
  return await getDownloadURL(storageRef);
}

/**
 * Create a new survey in Firestore + Storage
 * @param {Object} opts
 * @param {Object} opts.client  Client details
 * @param {Array} opts.signs  Signs array from SiteSurveyPage
 * @param {Array<File>} opts.referencePhotoFiles
 * @returns {string} surveyId
 */
export async function createSurvey({ client, signs, referencePhotoFiles }) {
  // 1. Create a new survey document in "jobs"
  const surveyId = uuid();
  const surveyDocRef = doc(db, 'jobs', surveyId);

  const baseData = {
    jobType: 'survey',
    status: 'in progress',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    clientName: client.name || '',
    company: client.company || '',
    contact: client.contact || '',
    phone: client.phone || '',
    email: client.email || '',
    address: client.address || '',
    description: client.description || '',
    signs: [], // we’ll update after uploads
    referencePhotos: [],
  };

  await setDoc(surveyDocRef, baseData);

  // 2. Upload signs (original + annotated)
  const uploadedSigns = [];
  for (const sign of signs) {
    if (!sign.fileOriginal) continue;

    const signId = sign.id || uuid();

    // Upload original
    const origUrl = await uploadToStorage(
      `surveys/${surveyId}/signs/${signId}_orig.jpg`,
      sign.fileOriginal
    );

    // Upload annotated (if present)
    let annotatedUrl = null;
    if (sign.annotatedBlob) {
      annotatedUrl = await uploadToStorage(
        `surveys/${surveyId}/signs/${signId}_annot.jpg`,
        sign.annotatedBlob
      );
    }

    uploadedSigns.push({
      id: signId,
      name: sign.name || '',
      description: sign.description || '',
      originalImageUrl: origUrl,
      annotatedImageUrl: annotatedUrl,
      stageJSON: sign.stageJSON || null,
    });
  }

  // 3. Upload reference photos
  const refUrls = [];
  for (const f of referencePhotoFiles || []) {
    const rid = uuid();
    const url = await uploadToStorage(`surveys/${surveyId}/ref/${rid}.jpg`, f);
    refUrls.push(url);
  }

  // 4. Update doc with uploaded info
  await updateDoc(surveyDocRef, {
    signs: uploadedSigns,
    referencePhotos: refUrls,
    updatedAt: serverTimestamp(),
  });

  return surveyId;
}

/**
 * Convert an existing survey to a normal job
 */
export async function convertSurveyToJob(surveyId, { installDate, assignedTo, keepExistingDescription = false }) {
  const jobDocRef = doc(db, 'jobs', surveyId);

  await updateDoc(jobDocRef, {
    jobType: 'job',
    installDate: installDate || null,
    assignedTo: assignedTo || [],
    updatedAt: serverTimestamp(),
  });
}
