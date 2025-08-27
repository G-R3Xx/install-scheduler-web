// src/pages/SiteSurveyPage.js
import React, { useState } from 'react';
import { Box, Button, Divider, TextField, Typography } from '@mui/material';
import { v4 as uuid } from 'uuid';
import SurveyAnnotator from '../components/SurveyAnnotator';

/**
 * Create a downscaled JPEG preview for faster annotation.
 * Keeps the original file untouched (you can upload/store that later).
 */
async function makePreviewImage(file, { maxDim = 2048, quality = 0.8 } = {}) {
  // Read file to dataURL
  const dataURL = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // Load into an Image element
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataURL;
  });

  // Compute target size
  const { width, height } = img;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  // Draw to canvas at reduced size
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // Export to JPEG blob
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

  return {
    blob,
    url: URL.createObjectURL(blob), // for <img>/Konva.Image
    width: targetW,
    height: targetH,
    original: { width, height },
  };
}

export default function SiteSurveyPage() {
  const [client, setClient] = useState({
    name: '', contact: '', phone: '', email: '', address: ''
  });

  const [signs, setSigns] = useState([
    {
      id: uuid(),
      name: 'Sign 1',
      description: '',
      // Keep both original and preview:
      fileOriginal: null,     // the untouched File
      previewUrl: null,       // downscaled JPEG (for annotator)
      previewBlob: null,      // (optional) upload as thumbnail later
      // Annotation outputs:
      stageJSON: null,
      annotatedBlob: null
    }
  ]);

  const addSign = () =>
    setSigns(s => [
      ...s,
      {
        id: uuid(),
        name: `Sign ${s.length + 1}`,
        description: '',
        fileOriginal: null,
        previewUrl: null,
        previewBlob: null,
        stageJSON: null,
        annotatedBlob: null
      }
    ]);

  // Handle file select: store original + build preview
  const onFile = async (idx, file) => {
    const next = [...signs];

    if (!file) {
      // clear image + annotations if user removed file
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
      // revoke previous preview URL to avoid leaks
      if (next[idx].previewUrl) URL.revokeObjectURL(next[idx].previewUrl);
      next[idx].previewUrl = preview.url;
      next[idx].previewBlob = preview.blob;
      // clear any prior annotations when a new image is chosen
      next[idx].stageJSON = null;
      next[idx].annotatedBlob = null;
    } catch (err) {
      console.error('Preview generation failed', err);
      // fall back to using the original directly
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
      id: s.id,
      name: s.name,
      hasOriginal: !!s.fileOriginal,
      hasPreview: !!s.previewUrl,
      hasAnnotation: !!s.annotatedBlob
    })));
    alert('Survey captured (local only). Next step: wire Firebase save + email.');
  };

  return (
    <Box sx={{ p: 2, display: 'grid', gap: 2 }}>
      <Typography variant="h5">New Site Survey</Typography>
      <Divider />

      <TextField label="Client" value={client.name} onChange={e => setClient({ ...client, name: e.target.value })} fullWidth />
      <TextField label="Contact Person" value={client.contact} onChange={e => setClient({ ...client, contact: e.target.value })} fullWidth />
      <TextField label="Contact Phone" value={client.phone} onChange={e => setClient({ ...client, phone: e.target.value })} fullWidth />
      <TextField label="Contact Email" value={client.email} onChange={e => setClient({ ...client, email: e.target.value })} fullWidth />
      <TextField label="Site Address" value={client.address} onChange={e => setClient({ ...client, address: e.target.value })} fullWidth />

      <Divider sx={{ my: 1 }} />

      {signs.map((s, i) => (
        <Box key={s.id} sx={{ p: 2, border: '1px solid #444', borderRadius: 2, display: 'grid', gap: 1 }}>
          <Typography variant="h6">{s.name}</Typography>
          <TextField
            label="Description"
            value={s.description}
            onChange={e => {
              const next = [...signs];
              next[i].description = e.target.value;
              setSigns(next);
            }}
            fullWidth
          />
          <input
            type="file"
            accept="image/*"
            onChange={async e => {
              const file = e.target.files?.[0] || null;
              await onFile(i, file);
            }}
          />

          {s.previewUrl && (
            <SurveyAnnotator
              file={s.previewUrl}                 // use the downscaled preview for fast annotating
              tools={['text', 'rect', 'arrow']}   // only the tools you want
              onSave={(payload) => onAnnotSave(i, payload)}
            />
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
