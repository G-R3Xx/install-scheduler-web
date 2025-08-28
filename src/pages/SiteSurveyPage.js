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
import { createSurveyJob } from '../services/surveyService'; // <-- NEW

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
    company: '',          // <-- NEW
    contact: '',
    phone: '',
    email: '',
    address: '',
    description: '',      // <-- NEW (survey-wide notes)
  });

  const [signs, setSigns] = useState([
    {
      id: uuid(),
      name: 'Sign 1',
      description: '',
      fileOriginal: null,   // untouched original
      previewUrl: null,     // downscaled for annotation
      previewBlob: null,
      stageJSON: null,
      annotatedBlob: null,
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

  // ---------- CLOUD SAVE ----------
  const saveSurvey = async () => {
    try {
      if (!client.name?.trim()) {
        alert('Please enter a Client name before saving.');
        return;
      }
      setSaving(true);

      // Map current signs to service shape
      const serviceSigns = signs.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description || '',
        file: s.fileOriginal || null,      // original file used for upload
        annotatedBlob: s.annotatedBlob || null,
        stageJSON: s.stageJSON || null,
      }));

      const { id, jobNumber } = await createSurveyJob({
        client,
        signs: serviceSigns,
      });

      alert(`Survey saved as Job #${jobNumber}\n\nDoc ID: ${id}`);
      // Optionally navigate: e.g. history.push(`/jobs/${id}`)
    } catch (e) {
      console.error(e);
      alert(e?.message || 'Failed to save survey.');
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
          {[
            { label: 'Client', key: 'name' },
            { label: 'Company', key: 'company' },            // NEW
            { label: 'Contact Person', key: 'contact' },
            { label: 'Contact Phone', key: 'phone' },
            { label: 'Contact Email', key: 'email' },
            { label: 'Site Address', key: 'address' },
          ].map(({ label, key }) => (
            <TextField
              key={key}
              size={isMobile ? 'small' : 'medium'}
              label={label}
              value={client[key]}
              onChange={(e) => setClient({ ...client, [key]: e.target.value })}
              fullWidth
              InputLabelProps={{ style: { color: 'white' } }}
              InputProps={{
                style: { color: 'white', background: 'rgba(255,255,255,0.08)' },
              }}
            />
          ))}

          {/* Survey-wide notes/description (goes to job.description) */}
          <TextField
            size={isMobile ? 'small' : 'medium'}
            label="Description / Notes"
            value={client.description}
            onChange={(e) => setClient({ ...client, description: e.target.value })}
            fullWidth
            multiline
            minRows={4}
            InputLabelProps={{ style: { color: 'white' } }}
            InputProps={{
              style: { color: 'white', background: 'rgba(255,255,255,0.08)' },
            }}
          />
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
