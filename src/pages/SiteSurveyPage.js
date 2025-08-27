// src/pages/SiteSurveyPage.js
import React, { useState, lazy, Suspense } from 'react';
import { Box, Button, Divider, TextField, Typography } from '@mui/material';
import { v4 as uuid } from 'uuid';
import ErrorBoundary from '../components/ErrorBoundary';

// Lazy-load to avoid whole-page crash on annotator errors
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
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, targetW, targetH);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return { blob, url: URL.createObjectURL(blob), width: targetW, height: targetH, original: { width, height } };
}

export default function SiteSurveyPage() {
  const [client, setClient] = useState({ name: '', contact: '', phone: '', email: '', address: '' });

  const [signs, setSigns] = useState([{
    id: uuid(),
    name: 'Sign 1',
    description: '',
    fileOriginal: null,
    previewUrl: null,
    previewBlob: null,
    stageJSON: null,
    annotatedBlob: null
  }]);

  const addSign = () =>
    setSigns((s) => [...s, {
      id: uuid(),
      name: `Sign ${s.length + 1}`,
      description: '',
      fileOriginal: null,
      previewUrl: null,
      previewBlob: null,
      stageJSON: null,
      annotatedBlob: null
    }]);

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
      const preview = await makePreviewImage(file, { maxDim: 2048, quality: 0.8 });
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

  const saveSurveyLocallyForNow = () => {
    console.log('Client:', client);
    console.log('Signs:', signs.map(s => ({
      id: s.id, name: s.name,
      hasOriginal: !!s.fileOriginal,
      hasPreview: !!s.previewUrl,
      hasAnnotation: !!s.annotatedBlob
    })));
    alert('Survey captured (local only). Next step: wire Firebase save + email.');
  };

  return (
    <Box sx={{ p: 2, display: 'grid', gap: 2 }}>
      <Typography variant="h5">New Site Survey</Typography>

      {/* Job details */}
      <Divider sx={{ my: 1 }} />
      <Box sx={{ display: 'grid', gap: 1 }}>
        <TextField label="Client" value={client.name}
          onChange={(e) => setClient({ ...client, name: e.target.value })} fullWidth />
        <TextField label="Contact Person" value={client.contact}
          onChange={(e) => setClient({ ...client, contact: e.target.value })} fullWidth />
        <TextField label="Contact Phone" value={client.phone}
          onChange={(e) => setClient({ ...client, phone: e.target.value })} fullWidth />
        <TextField label="Contact Email" value={client.email}
          onChange={(e) => setClient({ ...client, email: e.target.value })} fullWidth />
        <TextField label="Site Address" value={client.address}
          onChange={(e) => setClient({ ...client, address: e.target.value })} fullWidth />
      </Box>

      {/* Signs */}
      <Divider sx={{ my: 2 }} />
      {signs.map((s, i) => (
        <Box key={s.id} sx={{ p: 2, border: '1px solid #444', borderRadius: 2, display: 'grid', gap: 1 }}>
          <Typography variant="h6">{s.name}</Typography>

          <TextField
            label="Description"
            value={s.description}
            onChange={(e) => {
              const next = [...signs];
              next[i].description = e.target.value;
              setSigns(next);
            }}
            fullWidth
          />

          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0] || null;
              await onFile(i, file);
            }}
          />

          {s.previewUrl && (
            <ErrorBoundary>
              <Suspense fallback={<div style={{ padding: 8 }}>Loading annotation tool…</div>}>
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

      <Button onClick={addSign}>Add another sign</Button>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" onClick={saveSurveyLocallyForNow}>Save Survey</Button>
      </Box>
    </Box>
  );
}
