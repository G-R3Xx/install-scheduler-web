// src/pages/SiteSurveyPage.js
import React, { useState, lazy, Suspense } from 'react';
import {
  Box,
  Button,
  Divider,
  TextField,
  Typography,
  CircularProgress,
  Grid,
  IconButton,
  Tooltip,
  Paper,
  Backdrop,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { v4 as uuid } from 'uuid';
import DeleteIcon from '@mui/icons-material/Delete';
import ErrorBoundary from '../components/ErrorBoundary';
import { createSurvey } from '../services/surveyService';
import { jsPDF } from 'jspdf';
import { useHistory } from 'react-router-dom';

const SurveyAnnotator = lazy(() => import('../components/SurveyAnnotator'));

const FUNCTIONS_BASE =
  process.env.REACT_APP_FUNCTIONS_BASE ||
  'https://us-central1-install-scheduler.cloudfunctions.net';

// Fixed recipient
const SURVEY_PDF_TO = 'printroom@tenderedge.com.au';

/* Busy overlay */
function BusyOverlay({ open, text = 'Working…' }) {
  return (
    <Backdrop open={open} sx={{ zIndex: 2000, color: '#fff' }}>
      <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.5 }}>
        <CircularProgress />
        <Typography sx={{ fontWeight: 600 }}>{text}</Typography>
        <Typography variant="body2" sx={{ opacity: 0.9 }}>
          Please don’t close this window.
        </Typography>
      </Box>
    </Backdrop>
  );
}

/* Utils */
async function blobToDataURL(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function makePreviewImage(file, { maxDim = 2048, quality = 0.8 } = {}) {
  const dataURL = await blobToDataURL(file);

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

/* Styled PDF that keeps each sign block together on a single page */
const buildSurveyPdfBase64 = async (client, signs, refPhotos) => {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // Layout constants
  const margin = 40;
  const contentW = pageW - margin * 2;
  let y = margin + 16;

  const colorPrimary = [0, 74, 173]; // a deep blue
  const colorBand = [16, 23, 42];

  const addHeader = () => {
    pdf.setFillColor(...colorBand);
    pdf.rect(0, 0, pageW, 48, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text('SITE SURVEY', margin, 30);
    pdf.setTextColor(0, 0, 0);
  };

  const hr = () => {
    pdf.setDrawColor(220);
    pdf.line(margin, y, pageW - margin, y);
    y += 10;
  };

  const sectionTitle = (t) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...colorPrimary);
    pdf.setFontSize(13);
    pdf.text(t, margin, y);
    y += 14;
    pdf.setTextColor(0, 0, 0);
    hr();
  };

  const ensureSpace = (needed) => {
    if (y + needed > pageH - margin) {
      pdf.addPage();
      addHeader();
      y = margin + 16;
    }
  };

  const line = (label, value = '') => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
    const leftW = 110;
    const labelY = y;
    pdf.text(`${label}:`, margin, y);
    pdf.setFont('helvetica', 'normal');
    const wrapped = pdf.splitTextToSize(String(value ?? ''), contentW - leftW);
    pdf.text(wrapped, margin + leftW, y);
    const blockH = Math.max(16, 12 * wrapped.length);
    y = labelY + blockH;
  };

  addHeader();

  // Client details
  sectionTitle('Client Details');
  line('Client', client.name || '');
  line('Company', client.company || '');
  line('Contact', client.contact || '');
  line('Phone', client.phone || '');
  line('Email', client.email || '');
  line('Address', client.address || '');

  // Notes
  sectionTitle('Notes');
  pdf.setFont('helvetica', 'normal');
  const notes = (client.description || '').toString().trim() || '—';
  const noteLines = pdf.splitTextToSize(notes, contentW);
  ensureSpace(12 * noteLines.length + 6);
  pdf.text(noteLines, margin, y);
  y += 12 * noteLines.length + 10;

  // Helper to compute image scaled size to contentW
  const imageDimsFor = (img) => {
    const scale = Math.min(1, contentW / img.width);
    return { w: img.width * scale, h: img.height * scale };
  };

  // Signs
  sectionTitle('Signs');
  for (let i = 0; i < signs.length; i++) {
    const s = signs[i];
    if (!s.fileOriginal && !s.previewBlob && !s.annotatedBlob) continue;

    // Prepare description lines
    const title = s.name || `Sign ${i + 1}`;
    const descLines = s.description ? pdf.splitTextToSize(s.description, contentW) : [];
    const descH = descLines.length ? 12 * descLines.length + 6 : 0;

    // Prepare image (we must know size before deciding page break)
    let dataURL = null;
    if (s.annotatedBlob) dataURL = await blobToDataURL(s.annotatedBlob);
    else if (s.previewBlob) dataURL = await blobToDataURL(s.previewBlob);
    else if (s.fileOriginal) dataURL = await blobToDataURL(s.fileOriginal);

    let imgH = 0;
    if (dataURL) {
      const img = new Image();
      img.src = dataURL;
      await new Promise((r) => (img.onload = r));
      imgH = imageDimsFor(img).h;
    }

    // Total block height (title + (desc?) + image + spacing + divider)
    const titleH = 16;
    const blockH = titleH + descH + (imgH ? imgH + 8 : 0) + 8 + 10; // 10 for hr

    // Keep this sign together: page break first if needed
    ensureSpace(blockH);

    // Render sign block
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12);
    pdf.text(title, margin, y); y += 16;

    if (descLines.length) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
      pdf.text(descLines, margin, y);
      y += 12 * descLines.length + 6;
    }

    if (dataURL) {
      const img = new Image(); img.src = dataURL;
      await new Promise((r) => (img.onload = r));
      const { w, h } = imageDimsFor(img);
      pdf.addImage(
        dataURL,
        dataURL.startsWith('data:image/png') ? 'PNG' : 'JPEG',
        margin, y, w, h
      );
      y += h + 8;
    }

    hr();
  }

  // Reference photos
  if (refPhotos.length) {
    sectionTitle('Reference Photos');
    for (const p of refPhotos) {
      const dataURL = await blobToDataURL(p.file);
      const img = new Image(); img.src = dataURL;
      await new Promise((r) => (img.onload = r));
      const { w, h } = imageDimsFor(img);

      ensureSpace(h + 10);
      pdf.addImage(
        dataURL,
        dataURL.startsWith('data:image/png') ? 'PNG' : 'JPEG',
        margin, y, w, h
      );
      y += h + 8;
    }
  }

  // Footer line
  ensureSpace(20);
  pdf.setDrawColor(220);
  pdf.line(margin, pageH - margin, pageW - margin, pageH - margin);
  pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9);
  pdf.text('Generated by Install Scheduler', margin, pageH - margin + 14);

  const dataUri = pdf.output('datauristring');
  return dataUri.split(',')[1];
};

