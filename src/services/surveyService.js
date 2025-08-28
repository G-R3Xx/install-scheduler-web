// src/services/surveyService.js
import { db } from '../firebase/firebase';
import {
  doc,
  getDoc,
  updateDoc,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';

/**
 * Convert a SURVEY doc to a normal job ("install" jobType).
 * - Copies annotated/original images to referencePhotos (by URL)
 * - Builds surveyNotes[] (array of "Sign N: ..." strings)
 * - Optionally sets installDate and assignedTo
 * - Sets jobType="install" and status="in progress"
 */
export async function convertSurveyToJob(
  jobId,
  {
    installDate = null,     // JS Date or null
    assignedTo = [],        // array of user IDs
    keepExistingDescription = false,
  } = {}
) {
  const ref = doc(db, 'jobs', jobId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Survey not found');

  const data = snap.data() || {};
  if (data.jobType !== 'survey') {
    // Already a job—just merge any new details
    const patch = {};
    if (installDate instanceof Date) patch.installDate = Timestamp.fromDate(installDate);
    if (Array.isArray(assignedTo)) patch.assignedTo = assignedTo;
    if (Object.keys(patch).length) {
      patch.updatedAt = serverTimestamp();
      await updateDoc(ref, patch);
    }
    return;
  }

  // Build survey notes from signs
  const signs = Array.isArray(data.signs) ? data.signs : [];
  const surveyNotes = signs
    .map((s, i) => {
      const label = s?.name || `Sign ${i + 1}`;
      const desc = s?.description || '';
      return desc ? `${label}: ${desc}` : `${label}`;
    })
    .filter(Boolean);

  // Reference photos from signs (prefer annotatedImageUrl if available)
  const referencePhotos = signs
    .map(s => s?.annotatedImageUrl || s?.originalImageUrl)
    .filter(Boolean);

  // New description (keep existing text if requested)
  const baseDescription = (data.description || '').trim();
  const description =
    keepExistingDescription && baseDescription
      ? `${baseDescription}\n\nSurvey notes:\n- ${surveyNotes.join('\n- ')}`
      : (surveyNotes.length
          ? `Survey notes:\n- ${surveyNotes.join('\n- ')}`
          : baseDescription);

  const patch = {
    jobType: 'install',
    status: 'in progress',
    description,
    surveyNotes,                 // keep as separate structured field too
    referencePhotos: Array.isArray(data.referencePhotos)
      ? Array.from(new Set([ ...data.referencePhotos, ...referencePhotos ]))
      : referencePhotos,
    updatedAt: serverTimestamp(),
  };

  if (installDate instanceof Date) {
    patch.installDate = Timestamp.fromDate(installDate);
  }

  if (Array.isArray(assignedTo)) {
    patch.assignedTo = assignedTo;
  }

  await updateDoc(ref, patch);
}
