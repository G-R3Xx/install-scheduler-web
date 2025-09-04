// src/services/surveyService.js
import { db, storage } from '../firebase/firebase';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * Create a survey document with:
 * - client fields
 * - signs (with optional annotated image)
 * - referencePhotos (plain images)
 */
export async function createSurvey({ client, signs, referencePhotoFiles = [] }) {
  // 1) Create base survey doc
  const surveysCol = collection(db, 'jobs');
  const surveyDocRef = await addDoc(surveysCol, {
    jobType: 'survey',
    status: 'survey', // keeps it off the schedule until converted
    createdAt: serverTimestamp(),
    clientName: client?.name || '',
    company: client?.company || '',
    contact: client?.contact || '',
    phone: client?.phone || '',
    email: client?.email || '',
    address: client?.address || '',
    description: client?.description || '',
    signs: [],           // filled after we upload files
    referencePhotos: [], // filled after we upload files
  });

  const surveyId = surveyDocRef.id;

  // 2) Upload signs (original + annotated if present), then write signs[] array
  const uploadedSigns = [];
  for (const s of signs) {
    if (!s?.fileOriginal && !s?.annotatedBlob) {
      // nothing uploaded for this sign, but still capture metadata/description
      uploadedSigns.push({
        id: s.id,
        name: s.name,
        description: s.description || '',
        originalImageUrl: '',
        annotatedImageUrl: '',
      });
      continue;
    }

    let originalUrl = '';
    let annotatedUrl = '';

    if (s.fileOriginal) {
      const origRef = ref(storage, `surveys/${surveyId}/signs/${s.id}-original-${s.fileOriginal.name}`);
      await uploadBytes(origRef, s.fileOriginal);
      originalUrl = await getDownloadURL(origRef);
    }

    if (s.annotatedBlob) {
      const annoRef = ref(storage, `surveys/${surveyId}/signs/${s.id}-annotated.png`);
      await uploadBytes(annoRef, s.annotatedBlob);
      annotatedUrl = await getDownloadURL(annoRef);
    }

    uploadedSigns.push({
      id: s.id,
      name: s.name,
      description: s.description || '',
      originalImageUrl: originalUrl,
      annotatedImageUrl: annotatedUrl,
      // keep stageJSON if you want to re-edit later
      stageJSON: s.stageJSON || null,
    });
  }

  // 3) Upload reference photos (no annotations)
  const refPhotoUrls = [];
  for (const f of referencePhotoFiles) {
    if (!f) continue;
    const r = ref(storage, `surveys/${surveyId}/referencePhotos/${f.name}`);
    await uploadBytes(r, f);
    const url = await getDownloadURL(r);
    refPhotoUrls.push(url);
  }

  // 4) Update the survey doc with signs + referencePhotos arrays
  await updateDoc(doc(db, 'jobs', surveyId), {
    signs: uploadedSigns,
    referencePhotos: refPhotoUrls,
  });

  return surveyId;
}

/**
 * Convert an existing survey (doc in jobs with jobType='survey') into a job.
 * options: { installDate, assignedTo: [uids], keepExistingDescription }
 */
export async function convertSurveyToJob(surveyId, options = {}) {
  const snap = await getDoc(doc(db, 'jobs', surveyId));
  if (!snap.exists()) throw new Error('Survey not found');
  const data = snap.data() || {};

  const payload = {
    jobType: 'job',
    status: 'in progress',
    convertedAt: serverTimestamp(),
    // make sure reference photos remain on the job
    referencePhotos: Array.isArray(data.referencePhotos) ? data.referencePhotos : [],
  };

  if (options.installDate instanceof Date) {
    payload.installDate = options.installDate;
  }
  if (Array.isArray(options.assignedTo)) {
    payload.assignedTo = options.assignedTo;
  }

  if (!options.keepExistingDescription) {
    const lines = (data.signs || [])
      .map((s, i) => `${s.name || `Sign ${i + 1}`}${s.description ? `: ${s.description}` : ''}`)
      .filter(Boolean);
    payload.description = lines.join('\n');
  }

  await updateDoc(doc(db, 'jobs', surveyId), payload);
  return surveyId;
}
