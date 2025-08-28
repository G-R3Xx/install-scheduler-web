// src/pages/SiteSurveyPage.js
import React, { useState, lazy, Suspense } from 'react';
import {
  Box,
  Button,
  Divider,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { v4 as uuid } from 'uuid';
import ErrorBoundary from '../components/ErrorBoundary';

// Firebase
import { db, storage } from '../firebase/firebase';
import {
  addDoc,
  collection,
  serverTimestamp,
  updateDoc,
  doc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const SurveyAnnotator = lazy(() => import('../components/SurveyAnnotator'));

/** Downscale image for fast annotation (keep original untouched) */
async function makePreviewImage(file, { maxDim = 2048, quality = 0.8 } = {}) {
  const dataURL = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataURL;
  });

  const { width, height } = img;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  );

  return {
    blob,
    url: URL.createObjectURL(blob),
    width: targetW,
    height: targetH,
    original: { width, height },
  };
}

export default function SiteSurveyPage() {
  // ----- mobile responsiveness -----
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [saving, setSaving] = useState(false);

  const [client, setClient] = useState({
    name: '',
    contact: '',
    phone: '',
    email: '',
    address: '',
  });

  const [signs, setSigns] = useState([
    {
      id: uuid(),
      name: 'Sign 1',
      description: '',
      fileOriginal: null,   // untouched original File
      previewUrl: null,     // downscaled data URL for annotation display
      previewBlob: null,    // Blob of preview (optional)
      stageJSON: null,      // Konva JSON
      annotatedBlob: null,  // Blob (PNG/JPEG) of annotation result
    },
  ]);

  const addSign = () =>
    setSigns((s) => [
      ...s,
      {
        id: uuid(),
        name: `Sign ${s.length + 1}`,
        description: '',
        fileOriginal: null,
        previewUrl: null,
        previewBlob: null,
        stageJSON: null,
        annotatedBlob: null,
      },
    ]);

  const onFile = async (idx, file) => {
    const next = [...signs];
    if (!file) {
      next[idx].fileOriginal = null;
      if (next[idx].previewUrl) URL.revokeObjectURL(next[idx].previewUrl);
      next[idx].previewUrl = null;
      next[idx].previewBlob = null;
      next[idx].stageJSON = null;
      next[idx].annotatedBlob = null;
      setSigns(next);
      return;
    }

    next[idx].fileOriginal = file;
    try {
      // slightly smaller preview on phones for snappier performance
      const preview = await makePreviewImage(file, {
        maxDim: isMobile ? 1600 : 2048,
        quality: 0.82,
      });
      if (next[idx].previewUrl) URL.revokeObjectURL(next[idx].previewUrl);
      next[idx].previewUrl = preview.url;
      next[idx].previewBlob = preview.blob;
      next[idx].stageJSON = null;
      next[idx].annotatedBlob = null;
    } catch (e) {
      console.error('Preview generation failed', e);
      if (next[idx].previewUrl) URL.revokeObjectURL(next[idx].previewUrl);
      next[idx].previewUrl = URL.createObjectURL(file);
      next[idx].previewBlob = null;
    }
    setSigns(next);
  };

  const onAnnotSave = (idx, { stageJSON, annotatedBlob }) => {
    const next = [...signs];
    next[idx].stageJSON = stageJSON;
    next[idx].annotatedBlob = annotatedBlob;
    setSigns(next);
  };

  // ---- Save as SURVEY (Option A) ----
  const saveSurvey = async () => {
    try {
      setSaving(true);

      // Build a simple surveyNotes list from non-empty sign descriptions
      const surveyNotes = signs
        .map(s => (s.description || '').trim())
        .filter(Boolean);

      // 1) Create a minimal survey doc first to get an ID
      const surveyRef = await addDoc(collection(db, 'jobs'), {
        jobType: 'survey',          // <-- key flag
        status: 'survey',           // keeps it out of scheduling until converted
        createdAt: serverTimestamp(),

        // Client fields
        clientName: client.name || '',
        company: '',                // you can add a field in the UI later if needed
        contact: client.contact || '',
        phone: client.phone || '',
        email: client.email || '',
        address: client.address || '',

        description: '',            // keep empty or populate from a top-level survey note field if you add one later
        surveyNotes,                // array of strings (Sign descriptions)
        assignedTo: [],             // surveys aren’t assigned yet
        installDate: null,          // set when converting

        // placeholder; we will update with real sign URLs after upload
        signs: [],
      });

      const docId = surveyRef.id;

      // 2) Upload each sign's original + annotated image (if present)
      const uploadedSigns = [];
      for (let i = 0; i < signs.length; i++) {
        const s = signs[i];
        let originalUrl = null;
        let annotatedUrl = null;

        if (s.fileOriginal) {
          const origRef = ref(storage, `jobs/${docId}/survey/sign_${i + 1}_original.jpg`);
          await uploadBytes(origRef, s.fileOriginal);
          originalUrl = await getDownloadURL(origRef);
        }

        if (s.annotatedBlob) {
          const annRef = ref(storage, `jobs/${docId}/survey/sign_${i + 1}_annotated.jpg`);
          await uploadBytes(annRef, s.annotatedBlob);
          annotatedUrl = await getDownloadURL(annRef);
        }

        uploadedSigns.push({
          id: s.id,
          name: s.name,
          description: s.description || '',
          originalImageUrl: originalUrl,
          annotatedImageUrl: annotatedUrl,
          // if you want to keep the stage JSON for future editing:
          stageJSON: s.stageJSON || null,
        });
      }

      // 3) Update doc with the uploaded signs array
      await updateDoc(doc(db, 'jobs', docId), {
        signs: uploadedSigns,
      });

      alert('Survey saved 👍\nYou can find it in the list under the “Surveys” tab.');
    } catch (err) {
      console.error('Save survey failed:', err);
      alert(err?.message || 'Failed to save survey.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: isMobile ? 1 : 2, bgcolor: '#0f172a', minHeight: '100vh' }}>
      {/* Outer card styled to match Stage-1 dark surface */}
      <Box
        sx={{
          mx: 'auto',
          maxWidth: isMobile ? '100%' : 1100,
          p: isMobile ? 1.5 : 2,
          borderRadius: 3,
          background:
            'linear-gradient(180deg, rgba(16,23,42,0.95) 0%, rgba(10,14,24,0.95) 100%)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
          color: 'white',
        }}
      >
        <Typography variant="h5" sx={{ mb: 1, color: 'white' }}>
          New Site Survey
        </Typography>

        {/* Job details */}
        <Divider sx={{ my: 1, borderColor: 'rgba(255,255,255,0.2)' }} />
        <Box sx={{ display: 'grid', gap: 1.25 }}>
          {['Client', 'Contact Person', 'Contact Phone', 'Contact Email', 'Site Address'].map(
            (label, idx) => {
              const keys = ['name', 'contact', 'phone', 'email', 'address'];
              return (
                <TextField
                  key={label}
                  size={isMobile ? 'small' : 'medium'}
                  label={label}
                  value={client[keys[idx]]}
                  onChange={(e) => setClient({ ...client, [keys[idx]]: e.target.value })}
                  fullWidth
                  InputLabelProps={{ style: { color: 'white' } }}
                  InputProps={{
                    style: { color: 'white', background: 'rgba(255,255,255,0.08)' },
                  }}
                />
              );
            }
          )}
        </Box>

        {/* Sign sections */}
        <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.2)' }} />

        {signs.map((s, i) => (
          <Box
            key={s.id}
            sx={{
              p: isMobile ? 1.25 : 2,
              mb: isMobile ? 1.25 : 2,
              borderRadius: 2,
              border: '1px solid rgba(255,255,255,0.08)',
              backgroundColor: 'rgba(17,24,39,0.8)',
              color: 'white',
            }}
          >
            <Typography variant="h6" sx={{ mb: 1, color: 'white' }}>
              {s.name}
            </Typography>

            <TextField
              size={isMobile ? 'small' : 'medium'}
              label="Description"
              value={s.description}
              onChange={(e) => {
                const next = [...signs];
                next[i].description = e.target.value;
                setSigns(next);
              }}
              fullWidth
              sx={{ mb: 1.25 }}
              InputLabelProps={{ style: { color: 'white' } }}
              InputProps={{
                style: { color: 'white', background: 'rgba(255,255,255,0.08)' },
              }}
            />

            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0] || null;
                await onFile(i, file);
              }}
              style={{ marginBottom: 12, color: 'white' }}
            />

            {s.previewUrl && (
              <ErrorBoundary>
                <Suspense
                  fallback={
                    <Box
                      sx={{
                        p: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        color: 'white',
                      }}
                    >
                      <CircularProgress size={18} sx={{ color: 'white' }} />
                      Loading annotation tool…
                    </Box>
                  }
                >
                  <SurveyAnnotator
                    file={s.previewUrl}
                    tools={['text', 'rect', 'arrow']}
                    onSave={(payload) => onAnnotSave(i, payload)}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </Box>
        ))}

        <Box sx={{ display: 'flex', justifyContent: 'center', my: 1 }}>
          <Button
            fullWidth={isMobile}
            variant="outlined"
            sx={{ color: 'white', borderColor: 'white' }}
            onClick={addSign}
          >
            Add another sign
          </Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexDirection: isMobile ? 'column' : 'row' }}>
          <Button
            fullWidth={isMobile}
            variant="contained"
            onClick={saveSurvey}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Survey'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
