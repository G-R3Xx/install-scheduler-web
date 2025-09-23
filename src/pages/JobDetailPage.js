// src/pages/JobDetailPage.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Button, Divider, Grid, Chip, TextField, Paper,
  IconButton, CircularProgress, Backdrop, Dialog, DialogContent, Link
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import InsertPhotoRoundedIcon from '@mui/icons-material/InsertPhotoRounded';
import { useParams, useHistory } from 'react-router-dom';
import {
  doc, getDoc, updateDoc, collection, addDoc, getDocs,
  serverTimestamp, deleteDoc, increment
} from 'firebase/firestore';
import { db, storage } from '../firebase/firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import SignatureCanvas from 'react-signature-canvas';
import { useAuth } from '../contexts/AuthContext';

function BusyOverlay({ open, text }) {
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

const toJSDate = (tsOrDate) =>
  tsOrDate?.toDate?.() instanceof Date ? tsOrDate.toDate()
    : tsOrDate instanceof Date ? tsOrDate : null;

const fmtDate = (date) =>
  !date ? '—' : date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });

const fmtTime = (date) =>
  !date ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

export default function JobDetailPage() {
  const params = useParams();
  const jobId = params.id || params.jobId;
  const history = useHistory();
  const { userMap, currentUser } = useAuth();

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [installerNotes, setInstallerNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const [completedPhotos, setCompletedPhotos] = useState([]);   // [{id,url,createdAt}]
  const [referencePhotos, setReferencePhotos] = useState([]);   // [{id,url,createdAt}]
  const [plans, setPlans] = useState([]);                       // [{id,url,name,createdAt}]
  const [timeEntries, setTimeEntries] = useState([]);           // [{id,userId,hours,createdAt}]
  const [newHours, setNewHours] = useState('');
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState(null);

  const [signatureURL, setSignatureURL] = useState(null);
  const [sigPad, setSigPad] = useState(null);

  // Image preview dialog
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const openPreview = (url) => { setPreviewUrl(url); setPreviewOpen(true); };
  const closePreview = () => { setPreviewOpen(false); setPreviewUrl(''); };

  const loadAll = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'jobs', jobId));
      if (!snap.exists()) {
        setJob(null);
        return;
      }
      const data = { id: snap.id, ...(snap.data() || {}) };
      setJob(data);
      setInstallerNotes(data.installerNotes || '');
      setSignatureURL(data.signatureURL || null);

      const compSnap = await getDocs(collection(db, 'jobs', jobId, 'completedPhotos'));
      setCompletedPhotos(compSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));

      const refSnap = await getDocs(collection(db, 'jobs', jobId, 'referencePhotos'));
      setReferencePhotos(refSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));

      const planSnap = await getDocs(collection(db, 'jobs', jobId, 'plans'));
      setPlans(planSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));

      const hoursSnap = await getDocs(collection(db, 'jobs', jobId, 'timeEntries'));
      setTimeEntries(hoursSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const assignedNames = useMemo(() => {
    if (!job) return '—';
    const ids = Array.isArray(job.assignedTo) ? job.assignedTo : job.assignedTo ? [job.assignedTo] : [];
    if (!ids.length) return 'Unassigned';
    return ids.map(uid =>
      userMap?.[uid]?.shortName || userMap?.[uid]?.displayName || userMap?.[uid]?.email || 'User'
    ).join(', ');
  }, [job, userMap]);

  // --- Completed photos: upload & remove (keep counter for list chips)
  const handleUploadCompleted = async (files) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setBusy(true);
    try {
      let uploaded = 0;
      for (const f of arr) {
        const r = ref(storage, `jobs/${jobId}/completed/${Date.now()}_${f.name}`);
        await uploadBytes(r, f);
        const url = await getDownloadURL(r);
        await addDoc(collection(db, 'jobs', jobId, 'completedPhotos'), { url, createdAt: serverTimestamp() });
        uploaded += 1;
      }
      if (uploaded > 0) {
        await updateDoc(doc(db, 'jobs', jobId), {
          completedPhotoCount: increment(uploaded),
          updatedAt: serverTimestamp(),
        });
      }
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const removeCompletedPhoto = async (item) => {
    setBusy(true);
    try {
      try {
        const u = new URL(item.url);
        const path = decodeURIComponent(u.pathname.replace(/^\/v0\/b\/[^/]+\/o\//, ''));
        await deleteObject(ref(storage, path));
      } catch { /* ignore */ }
      await deleteDoc(doc(db, 'jobs', jobId, 'completedPhotos', item.id));
      await updateDoc(doc(db, 'jobs', jobId), {
        completedPhotoCount: increment(-1),
        updatedAt: serverTimestamp(),
      });
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  // --- Notes
  const saveNotes = async () => {
    try {
      setSavingNotes(true);
      await updateDoc(doc(db, 'jobs', jobId), { installerNotes, updatedAt: serverTimestamp() });
    } finally {
      setSavingNotes(false);
    }
  };

  // --- Hours: manual + timer (maintain hoursTotal on job doc)
  const addHours = async () => {
    const h = parseFloat(newHours);
    if (!Number.isFinite(h) || h <= 0) return;
    await addDoc(collection(db, 'jobs', jobId, 'timeEntries'), {
      userId: currentUser?.uid || 'unknown',
      hours: h,
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'jobs', jobId), {
      hoursTotal: increment(h),
      updatedAt: serverTimestamp(),
    });
    setNewHours('');
    loadAll();
  };

  const startTimer = () => { setTimerRunning(true); setTimerStart(Date.now()); };
  const stopTimer = async () => {
    if (!timerRunning || !timerStart) return;
    const elapsedMs = Date.now() - timerStart;
    const hours = elapsedMs / 3600000;
    await addDoc(collection(db, 'jobs', jobId, 'timeEntries'), {
      userId: currentUser?.uid || 'unknown',
      hours,
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'jobs', jobId), {
      hoursTotal: increment(hours),
      updatedAt: serverTimestamp(),
    });
    setTimerRunning(false);
    setTimerStart(null);
    loadAll();
  };

  // --- Complete / reopen
  const completeJob = async () => {
    await updateDoc(doc(db, 'jobs', jobId), {
      status: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    history.push('/');
  };
  const reopenJob = async () => {
    await updateDoc(doc(db, 'jobs', jobId), { status: 'in progress', updatedAt: serverTimestamp() });
    loadAll();
  };

  // --- Signature
  const saveSignature = async () => {
    if (!sigPad || sigPad.isEmpty()) return;
    setBusy(true);
    try {
      const dataUrl = sigPad.getTrimmedCanvas().toDataURL('image/png');
      const blob = await (await fetch(dataUrl)).blob();
      const r = ref(storage, `jobs/${jobId}/signature.png`);
      await uploadBytes(r, blob);
      const url = await getDownloadURL(r);
      await updateDoc(doc(db, 'jobs', jobId), { signatureURL: url, updatedAt: serverTimestamp() });
      setSignatureURL(url);
    } finally {
      setBusy(false);
    }
  };

  // ---- Derived
  const totalHours = useMemo(
    () => timeEntries.reduce((s, e) => s + (Number(e.hours) || 0), 0),
    [timeEntries]
  );
  const hoursByUser = useMemo(() => {
    const map = {};
    for (const e of timeEntries) {
      const uid = e.userId || 'unknown';
      map[uid] = (map[uid] || 0) + (Number(e.hours) || 0);
    }
    return Object.entries(map)
      .map(([uid, hrs]) => ({ uid, hrs: Math.round(hrs * 100) / 100 }))
      .sort((a, b) => b.hrs - a.hrs);
  }, [timeEntries]);

  if (!jobId) return <Box p={2}><Typography color="error">Invalid job id.</Typography></Box>;
  if (loading) return <Box p={2}><Typography>Loading…</Typography></Box>;
  if (!job) return <Box p={2}><Typography>Job not found.</Typography></Box>;

  const jsDate = toJSDate(job.installDate);

  return (
    <Box sx={{ p: 2, maxWidth: 1000, mx: 'auto' }}>
      <BusyOverlay open={busy} text="Working… uploading files" />

      {/* Image preview dialog */}
      <Dialog open={previewOpen} onClose={closePreview} maxWidth="md" fullWidth>
        <DialogContent sx={{ p: 0, bgcolor: '#000' }}>
          {previewUrl && (
            <Box sx={{ width: '100%', display: 'grid', justifyItems: 'center', bgcolor: '#000' }}>
              <img
                src={previewUrl}
                alt="preview"
                style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
                onClick={closePreview}
              />
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* Header / summary */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h5" sx={{ mb: 1 }}>
          Job: {job.clientName || 'Untitled'}
        </Typography>

        {job.companyLogoUrl && (
          <Box sx={{ mb: 1 }}>
            <img src={job.companyLogoUrl} alt="logo" style={{ height: 44, objectFit: 'contain' }} />
          </Box>
        )}

        <Divider sx={{ my: 1 }} />

        <Typography><strong>Company:</strong> {job.company || '—'}</Typography>
        <Typography><strong>Contact:</strong> {job.contact || '—'}</Typography>
        <Typography><strong>Phone:</strong> {job.phone || '—'}</Typography>
        <Typography><strong>Email:</strong> {job.email || '—'}</Typography>
        <Typography><strong>Address:</strong> {job.address || '—'}</Typography>

        <Typography sx={{ mt: 1 }}><strong>Status:</strong> {job.status || '—'}</Typography>
        <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <strong>Install Date:</strong> {fmtDate(jsDate)}
          {job.installTime && jsDate && (
            <Chip
              size="small"
              icon={<AccessTimeRoundedIcon />}
              label={fmtTime(jsDate)}
              sx={{ ml: 0.5 }}
              variant="outlined"
            />
          )}
        </Typography>
        <Typography><strong>Assigned To:</strong> {assignedNames}</Typography>

        {Number.isFinite(Number(job.allowedHours)) && (
          <Typography sx={{ mt: 1 }}>
            <strong>Quoted Hours:</strong> {Number(job.allowedHours)}
          </Typography>
        )}
      </Paper>

      {/* Reference Photos (view only) */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <InsertPhotoRoundedIcon fontSize="small" /> Reference Photos
        </Typography>
        <Grid container spacing={1} mt={1}>
          {referencePhotos.length > 0 ? (
            referencePhotos.map((p) => (
              <Grid item key={p.id}>
                <Box
                  sx={{ position: 'relative', width: 120, height: 90, cursor: 'zoom-in' }}
                  onClick={() => openPreview(p.url)}
                >
                  <img
                    src={p.url}
                    alt="reference"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }}
                  />
                </Box>
              </Grid>
            ))
          ) : (
            <Grid item xs={12}>
              <Typography color="text.secondary">No reference photos.</Typography>
            </Grid>
          )}
        </Grid>
      </Paper>

      {/* Plans (PDF or images, view only) */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PictureAsPdfRoundedIcon fontSize="small" /> Plans
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1 }}>
          {plans.length > 0 ? (
            plans.map((pl) => {
              const url = pl.url;
              const name = pl.name || url?.split('?')[0]?.split('/').pop() || 'plan';
              const isImage = /\.(png|jpg|jpeg|webp|gif)$/i.test(name);
              const isPdf = /\.pdf$/i.test(name);

              if (isImage) {
                return (
                  <Box
                    key={pl.id}
                    sx={{ width: 140, height: 100, cursor: 'zoom-in' }}
                    onClick={() => openPreview(url)}
                    title={name}
                  >
                    <img
                      src={url}
                      alt={name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }}
                    />
                  </Box>
                );
              }

              return (
                <Chip
                  key={pl.id}
                  icon={<PictureAsPdfRoundedIcon />}
                  label={name}
                  clickable
                  onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  sx={{
                    bgcolor: isPdf ? 'rgba(244, 67, 54, 0.15)' : 'rgba(255,255,255,0.08)',
                    color: isPdf ? '#ef9a9a' : '#90caf9',
                    border: '1px solid rgba(255,255,255,0.15)',
                    fontWeight: 600,
                  }}
                />
              );
            })
          ) : (
            <Typography color="text.secondary">No plans uploaded.</Typography>
          )}
        </Box>
      </Paper>

      {/* Completed Photos (with enlarge + delete) */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6">Completed Photos</Typography>
        <Button variant="outlined" component="label" sx={{ mt: 1 }}>
          Upload Photos
          <input hidden type="file" accept="image/*" multiple onChange={(e) => handleUploadCompleted(e.target.files)} />
        </Button>

        <Grid container spacing={1} mt={1}>
          {completedPhotos.map((p) => (
            <Grid item key={p.id}>
              <Box sx={{ position: 'relative', width: 120, height: 90 }}>
                <img
                  src={p.url}
                  alt="completed"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, cursor: 'zoom-in' }}
                  onClick={() => openPreview(p.url)}
                />
                <IconButton
                  size="small"
                  onClick={() => removeCompletedPhoto(p)}
                  sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(0,0,0,0.5)', color: '#fff' }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            </Grid>
          ))}
          {completedPhotos.length === 0 && (
            <Grid item xs={12}>
              <Typography color="text.secondary">No completed photos yet.</Typography>
            </Grid>
          )}
        </Grid>
      </Paper>

      {/* Installer Notes */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6">Installer Notes</Typography>
        <TextField
          value={installerNotes}
          onChange={(e) => setInstallerNotes(e.target.value)}
          placeholder="Notes: issues, fixings used, extra media/substrates…"
          multiline minRows={3} fullWidth sx={{ mt: 1 }}
        />
        <Button sx={{ mt: 1 }} variant="contained" onClick={saveNotes} disabled={savingNotes}>
          {savingNotes ? 'Saving…' : 'Save Notes'}
        </Button>
      </Paper>

      {/* Signature */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6">Client Signature</Typography>
        {signatureURL ? (
          <Link onClick={() => openPreview(signatureURL)} underline="none" sx={{ cursor: 'zoom-in' }}>
            <img
              src={signatureURL}
              alt="signature"
              style={{ border: '1px solid #ccc', height: 120, borderRadius: 4, background: '#fff' }}
            />
          </Link>
        ) : (
          <Box>
            <SignatureCanvas
              penColor="black"
              canvasProps={{ width: 320, height: 140, style: { border: '1px solid #ccc' } }}
              ref={(r) => setSigPad(r)}
            />
            <Button sx={{ mt: 1 }} variant="outlined" onClick={saveSignature}>Save Signature</Button>
          </Box>
        )}
      </Paper>

      {/* Time Tracking */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6">Time Tracking</Typography>
        <Typography><strong>Total Hours:</strong> {totalHours.toFixed(2)} hrs</Typography>
        {Number.isFinite(Number(job.allowedHours)) && (
          <Typography sx={{ color: totalHours <= Number(job.allowedHours) ? 'green' : 'red' }}>
            <strong>Quoted Hours:</strong> {Number(job.allowedHours)}
          </Typography>
        )}

        {hoursByUser.length > 0 && (
          <Box sx={{ mt: 1 }}>
            {hoursByUser.map(({ uid, hrs }) => (
              <Chip
                key={uid}
                label={`${userMap?.[uid]?.shortName || userMap?.[uid]?.displayName || uid}: ${hrs} hrs`}
                sx={{ mr: 1, mb: 1 }}
              />
            ))}
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <TextField
            type="number" inputProps={{ step: '0.1', min: '0' }}
            placeholder="Add hours" value={newHours}
            onChange={(e) => setNewHours(e.target.value)} sx={{ width: 160 }}
          />
          <Button variant="outlined" onClick={addHours}>Submit</Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          {!timerRunning ? (
            <Button variant="contained" onClick={startTimer}>Start Timer</Button>
          ) : (
            <Button variant="outlined" color="error" onClick={stopTimer}>Stop Timer</Button>
          )}
        </Box>
      </Paper>

      {/* Footer */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={() => history.push(`/jobs/${jobId}/edit`)}>Edit Job</Button>
        <Button
          variant="outlined"
          color="error"
          onClick={async () => { await deleteDoc(doc(db, 'jobs', jobId)); history.push('/'); }}
        >
          Delete Job
        </Button>
        <Button variant="outlined" onClick={() => history.push('/')}>Back to List</Button>
        {String(job.status || '').toLowerCase() === 'completed' ? (
          <Button variant="outlined" color="warning" onClick={reopenJob}>Reopen Job</Button>
        ) : (
          <Button variant="outlined" color="success" onClick={completeJob}>Complete Job</Button>
        )}
      </Box>
    </Box>
  );
}
