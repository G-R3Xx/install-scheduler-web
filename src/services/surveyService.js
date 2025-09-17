// src/services/surveyService.js
import { db, storage } from '../firebase/firebase';
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { v4 as uuid } from 'uuid';

/**
 * Upload a blob/file to Firebase Storage and return its download URL.
 */
async function uploadToStorage(path, fileOrBlob) {
  const r = ref(storage, path);
  await uploadBytes(r, fileOrBlob);
  return await getDownloadURL(r);
}

/**
 * Create or finalize a survey.
 * - If jobId is provided (survey-request flow), we UPDATE that job doc in /jobs
 *   with full survey data and flip jobType to 'survey'.
 * - If no jobId is provided, we CREATE a new doc in /jobs with jobType 'survey'.
 *
 * @param {Object} options
 * @param {Object} options.client
 * @param {Array}  options.signs  [{id,name,description,fileOriginal,annotatedBlob,stageJSON}]
 * @param {Array<File>} options.referencePhotoFiles
 * @param {string=} options.jobId  existing job to turn into a survey
 * @returns {string} surveyId (the job doc id in /jobs)
 */
export async function createSurvey({ client, signs, referencePhotoFiles = [], jobId }) {
  const surveyId = jobId || uuid(); // keep the same id if we’re finalizing a survey-request

  // 1) Upload sign images (original + annotated)
  const uploadedSigns = [];
  for (const s of signs) {
    let originalUrl = null;
    let annotatedUrl = null;

    if (s.fileOriginal) {
      originalUrl = await uploadToStorage(
        `surveys/${surveyId}/signs/${s.id || uuid()}_original.jpg`,
        s.fileOriginal
      );
    }
    if (s.annotatedBlob) {
      annotatedUrl = await uploadToStorage(
        `surveys/${surveyId}/signs/${s.id || uuid()}_annotated.jpg`,
        s.annotatedBlob
      );
    }

    uploadedSigns.push({
      id: s.id || uuid(),
      name: s.name || '',
      description: s.description || '',
      originalImageUrl: originalUrl,
      annotatedImageUrl: annotatedUrl,
      stageJSON: s.stageJSON || null,
    });
  }

  // 2) Upload reference photos
  const refPhotoUrls = [];
  for (const f of referencePhotoFiles) {
    const url = await uploadToStorage(`surveys/${surveyId}/reference/${Date.now()}_${f.name}`, f);
    refPhotoUrls.push(url);
  }

  // 3) Build survey payload
  const payload = {
    jobType: 'survey',
    status: 'in progress',
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(), // set on first write; harmless on update
    // client details
    clientName: client?.name || '',
    company: client?.company || '',
    contact: client?.contact || '',
    phone: client?.phone || '',
    email: client?.email || '',
    address: client?.address || '',
    description: client?.description || '',
    // survey data
    signs: uploadedSigns,
    referencePhotos: refPhotoUrls,
  };

  // 4) Write to /jobs/{surveyId}
  const docRef = doc(db, 'jobs', surveyId);
  await setDoc(docRef, payload, { merge: true }); // merge to preserve any existing bare fields

  return surveyId;
}

/**
 * Convert an existing survey (in /jobs with jobType: 'survey') into a scheduled job.
 * @param {string} surveyId
 * @param {Object} options
 * @param {Date|null=} options.installDate  (JS Date or null)
 * @param {string[]=} options.assignedTo    array of user IDs
 * @param {boolean=} options.keepExistingDescription
 */
export async function convertSurveyToJob(
  surveyId,
  { installDate = null, assignedTo = [], keepExistingDescription = true } = {}
) {
  const docRef = doc(db, 'jobs', surveyId);

  // We only flip type + scheduling/assignment; leave survey fields intact
  const update = {
    jobType: 'job',
    updatedAt: serverTimestamp(),
    assignedTo: Array.isArray(assignedTo) ? assignedTo : [],
    installDate: installDate || null,
  };

  // If you wanted to clear survey-only fields on convert, you could do it here.
  // For now we keep description/signs/referencePhotos for history.

  await updateDoc(docRef, update);
}
