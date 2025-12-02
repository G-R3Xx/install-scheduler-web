// src/pages/JobDetailPage.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Button, Divider, Grid, Chip, TextField, Paper,
  IconButton, CircularProgress, Backdrop, Dialog, DialogTitle, DialogContent, DialogActions, Link, Stack
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import InsertPhotoRoundedIcon from '@mui/icons-material/InsertPhotoRounded';
import { useParams, useHistory } from 'react-router-dom';
import {
  doc, getDoc, updateDoc, collection, addDoc, getDocs,
  serverTimestamp, deleteDoc, Timestamp
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

const fmtTimeHM = (date) =>
  !date ? '—' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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
  const [timeEntries, setTimeEntries] = useState([]);           // [{id,userId,hours,createdAt,start,end,source}]
  const [newHours, setNewHours] = useState('');

  // Timer (persistent, backed by Firestore running entry)
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState(null); // ms
  const [elapsed, setElapsed] = useState(0);
  const LS_TIMER_START_KEY = `timer:${jobId}:startMs`;
  const LS_TIMER_ENTRY_KEY = `timer:${jobId}:entryId`;

  // Signature dialog
  const [sigDialogOpen, setSigDialogOpen] = useState(false);
  const [sigPad, setSigPad] = useState(null);
  const [signatureURL, setSignatureURL] = useState(null);

  // Image preview dialog
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  // Client email state
  const [sendingClientEmail, setSendingClientEmail] = useState(false);

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

  // Restore timer on mount and keep ticking
  useEffect(() => {
    const startMs = Number(localStorage.getItem(LS_TIMER_START_KEY));
    const entryId = localStorage.getItem(LS_TIMER_ENTRY_KEY);
    if (Number.isFinite(startMs) && entryId) {
      setTimerRunning(true);
      setTimerStart(startMs);
      setElapsed(Date.now() - startMs);
    }
  }, [jobId]);

  useEffect(() => {
    if (!timerRunning || !timerStart) return;
    const id = setInterval(() => setElapsed(Date.now() - timerStart), 1000);
    return () => clearInterval(id);
  }, [timerRunning, timerStart]);

  const assignedNames = useMemo(() => {
    if (!job) return '—';
    const ids = Array.isArray(job.assignedTo) ? job.assignedTo : job.assignedTo ? [job.assignedTo] : [];
    if (!ids.length) return 'Unassigned';
    return ids.map(uid =>
      userMap?.[uid]?.shortName || userMap?.[uid]?.displayName || userMap?.[uid]?.email || 'User'
    ).join(', ');
  }, [job, userMap]);

  // --- Completed photos: upload & remove
  const handleUploadCompleted = async (files) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setBusy(true);
    try {
      for (const f of arr) {
        const r = ref(storage, `jobs/${jobId}/completed/${Date.now()}_${f.name}`);
        await uploadBytes(r, f);
        const url = await getDownloadURL(r);
        await addDoc(collection(db, 'jobs', jobId, 'completedPhotos'), { url, createdAt: serverTimestamp() });
      }
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const removeCompletedPhoto = async (item) => {
    setBusy(true);
    try {
      // Try delete by URL path portion
      try {
        const u = new URL(item.url);
        const path = decodeURIComponent(u.pathname.replace(/^\/v0\/b\/[^/]+\/o\//, ''));
        await deleteObject(ref(storage, path));
      } catch {
        // ignore parse errors
      }
      await deleteDoc(doc(db, 'jobs', jobId, 'completedPhotos', item.id));
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

  // --- Manual hours
  const addHours = async () => {
    const h = parseFloat(newHours);
    if (!Number.isFinite(h) || h <= 0) return;
    await addDoc(collection(db, 'jobs', jobId, 'timeEntries'), {
      userId: currentUser?.uid || 'unknown',
      userShortName: userMap?.[currentUser?.uid || '']?.shortName,
      hours: h,
      createdAt: serverTimestamp(),
      source: 'manual',
    });
    setNewHours('');
    loadAll();
  };

  // --- Timer start/stop with running entry
  const startTimer = async () => {
    if (!currentUser) return;
    const startMs = Date.now();
    const startTs = Timestamp.fromDate(new Date(startMs));
    const docRef = await addDoc(collection(db, 'jobs', jobId, 'timeEntries'), {
      userId: currentUser.uid,
      userShortName: userMap?.[currentUser.uid]?.shortName,
      start: startTs,
      end: null,
      createdAt: serverTimestamp(),
      source: 'timer',
    });
    localStorage.setItem(LS_TIMER_START_KEY, String(startMs));
    localStorage.setItem(LS_TIMER_ENTRY_KEY, docRef.id);

    setTimerRunning(true);
    setTimerStart(startMs);
    setElapsed(0);
  };

  const stopTimer = async () => {
    if (!timerRunning || !timerStart) return;
    const entryId = localStorage.getItem(LS_TIMER_ENTRY_KEY);
    const startMs = Number(localStorage.getItem(LS_TIMER_START_KEY));
    const startMillis = Number.isFinite(startMs) ? startMs : Date.now();
    const elapsedMs = Date.now() - startMillis;
    const hours = elapsedMs / 3600000;

    if (entryId) {
      try {
        await updateDoc(doc(db, 'jobs', jobId, 'timeEntries', entryId), {
          end: serverTimestamp(),
          hours,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        console.error('Failed to close timer entry', e);
      }
    } else {
      await addDoc(collection(db, 'jobs', jobId, 'timeEntries'), {
        userId: currentUser?.uid || 'unknown',
        userShortName: userMap?.[currentUser?.uid || '']?.shortName,
        hours,
        createdAt: serverTimestamp(),
        source: 'timer-fallback',
      });
    }

    localStorage.removeItem(LS_TIMER_START_KEY);
    localStorage.removeItem(LS_TIMER_ENTRY_KEY);
    setTimerRunning(false);
    setTimerStart(null);
    setElapsed(0);
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
  const openSignatureDialog = () => setSigDialogOpen(true);
  const closeSignatureDialog = () => setSigDialogOpen(false);

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
      closeSignatureDialog();
    } finally {
      setBusy(false);
    }
  };

  // ---- Client email handler
  const handleSendClientEmail = async () => {
    if (!job || !job.id || !job.email) {
      alert('Missing job or client email.');
      return;
    }

    if (!window.confirm(`Send completion summary to ${job.email}?`)) {
      return;
    }

    try {
      setSendingClientEmail(true);

      const res = await fetch(
  'https://australia-southeast1-install-scheduler.cloudfunctions.net/sendClientCompletionEmail',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id }),
  }
);


      if (!res.ok) {
        const text = await res.text();
        console.error('Client email failed:', text);
        alert('Client email failed. Check console/logs.');
        return;
      }

      alert('Client email sent ✅');
    } catch (err) {
      console.error(err);
      alert('Client email failed. See console for details.');
    } finally {
      setSendingClientEmail(false);
    }
  };

  // ---- Derived totals
  const totalHours = useMemo(
    () => round2(timeEntries.reduce((s, e) => s + (Number(e.hours) || 0), 0)),
    [timeEntries]
  );

  // Group entries by user for readability
  const entriesByUser = useMemo(() => {
    const map = new Map();
    for (const e of timeEntries) {
      const uid = e.userId || 'unknown';
      if (!map.has(uid)) map.set(uid, []);
      map.get(uid).push(e);
    }
    // sort each user's entries by start/createdAt ascending
    for (const [uid, arr] of map) {
      arr.sort((a, b) => {
        const as = a.start?.toDate?.() || a.createdAt?.toDate?.() || new Date(0);
        const bs = b.start?.toDate?.() || b.createdAt?.toDate?.() || new Date(0);
        return as - bs;
      });
    }
    return Array.from(map.entries());
  }, [timeEntries]);

  const userTotal = useCallback((uid) => {
    return round2((timeEntries || []).filter(e => (e.userId || 'unknown') === uid)
      .reduce((s, e) => s + (Number(e.hours) || 0), 0));
  }, [timeEntries]);

  const fmtElapsed = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  if (!jobId) return <Box p={2}><Typography color="error">Invalid job id.</Typography></Box>;
  if (loading) return <Box p={2}><Typography>Loading…</Typography></Box>;
  if (!job) return <Box p={2}><Typography>Job not found.</Typography></Box>;

  const jsDate = toJSDate(job.installDate);

  return (
    <Box sx={{ p: 2, maxWidth: 1100, mx: 'auto' }}>
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

      {/* Signature dialog */}
      <Dialog open={sigDialogOpen} onClose={closeSignatureDialog}>
        <DialogTitle>Client Signature</DialogTitle>
        <DialogContent>
          <SignatureCanvas
            penColor="black"
            canvasProps={{ width: 360, height: 160, style: { border: '1px solid #ccc', background: '#fff' } }}
            ref={(r) => setSigPad(r)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSignatureDialog}>Cancel</Button>
          <Button variant="contained" onClick={saveSignature}>Save</Button>
        </DialogActions>
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
        <Typography component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                  sx={{ position: 'relative', width: 140, height: 100, cursor: 'zoom-in' }}
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

      {/* Plans */}
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
                    sx={{ width: 160, height: 110, cursor: 'zoom-in' }}
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

      {/* Completed Photos */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6">Completed Photos</Typography>
        <Button variant="outlined" component="label" sx={{ mt: 1 }}>
          Upload Photos
          <input hidden type="file" accept="image/*" multiple onChange={(e) => handleUploadCompleted(e.target.files)} />
        </Button>

        <Grid container spacing={1} mt={1}>
          {completedPhotos.map((p) => (
            <Grid item key={p.id}>
              <Box sx={{ position: 'relative', width: 140, height: 100 }}>
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

      {/* Signature (preview + open dialog) */}
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
          <Button sx={{ mt: 1 }} variant="outlined" onClick={openSignatureDialog}>Capture Signature</Button>
        )}
      </Paper>

      {/* Time Tracking */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Time Tracking</Typography>
          <Typography><strong>Total Hours:</strong> {totalHours.toFixed(2)} hrs</Typography>
        </Stack>

        {Number.isFinite(Number(job.allowedHours)) && (
          <Typography sx={{ color: totalHours <= Number(job.allowedHours) ? 'green' : 'red', mb: 1 }}>
            <strong>Quoted Hours:</strong> {Number(job.allowedHours)}
          </Typography>
        )}

        {/* Per-user grouped list with readable entries */}
        <Box sx={{ display: 'grid', gap: 1.25 }}>
          {entriesByUser.length ? entriesByUser.map(([uid, entries]) => {
            const name = userMap?.[uid]?.shortName || userMap?.[uid]?.displayName || userMap?.[uid]?.email || uid;
            const subtotal = userTotal(uid).toFixed(2);
            return (
              <Paper key={uid} variant="outlined" sx={{ p: 1.25, bgcolor: 'rgba(255,255,255,0.02)' }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                  <Chip label={`${name}`} />
                  <Chip size="small" color="primary" variant="outlined" label={`${subtotal} hrs`} />
                </Stack>
                <Box sx={{ display: 'grid', gap: 0.5 }}>
                  {entries.map((e) => {
                    const start = e.start?.toDate?.() || null;
                    const end = e.end?.toDate?.() || null;
                    const created = e.createdAt?.toDate?.() || null;
                    const dateRef = start || created;
                    const dateStr = dateRef ? fmtDate(dateRef) : '—';
                    const rangeStr = start || end
                      ? `${fmtTimeHM(start)} → ${fmtTimeHM(end)}`
                      : created ? `Logged: ${fmtTimeHM(created)}` : '—';
                    const hrs = round2(e.hours || 0);
                    const type = (e.source || (e.start ? 'timer' : 'manual')).toUpperCase();
                    return (
                      <Box key={e.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Chip size="small" label={dateStr} />
                        <Typography variant="body2" sx={{ opacity: 0.85 }}>{rangeStr}</Typography>
                        <Chip size="small" variant="outlined" label={`${hrs} h`} />
                        <Chip size="small" variant="outlined" label={type} />
                      </Box>
                    );
                  })}
                </Box>
              </Paper>
            );
          }) : (
            <Typography color="text.secondary">No time entries yet.</Typography>
          )}
        </Box>

        {/* Add hours + timer controls */}
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            type="number" inputProps={{ step: '0.1', min: '0' }}
            placeholder="Add hours" value={newHours}
            onChange={(e) => setNewHours(e.target.value)} sx={{ width: 160 }}
          />
          <Button variant="outlined" onClick={addHours}>Submit</Button>

          {!timerRunning ? (
            <Button variant="contained" onClick={startTimer}>Start Timer</Button>
          ) : (
            <>
              <Button variant="outlined" color="error" onClick={stopTimer}>Stop Timer</Button>
              <Chip label={`Running: ${fmtElapsed(elapsed)}`} />
            </>
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
        <Button
          variant="outlined"
          color="primary"
          disabled={sendingClientEmail || job.status !== 'completed' || !job.email}
          onClick={handleSendClientEmail}
        >
          {sendingClientEmail ? 'Sending client email…' : 'Email client summary'}
        </Button>
      </Box>
    </Box>
  );
}
