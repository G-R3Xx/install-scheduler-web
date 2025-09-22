import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Button, Divider, Grid, Chip, TextField, Paper,
  IconButton, CircularProgress, Backdrop
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import { useParams, useHistory } from 'react-router-dom';
import {
  doc, getDoc, updateDoc, collection, addDoc, getDocs,
  serverTimestamp, deleteDoc
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

  const [completedPhotos, setCompletedPhotos] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [newHours, setNewHours] = useState('');
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState(null);

  const [signatureURL, setSignatureURL] = useState(null);
  const [sigPad, setSigPad] = useState(null);

  // --- Load job + subcollections
  const loadAll = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'jobs', jobId));
      if (!snap.exists()) {
        setJob(null);
        return;
      }
      const data = { id: snap.id, ...snap.data() };
      setJob(data);
      setInstallerNotes(data.installerNotes || '');
      setSignatureURL(data.signatureURL || null);

      const compSnap = await getDocs(collection(db, 'jobs', jobId, 'completedPhotos'));
      setCompletedPhotos(compSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));

      const hoursSnap = await getDocs(collection(db, 'jobs', jobId, 'timeEntries'));
      setTimeEntries(hoursSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
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

  // --- Upload completed photos
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

  const removeFileDoc = async (item) => {
    try {
      try {
        const u = new URL(item.url);
        const path = decodeURIComponent(u.pathname.replace(/^\/v0\/b\/[^/]+\/o\//, ''));
        await deleteObject(ref(storage, path));
      } catch {}
      await deleteDoc(doc(db, 'jobs', jobId, 'completedPhotos', item.id));
      await loadAll();
    } catch {}
  };

  // --- Actions
  const saveNotes = async () => {
    try {
      setSavingNotes(true);
      await updateDoc(doc(db, 'jobs', jobId), { installerNotes, updatedAt: serverTimestamp() });
    } finally {
      setSavingNotes(false);
    }
  };

  const addHours = async () => {
    const h = parseFloat(newHours);
    if (!Number.isFinite(h) || h <= 0) return;
    await addDoc(collection(db, 'jobs', jobId, 'timeEntries'), {
      userId: currentUser.uid,
      hours: h,
      createdAt: serverTimestamp(),
    });
    setNewHours('');
    loadAll();
  };

  // Timer
  const startTimer = () => { setTimerRunning(true); setTimerStart(Date.now()); };
  const stopTimer = async () => {
    if (!timerRunning || !timerStart) return;
    const elapsedMs = Date.now() - timerStart;
    const hours = elapsedMs / 1000 / 3600;
    await addDoc(collection(db, 'jobs', jobId, 'timeEntries'), {
      userId: currentUser.uid,
      hours,
      createdAt: serverTimestamp(),
    });
    setTimerRunning(false);
    setTimerStart(null);
    loadAll();
  };

  // ✅ Standardized to "completed"
  const completeJob = async () => {
    await updateDoc(doc(db, 'jobs', jobId), {
      status: 'completed',
      completedAt: serverTimestamp(),
    });
    history.push('/');
  };
  const reopenJob = async () => {
    await updateDoc(doc(db, 'jobs', jobId), { status: 'in progress', completedAt: null });
    loadAll();
  };

  const saveSignature = async () => {
    if (!sigPad || sigPad.isEmpty()) return;
    const dataUrl = sigPad.getTrimmedCanvas().toDataURL('image/png');
    const blob = await (await fetch(dataUrl)).blob();
    const r = ref(storage, `jobs/${jobId}/signature.png`);
    await uploadBytes(r, blob);
    const url = await getDownloadURL(r);
    await updateDoc(doc(db, 'jobs', jobId), { signatureURL: url });
    setSignatureURL(url);
  };

  const totalHours = useMemo(() => timeEntries.reduce((s, e) => s + (e.hours || 0), 0), [timeEntries]);
  const hoursByUser = useMemo(() => {
    const map = {};
    for (const e of timeEntries) {
      const uid = e.userId || 'unknown';
      map[uid] = (map[uid] || 0) + (Number(e.hours) || 0);
    }
    return Object.entries(map).map(([uid, hrs]) => ({
      uid, hrs: Math.round(hrs * 100) / 100
    }));
  }, [timeEntries]);

  if (!jobId) return <Box p={2}><Typography color="error">Invalid job id.</Typography></Box>;
  if (loading) return <Box p={2}><Typography>Loading…</Typography></Box>;
  if (!job) return <Box p={2}><Typography>Job not found.</Typography></Box>;

  const jsDate = job.installDate?.toDate ? job.installDate.toDate() : null;

  return (
    <Box sx={{ p: 2, maxWidth: 1000, mx: 'auto' }}>
      <BusyOverlay open={busy} text="Uploading files… please don't exit" />
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
        <Typography sx={{ mt: 1 }}>
          <strong>Status:</strong> {job.status || '—'}
        </Typography>
        <Typography>
          <strong>Install Date:</strong> {fmtDate(jsDate)}
          {job.installTime && jsDate && (
            <Chip size="small" icon={<AccessTimeRoundedIcon />} label={fmtTime(jsDate)} sx={{ ml: 1 }} />
          )}
        </Typography>
        <Typography><strong>Assigned To:</strong> {assignedNames}</Typography>
        {job.allowedHours && (
          <Typography sx={{ mt: 1 }}>
            <strong>Quoted Hours:</strong> {job.allowedHours}
          </Typography>
        )}
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
              <Box sx={{ position: 'relative', width: 120, height: 90 }}>
                <img src={p.url} alt="completed" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <IconButton size="small" onClick={() => removeFileDoc(p)} sx={{ position: 'absolute', top: 0, right: 0 }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Paper>

      {/* Installer Notes */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6">Installer Notes</Typography>
        <TextField
          value={installerNotes}
          onChange={(e) => setInstallerNotes(e.target.value)}
          placeholder="Notes…"
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
          <img src={signatureURL} alt="signature" style={{ border: '1px solid #ccc', height: 120 }} />
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
        {job.allowedHours && (
          <Typography sx={{ color: totalHours <= job.allowedHours ? 'green' : 'red' }}>
            <strong>Quoted Hours:</strong> {job.allowedHours}
          </Typography>
        )}
        {hoursByUser.length > 0 && (
          <Box sx={{ mt: 1 }}>
            {hoursByUser.map(({ uid, hrs }) => (
              <Chip key={uid} label={`${userMap?.[uid]?.shortName || uid}: ${hrs} hrs`} sx={{ mr: 1, mb: 1 }} />
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

      {/* Footer buttons */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={() => history.push(`/jobs/${jobId}/edit`)}>Edit Job</Button>
        <Button variant="outlined" color="error" onClick={async () => { await deleteDoc(doc(db, 'jobs', jobId)); history.push('/'); }}>Delete Job</Button>
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
