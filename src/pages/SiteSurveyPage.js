// src/pages/SiteSurveyPage.js
import React, { useState, lazy, Suspense, useRef, useEffect } from 'react';
import {
  Box, Button, Divider, TextField, Typography, CircularProgress,
  Grid, IconButton, Tooltip, Paper, Backdrop,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { v4 as uuid } from 'uuid';
import DeleteIcon from '@mui/icons-material/Delete';
import ErrorBoundary from '../components/ErrorBoundary';
import { createSurvey } from '../services/surveyService';
import { useHistory, useLocation } from 'react-router-dom';
import { db } from '../firebase/firebase';
import { doc, getDoc } from 'firebase/firestore';
import UploadOverlay from '../components/UploadOverlay';

const SurveyAnnotator = lazy(() => import('../components/SurveyAnnotator'));

const FUNCTIONS_BASE =
  process.env.REACT_APP_FUNCTIONS_BASE ||
  'https://us-central1-install-scheduler.cloudfunctions.net';

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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const history = useHistory();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const jobId = params.get('jobId') || null;

  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const [client, setClient] = useState({
    name: '', company: '', contact: '', phone: '', email: '', address: '', description: '',
  });

  const [signs, setSigns] = useState([{
    id: uuid(),
    name: 'Sign 1',
    description: '',
    fileOriginal: null,
    previewUrl: null,
    previewBlob: null,
    stageJSON: null,
    annotatedBlob: null,
  }]);

  const [refPhotos, setRefPhotos] = useState([]);
  const annotRefs = useRef({});

  const addRefPhotos = (files) => {
    const incoming = Array.from(files || []).map((f) => ({
      id: uuid(),
      file: f,
      url: URL.createObjectURL(f),
    }));
    setRefPhotos((prev) => [...prev, ...incoming]);
  };
  const removeRefPhoto = (id) => {
    setRefPhotos((prev) => {
      const toRevoke = prev.find((p) => p.id === id);
      if (toRevoke?.url?.startsWith('blob:')) URL.revokeObjectURL(toRevoke.url);
      return prev.filter((p) => p.id !== id);
    });
  };

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

    try {
      const preview = await makePreviewImage(file, {
        maxDim: isMobile ? 1600 : 2048,
        quality: 0.82,
      });
      if (next[idx].previewUrl) URL.revokeObjectURL(next[idx].previewUrl);
      next[idx].fileOriginal = file;
      next[idx].previewUrl = preview.url;
      next[idx].previewBlob = preview.blob;
      next[idx].stageJSON = null;
      next[idx].annotatedBlob = null;
    } catch (e) {
      console.error('Preview generation failed', e);
      next[idx].fileOriginal = file;
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

  // ---------- PREFILL ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!jobId) return;
      try {
        const snap = await getDoc(doc(db, 'jobs', jobId));
        if (!snap.exists()) return;
        const d = snap.data() || {};
        if (!alive) return;

        setClient({
          name: d.clientName || d.client || '',
          company: d.company || '',
          contact: d.contact || '',
          phone: d.phone || '',
          email: d.email || '',
          address: d.address || '',
          description: d.description || d.surveyDescription || '',
        });
      } catch (e) {
        console.warn('prefill failed', e);
      }
    })();
    return () => { alive = false; };
  }, [jobId]);

  const onSaveSurvey = async () => {
    const anySignImage = signs.some(s => s.fileOriginal);
    if (!anySignImage && refPhotos.length === 0) {
      alert('Please add at least one sign image or a reference photo.');
      return;
    }

    setSaving(true);
    setBusy(true);
    try {
      const signsWithSnaps = await Promise.all(signs.map(async (s) => {
        const ref = annotRefs.current[s.id];
        if (ref && ref.exportSnapshot && s.previewUrl) {
          try {
            const snap = await ref.exportSnapshot();
            return { ...s, stageJSON: snap.stageJSON, annotatedBlob: snap.annotatedBlob };
          } catch {
            return s;
          }
        }
        return s;
      }));

      const surveyId = await createSurvey({
        client,
        signs: signsWithSnaps,
        referencePhotoFiles: refPhotos.map(p => p.file),
        jobId,
      });

      try {
        const resp = await fetch(`${FUNCTIONS_BASE}/sendSurveyPdf`, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ surveyId }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          console.warn('sendSurveyPdf failed:', text || resp.status);
        }
      } catch (err) {
        console.warn('sendSurveyPdf error:', err);
      }

      signs.forEach(s => { if (s.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(s.previewUrl); });
      refPhotos.forEach(p => { if (p.url?.startsWith('blob:')) URL.revokeObjectURL(p.url); });

      history.push('/');
    } catch (e) {
      console.error(e);
      alert(e?.message || 'Failed to save survey.');
    } finally {
      setSaving(false);
      setBusy(false);
    }
  };

  return (
    <Box sx={{ p: isMobile ? 1 : 2, bgcolor: '#0f172a', minHeight: '100vh' }}>
      <UploadOverlay open={busy} text="Saving survey… Please don’t exit the app" />

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

        <Divider sx={{ my: 1, borderColor: 'rgba(255,255,255,0.2)' }} />
        <Box sx={{ display: 'grid', gap: 1.25 }}>
          {[
            { label: 'Client', key: 'name' },
            { label: 'Company', key: 'company' },
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

          <TextField
            multiline
            minRows={2}
            size={isMobile ? 'small' : 'medium'}
            label="Survey Notes / Description (optional)"
            value={client.description}
            onChange={(e) => setClient({ ...client, description: e.target.value })}
            fullWidth
            InputLabelProps={{ style: { color: 'white' } }}
            InputProps={{
              style: { color: 'white', background: 'rgba(255,255,255,0.08)' },
            }}
          />
        </Box>

        <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.2)' }} />

        {signs.map((s, i) => (
          <Box key={s.id} sx={{ p: 2, mb: 2, borderRadius: 2, border: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(17,24,39,0.8)' }}>
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
              onChange={async (e) => { await onFile(i, e.target.files?.[0] || null); }}
              style={{ marginBottom: 12 }}
            />
            {s.previewUrl && (
              <ErrorBoundary>
                <Suspense fallback={<Box sx={{ p: 2, color: 'white' }}><CircularProgress size={18} /> Loading annotation tool…</Box>}>
                  <SurveyAnnotator
                    ref={(r) => { annotRefs.current[s.id] = r; }}
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
          <Button variant="outlined" sx={{ color: 'white', borderColor: 'white' }} onClick={addSign} disabled={busy}>
            Add another sign
          </Button>
        </Box>

        {/* Reference Photos */}
        <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.2)' }} />
        <Typography variant="h6" sx={{ color: 'white', mb: 1 }}>
          Additional Reference Photos (no annotations)
        </Typography>
        <Button variant="outlined" component="label" sx={{ color: 'white', borderColor: 'white', mb: 1 }} disabled={busy}>
          Upload Reference Photos
          <input hidden type="file" accept="image/*" multiple onChange={(e)=>{ if (e.target.files?.length) addRefPhotos(e.target.files); e.target.value=''; }} />
        </Button>

        {refPhotos.length > 0 && (
          <Grid container spacing={1} sx={{ mb: 2 }}>
            {refPhotos.map((p) => (
              <Grid item key={p.id}>
                <Paper sx={{ p: 0.5, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.06)' }}>
                  <img src={p.url} alt="ref" style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 4 }} />
                  <Tooltip title="Remove photo">
                    <IconButton size="small" sx={{ color: '#fff' }} onClick={() => removeRefPhoto(p.id)} disabled={busy}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Paper>
              </Grid>
            ))}
          </Grid>
        )}

        <Box sx={{ display: 'flex', gap: 1, flexDirection: isMobile ? 'column' : 'row' }}>
          <Button fullWidth={isMobile} variant="contained" onClick={onSaveSurvey} disabled={saving || busy}>
            {saving ? 'Saving…' : 'Save Survey'}
          </Button>
          <Button fullWidth={isMobile} variant="outlined" onClick={() => history.push('/')} disabled={busy}>
            Cancel
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