export default function SiteSurveyPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const history = useHistory();

  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('Working…');
  const [saving, setSaving] = useState(false);

  const [client, setClient] = useState({
    name: '',
    company: '',
    contact: '',
    phone: '',
    email: '',
    address: '',
    description: '',
  });

  const [signs, setSigns] = useState([
    {
      id: uuid(),
      name: 'Sign 1',
      description: '',
      fileOriginal: null,
      previewUrl: null,
      previewBlob: null,
      stageJSON: null,
      annotatedBlob: null,
    },
  ]);

  const [refPhotos, setRefPhotos] = useState([]);

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

    next[idx].fileOriginal = file;
    try {
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

  const onSaveSurvey = async () => {
    const anySignImage = signs.some((s) => s.fileOriginal);
    if (!anySignImage && refPhotos.length === 0) {
      alert('Please add at least one sign image or a reference photo.');
      return;
    }

    setSaving(true);
    setBusy(true);
    setBusyText('Saving survey…');

    try {
      // 1) Save to Firestore / Storage
      await createSurvey({
        client,
        signs,
        referencePhotoFiles: refPhotos.map((p) => p.file),
      });

      // 2) Build PDF
      setBusyText('Building PDF…');
      const pdfBase64 = await buildSurveyPdfBase64(client, signs, refPhotos);

      // 3) Email PDF (always to SURVEY_PDF_TO)
      setBusyText('Emailing PDF…');
      try {
        const subject = `Site Survey — ${client.name || client.company || 'Untitled'}`;
        const text = `Auto-generated site survey PDF for ${client.name || client.company || 'the client'}.`;
        const fileName = `Survey_${(client.name || client.company || 'client').replace(/\s+/g, '_')}.pdf`;

        const resp = await fetch(`${FUNCTIONS_BASE}/sendSurveyPdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          mode: 'cors',
          body: JSON.stringify({
            toEmail: SURVEY_PDF_TO,
            subject,
            text,
            pdfBase64,
            fileName,
          }),
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          console.error('sendSurveyPdf non-2xx', resp.status, txt);
        }
      } catch (e) {
        console.error('Email send failed', e);
        // We still continue to redirect; survey is saved
      }

      // Cleanup local blobs
      signs.forEach((s) => { if (s.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(s.previewUrl); });
      refPhotos.forEach((p) => { if (p.url?.startsWith('blob:')) URL.revokeObjectURL(p.url); });

      // Redirect to job list
      history.push('/');
      return;
    } catch (e) {
      console.error(e);
      alert(e?.message || 'Failed to save survey.');
    } finally {
      setSaving(false);
      setBusy(false);
      setBusyText('Working…');
    }
  };

  return (
    <Box sx={{ p: isMobile ? 1 : 2, bgcolor: '#0f172a', minHeight: '100vh' }}>
      <BusyOverlay open={busy} text={busyText} />

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

        {/* Signs */}
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
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, color: 'white' }}>
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
            disabled={busy}
          >
            Add another sign
          </Button>
        </Box>

        {/* Reference photos (no annotations) */}
        <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.2)' }} />
        <Typography variant="h6" sx={{ color: 'white', mb: 1 }}>
          Additional Reference Photos (no annotations)
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
          <Button
            variant="outlined"
            component="label"
            sx={{ color: 'white', borderColor: 'white' }}
            disabled={busy}
          >
            Upload Reference Photos
            <input
              hidden
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) addRefPhotos(files);
                e.target.value = '';
              }}
            />
          </Button>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            You can add site/context images here. These will be saved with the survey but won’t have annotations.
          </Typography>
        </Box>

        {refPhotos.length > 0 && (
          <Grid container spacing={1} sx={{ mb: 2 }}>
            {refPhotos.map((p) => (
              <Grid item key={p.id}>
                <Paper
                  sx={{
                    p: 0.5,
                    borderRadius: 1,
                    bgcolor: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  <img
                    src={p.url}
                    alt="ref"
                    style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 4 }}
                  />
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
          <Button
            fullWidth={isMobile}
            variant="contained"
            onClick={onSaveSurvey}
            disabled={saving || busy}
          >
            {saving ? 'Saving…' : 'Save Survey'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
