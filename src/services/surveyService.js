// src/services/surveyService.js
import { db, storage } from '../firebase/firebase';
import {
  addDoc, collection, serverTimestamp, doc, runTransaction,
  updateDoc, getDoc, Timestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/** Incrementing job number from meta/counters.jobSeq (or start 1000) */
async function getNextJobNumber() {
  const countersRef = doc(db, 'meta', 'counters');
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(countersRef);
    const current = snap.exists() ? (snap.data().jobSeq || 1000) : 1000;
    const next = current + 1;
    tx.set(countersRef, { jobSeq: next }, { merge: true });
    return next;
  });
}

/** Optional: downscale originals for faster mobile upload */
async function downscaleImage(file, maxW = 2200) {
  if (!file || !(file instanceof File)) return file;
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, maxW / img.width);
  if (scale >= 1) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
}

async function uploadBlob(path, blobOrFile, contentType) {
  const r = ref(storage, path);
  const meta = contentType ? { contentType } : undefined;
  await uploadBytes(r, blobOrFile, meta);
  return await getDownloadURL(r);
}

/**
 * Create a SURVEY as a job doc in /jobs
 * @param {Object} payload
 * payload.client: { name, company, contact, phone, email, address, description }
 * payload.signs: [{ id, name, description, file (File), annotatedBlob (Blob), stageJSON }]
 */
export async function createSurveyJob({ client, signs }) {
  const jobNumber = await getNextJobNumber();

  // 1) Create base job
  const jobRef = await addDoc(collection(db, 'jobs'), {
    jobType: 'survey',
    status: 'survey_draft',
    jobNumber,
    clientName: client?.name || '',
    company: client?.company || '',
    contact: client?.contact || '',
    phone: client?.phone || '',
    email: client?.email || '',
    address: client?.address || '',
    description: client?.description || '',
    referencePhotos: [],
    plans: [],
    companyLogoUrl: null,
    createdAt: serverTimestamp(),
    installDate: null,
    assignedTo: [],
    signs: [],
  });

  // 2) Upload each sign's assets
  const uploadedSigns = [];
  for (let i = 0; i < (signs?.length || 0); i++) {
    const s = signs[i];
    let originalUrl = null;
    let annotatedUrl = null;

    if (s.file) {
      const downsized = await downscaleImage(s.file);
      originalUrl = await uploadBlob(
        `jobs/${jobRef.id}/survey/sign_${i + 1}_original_${s.file.name}`,
        downsized,
        downsized.type
      );
    }
    if (s.annotatedBlob) {
      annotatedUrl = await uploadBlob(
        `jobs/${jobRef.id}/survey/sign_${i + 1}_annotated.png`,
        s.annotatedBlob,
        'image/png'
      );
    }

    uploadedSigns.push({
      id: s.id,
      name: s.name,
      description: s.description || '',
      originalImageUrl: originalUrl,
      annotatedImageUrl: annotatedUrl,
      stageJSON: s.stageJSON || null,
    });
  }

  await updateDoc(jobRef, { signs: uploadedSigns, updatedAt: serverTimestamp() });

  return { id: jobRef.id, jobNumber };
}

/**
 * Convert a SURVEY to an INSTALL (we'll call this from JobDetailPage later)
 */
export async function convertSurveyToJob(jobId, options = {}) {
  const jobRef = doc(db, 'jobs', jobId);
  const snap = await getDoc(jobRef);
  if (!snap.exists()) throw new Error('Job not found');
  const job = snap.data() || {};

  const refsFromSigns = (job.signs || [])
    .map(s => s?.annotatedImageUrl || s?.originalImageUrl)
    .filter(Boolean);

  const existing = Array.isArray(job.referencePhotos) ? job.referencePhotos : [];
  const referencePhotos = Array.from(new Set([...existing, ...refsFromSigns]));

  let nextDescription = job.description || '';
  if (!options.keepExistingDescription) {
    const signDescs = (job.signs || [])
      .map((s, i) => (s?.description ? `• ${s.name || `Sign ${i + 1}`}: ${s.description}` : null))
      .filter(Boolean);
    if (signDescs.length) {
      nextDescription = [job.description || '', '', 'Survey notes:', ...signDescs].join('\n');
    }
  }

  const payload = {
    jobType: 'install',
    status: 'in progress',
    updatedAt: serverTimestamp(),
    referencePhotos,
    description: nextDescription,
  };

  if (options.installDate instanceof Date) {
    payload.installDate = Timestamp.fromDate(options.installDate);
  } else if (options.installDate === null) {
    payload.installDate = null;
  }
  if (Array.isArray(options.assignedTo)) {
    payload.assignedTo = options.assignedTo;
  }

  await updateDoc(jobRef, payload);
  return { ok: true };
}
