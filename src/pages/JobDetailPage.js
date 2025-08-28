// src/pages/JobDetailPage.js
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Divider,
  Grid,
  Chip,
  TextField,
  Dialog,
  DialogContent,
  Card,
  CardContent,
  Snackbar,
  Alert,
  DialogTitle,
  DialogActions
} from '@mui/material';
import { useParams, useHistory } from 'react-router-dom';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  deleteField
} from 'firebase/firestore';
import { db, storage } from '../firebase/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import SignatureCanvas from 'react-signature-canvas';
import { useAuth } from '../contexts/AuthContext';
import OhsPromptOnLoad from '../components/OhsPromptOnLoad';
import { jsPDF } from 'jspdf';

// ---- Functions endpoint base ----
// Set REACT_APP_FUNCTIONS_BASE in .env to override.
// Fallback uses your project id from earlier messages.
const FUNCTIONS_BASE =
  process.env.REACT_APP_FUNCTIONS_BASE ||
  'https://us-central1-install-scheduler.cloudfunctions.net';

export default function JobDetailPage() {
  const { jobId } = useParams();
  const history = useHistory();
  const { currentUser, userMap } = useAuth();

  const [job, setJob] = useState(null);
  const [hours, setHours] = useState('');
  const [timeEntries, setTimeEntries] = useState([]);
  const [sigPad, setSigPad] = useState(null);
  const [signatureURL, setSignatureURL] = useState(null);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [dialogImageSrc, setDialogImageSrc] = useState('');

  // resend email UX state
  const [resendOpen, setResendOpen] = useState(false);
  const [resending, setResending] = useState(false);
  const [snack, setSnack] = useState({ open: false, severity: 'success', msg: '' });

  // ---------- helpers ----------
  const getUserName = (uid) => userMap?.[uid]?.shortName || 'Unknown';
  const toDateString = (tsOrDate) =>
    tsOrDate?.toDate?.()?.toLocaleDateString?.() ||
    (tsOrDate instanceof Date ? tsOrDate.toLocaleDateString() : '');

  const extractNiceName = (url, fallback) => {
    try {
      const decoded = decodeURIComponent(url);
      // Try to derive from /plans/<filename> first
      const afterPlans = decoded.split('/plans/')[1];
      if (afterPlans) return afterPlans.split('?')[0];
      // Otherwise from /referencePhotos/ or /photos/
      const afterPhotos = decoded.split('/referencePhotos/')[1] || decoded.split('/photos/')[1];
      if (afterPhotos) return afterPhotos.split('?')[0];
    } catch { /* ignore */ }
    return fallback;
  };

  // ---------- data fetch ----------
  const fetchJob = useCallback(async () => {
    const snap = await getDoc(doc(db, 'jobs', jobId));
    if (!snap.exists()) return;
    const data = snap.data() || {};

    // Coerce many legacy shapes into a clean string[] and rich[] for plans
    const rawPlans =
      data.plans ??
      data.planUrls ??
      data.plansUrls ??
      data.plansURL ??
      data.planUrl ??
      data.plan ??
      [];

    let plans = [];
    let plansRich = [];

    // Accept: string, string[], [{ url|href|downloadURL|path|storagePath, name? }]
    if (Array.isArray(rawPlans)) {
      plansRich = rawPlans.map(p => {
        if (typeof p === 'string') return { url: p };
        if (p && typeof p === 'object') {
          return {
            url: p.url || p.href || p.downloadURL || p.path || p.storagePath || '',
            name: p.name || p.title || ''
          };
        }
        return { url: '' };
      });
      plans = plansRich.map(p => p.url).filter(Boolean);
    } else if (typeof rawPlans === 'string') {
      plans = [rawPlans];
      plansRich = [{ url: rawPlans }];
    }

    // Normalize other legacy fields
    const normalized = {
      id: snap.id,
      ...data,
      referencePhotos: Array.isArray(data.referencePhotos) ? data.referencePhotos : [],
      completedPhotos: Array.isArray(data.completedPhotos) ? data.completedPhotos : [],
      plans,      // string[] urls or storage paths
      plansRich,  // [{url,name?}]
    };

    setJob(normalized);
    setSignatureURL(normalized.signatureURL || null);
  }, [jobId]);

  const fetchHours = useCallback(async () => {
    const entriesSnap = await getDocs(collection(db, 'jobs', jobId, 'timeEntries'));
    const entries = entriesSnap.docs.map(d => d.data());
    setTimeEntries(entries);
  }, [jobId]);

  useEffect(() => {
    fetchJob();
    fetchHours();
  }, [fetchJob, fetchHours]);

  // ---------- actions ----------
  const handleAddHours = async () => {
    const parsed = parseFloat(hours);
    if (isNaN(parsed) || parsed <= 0) return;

    await addDoc(collection(db, 'jobs', jobId, 'timeEntries'), {
      userId: currentUser.uid,
      hours: parsed,
      timestamp: new Date()
    });

    setHours('');
    fetchHours();
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const newUrls = [];
    for (const file of files) {
      const fileRef = ref(storage, `jobs/${jobId}/photos/${file.name}`);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      newUrls.push(url);
    }

    // Update local state first for snappy UI
    setJob(prev => ({
      ...prev,
      completedPhotos: [...(prev.completedPhotos || []), ...newUrls]
    }));

    // Persist in Firestore
    await updateDoc(doc(db, 'jobs', jobId), {
      completedPhotos: [...(job?.completedPhotos || []), ...newUrls]
    });

    // reset input
    e.target.value = '';
  };

  const handleSaveSignature = async () => {
    if (!sigPad || sigPad.isEmpty()) return;
    const dataUrl = sigPad.getTrimmedCanvas().toDataURL('image/png');

    const blob = await (await fetch(dataUrl)).blob();
    const fileRef = ref(storage, `jobs/${jobId}/signature.png`);
    await uploadBytes(fileRef, blob);
    const url = await getDownloadURL(fileRef);

    await updateDoc(doc(db, 'jobs', jobId), { signatureURL: url });
    setSignatureURL(url);
  };

  const handleCompleteJob = async () => {
    await updateDoc(doc(db, 'jobs', jobId), { status: 'complete' });
    history.push('/'); // back to list after completing
  };

  const handleReopenJob = async () => {
    await updateDoc(doc(db, 'jobs', jobId), { status: 'in progress' });
    await fetchJob();
  };

  const openImagePopup = (url) => {
    setDialogImageSrc(url);
    setImageDialogOpen(true);
  };

  // ---------- OHS: set/clear status directly ----------
  const handleMarkOhsCompleted = async () => {
    await updateDoc(doc(db, 'jobs', jobId), {
      ohsCompleted: true,
      ohsCompletedAt: serverTimestamp(),
      ohsLastBy: currentUser.uid,
      ohsLastByEmail: currentUser.email || null
    });
    await fetchJob();
  };

  const handleClearOhsStatus = async () => {
    await updateDoc(doc(db, 'jobs', jobId), {
      ohsCompleted: false,
      ohsCompletedAt: deleteField(),
      ohsLastBy: deleteField(),
      ohsLastByEmail: deleteField(),
      ohsLastFormId: deleteField()
    });
    await fetchJob();
  };

  // ---------- OHS: PDF download (latest form) ----------
  const downloadLatestOhsPdf = async () => {
    try {
      const formsRef = collection(db, 'jobs', jobId, 'ohsForms');
      const qLatest = query(formsRef, orderBy('completedAt', 'desc'), limit(1));
      const snap = await getDocs(qLatest);
      if (snap.empty) {
        alert('No OHS form found for this job.');
        return;
      }
      const docSnap = snap.docs[0];
      const data = docSnap.data();

      const completedAt =
        data?.completedAt?.toDate
          ? data.completedAt.toDate().toLocaleString()
          : 'N/A';

      const completedByShort =
        (data.completedBy && userMap?.[data.completedBy]?.shortName) ||
        data.completedByEmail ||
        data.completedBy ||
        'Unknown';

      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      let y = 40;
      const left = 40;

      const line = (label, value='') => {
        pdf.setFont('helvetica', 'bold'); pdf.text(`${label}:`, left, y);
        pdf.setFont('helvetica', 'normal'); pdf.text(String(value ?? ''), left + 160, y);
        y += 20;
      };

      pdf.setFontSize(16);
      pdf.text('Job OHS Form', left, y); y += 20;

      pdf.setFontSize(11);
      line('Job', job.clientName || job.client || 'Untitled');
      line('Address', job.address || '');
      line('Completed At', completedAt);
      line('Completed By', completedByShort);

      y += 10;
      pdf.setFont('helvetica', 'bold'); pdf.text('Site Induction', left, y); y += 20;
      line('Induction completed', data.siteInduction ? 'Yes' : 'No');

      y += 10;
      pdf.setFont('helvetica', 'bold'); pdf.text('PPE Checklist', left, y); y += 20;
      line('Hi-Vis', data?.ppe?.hiVis ? 'Yes' : 'No');
      line('Eye protection', data?.ppe?.eyeProtection ? 'Yes' : 'No');
      line('Hearing protection', data?.ppe?.hearingProtection ? 'Yes' : 'No');

      y += 10;
      pdf.setFont('helvetica', 'bold'); pdf.text('Key Risks', left, y); y += 20;
      line('Working at heights', data?.risks?.workingAtHeights ? 'Yes' : 'No');
      line('Electrical', data?.risks?.electrical ? 'Yes' : 'No');
      line('Public/Traffic', data?.risks?.publicTraffic ? 'Yes' : 'No');

      y += 10;
      pdf.setFont('helvetica', 'bold'); pdf.text('Controls / Notes', left, y); y += 20;
      pdf.setFont('helvetica', 'normal');
      (data.controlsNotes || '').toString().split('\n').forEach(row => { pdf.text(row, left, y); y += 16; });

      y += 10;
      pdf.setFont('helvetica', 'bold'); pdf.text('Contacts & Emergency', left, y); y += 20;
      pdf.setFont('helvetica', 'normal');
      line('Site contact', data.siteContact || '');
      line('Emergency info', data.emergencyInfo || '');

      const fileName = `OHS_${(job.clientName || job.client || jobId).toString().replace(/\s+/g, '_')}.pdf`;
      pdf.save(fileName);
    } catch (err) {
      console.error(err);
      alert('Failed to generate OHS PDF.');
    }
  };

  // ---------- Plans: open URL or resolve Storage path ----------
  const openPlan = async (planObjOrUrl) => {
    const candidate = typeof planObjOrUrl === 'string'
      ? planObjOrUrl
      : (planObjOrUrl?.url ||
         planObjOrUrl?.href ||
         planObjOrUrl?.downloadURL ||
         planObjOrUrl?.path ||
         planObjOrUrl?.storagePath ||
         '');

    if (!candidate) return;

    // If already a full http(s) URL, open directly
    if (/^https?:\/\//i.test(candidate)) {
      window.open(candidate, '_blank');
      return;
    }

    // Otherwise treat as Storage path and resolve
    try {
      const storageRef = ref(storage, candidate);
      const dl = await getDownloadURL(storageRef);
      window.open(dl, '_blank');
    } catch (err) {
      console.error('Failed to open plan', err);
      alert('Could not open plan file.');
    }
  };

  // ---------- Resend completion email ----------
  const doResend = async () => {
    setResending(true);
    try {
      const url = `${FUNCTIONS_BASE}/resendCompletionEmail?jobId=${encodeURIComponent(jobId)}`;
      const resp = await fetch(url, { method: 'GET', mode: 'cors' });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      setSnack({ open: true, severity: 'success', msg: 'Completion email resent.' });
    } catch (e) {
      console.error('Resend failed', e);
      setSnack({ open: true, severity: 'error', msg: `Resend failed: ${e.message}` });
    } finally {
      setResending(false);
      setResendOpen(false);
    }
  };

  if (!job) return <Box p={3}><Typography>Loading…</Typography></Box>;

  const assignedArray = Array.isArray(job.assignedTo) ? job.assignedTo : (job.assignedTo ? [job.assignedTo] : []);
  const installDateStr = toDateString(job.installDate);
  const userTotal = timeEntries.filter(e => e.userId === currentUser.uid).reduce((s, e) => s + (e.hours || 0), 0);
  const jobTotal = timeEntries.reduce((s, e) => s + (e.hours || 0), 0);
  const ohsDone = !!job.ohsCompleted || !!job.ohsCompletedAt;

  return (
    <Box p={3}>
      {/* OHS PROMPT */}
      <OhsPromptOnLoad jobId={jobId} jobStatus={job?.status} />

      <Card>
        <CardContent>
          <Typography variant="h5" gutterBottom>Job Details</Typography>

          {/* CLIENT DETAILS */}
          <Box mt={2}>
            <Typography variant="h6">Client Info</Typography>
            <Divider sx={{ mb: 1 }} />
            <Typography><strong>Client:</strong> {job.clientName}</Typography>
            <Typography><strong>Company:</strong> {job.company}</Typography>
            <Typography><strong>Contact:</strong> {job.contact}</Typography>
            <Typography><strong>Phone:</strong> {job.phone}</Typography>
            <Typography><strong>Email:</strong> {job.email}</Typography>
            <Typography><strong>Address:</strong> {job.address}</Typography>
          </Box>

          {/* JOB INFO */}
          <Box mt={3}>
            <Typography variant="h6">Job Info</Typography>
            <Divider sx={{ mb: 1 }} />
            <Typography><strong>Description:</strong> {job.description}</Typography>
            <Typography><strong>Status:</strong> {job.status}</Typography>
            <Typography><strong>Install Date:</strong> {installDateStr}</Typography>
            <Typography><strong>Assigned To:</strong></Typography>
            <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
              {assignedArray.length
                ? assignedArray.map(uid => <Chip key={uid} label={getUserName(uid)} />)
                : <Chip label="Unassigned" />}
            </Box>
          </Box>

          {/* OHS STATUS & ACTIONS */}
          <Box mt={3}>
            <Typography variant="h6">OHS</Typography>
            <Divider sx={{ mb: 1 }} />
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              {ohsDone ? (
                <Chip
                  label={`OHS Completed${job.ohsCompletedAt?.toDate ? ` · ${job.ohsCompletedAt.toDate().toLocaleString()}` : ''}`}
                  color="success"
                />
              ) : (
                <Chip label="OHS Not Completed" color="warning" />
              )}

              <Button
                variant="outlined"
                onClick={downloadLatestOhsPdf}
                disabled={!ohsDone}
              >
                View latest OHS PDF
              </Button>

              {!ohsDone && (
                <Button
                  variant="contained"
                  color="success"
                  onClick={handleMarkOhsCompleted}
                >
                  Mark OHS Completed
                </Button>
              )}

              {ohsDone && (
                <Button
                  variant="text"
                  color="warning"
                  onClick={handleClearOhsStatus}
                >
                  Clear OHS Status
                </Button>
              )}

              {!ohsDone && (
                <Button
                  variant="outlined"
                  onClick={() => history.push(`/jobs/${jobId}/ohs`)}
                >
                  Complete OHS now
                </Button>
              )}

              {/* NEW: Resend completion email */}
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => setResendOpen(true)}
              >
                Resend completion email
              </Button>
            </Box>
          </Box>

          {/* PLANS (PDF) */}
          <Box mt={3}>
            <Typography variant="h6">Plans (PDF)</Typography>
            <Divider sx={{ mb: 1 }} />
            {(!job.plans || job.plans.length === 0) && (
              <Typography color="text.secondary">No plans uploaded.</Typography>
            )}
            <Box display="flex" flexDirection="column" gap={1} mt={1}>
              {(job.plansRich && job.plansRich.length ? job.plansRich : (job.plans || []).map(u => ({ url: u }))).map((p, idx) => {
                const url = p.url || '';
                const label =
                  p.name || p.title || (() => {
                    try {
                      const decoded = decodeURIComponent(url);
                      const last = decoded.split('?')[0].split('/').pop();
                      return last || `Plan ${idx + 1}`;
                    } catch {
                      return `Plan ${idx + 1}`;
                    }
                  })();

                return (
                  <Button
                    key={`${url}-${idx}`}
                    variant="outlined"
                    onClick={() => openPlan(p)}
                    sx={{ justifyContent: 'flex-start' }}
                    disabled={!url}
                  >
                    {label}
                  </Button>
                );
              })}
            </Box>
          </Box>

          {/* REFERENCE PHOTOS */}
          <Box mt={3}>
            <Typography variant="h6">Reference Photos</Typography>
            <Divider sx={{ mb: 1 }} />
            {(!job.referencePhotos || job.referencePhotos.length === 0) && (
              <Typography color="text.secondary">No reference photos.</Typography>
            )}
            <Grid container spacing={1}>
              {(job.referencePhotos || []).map((url, idx) => (
                <Grid item key={idx}>
                  <img
                    src={url}
                    alt={`ref-${idx}`}
                    style={{ width: 100, height: 100, objectFit: 'cover', cursor: 'pointer', borderRadius: 4 }}
                    onClick={() => openImagePopup(url)}
                  />
                </Grid>
              ))}
            </Grid>
          </Box>

          {/* COMPLETED PHOTOS */}
          <Box mt={3}>
            <Typography variant="h6">Completed Photos</Typography>
            <Divider sx={{ mb: 1 }} />
            <Button variant="outlined" component="label" sx={{ mt: 1 }}>
              Upload Photos
              <input type="file" hidden accept="image/*" multiple onChange={handlePhotoUpload} />
            </Button>
            {(!job.completedPhotos || job.completedPhotos.length === 0) && (
              <Typography color="text.secondary" mt={1}>No completed photos yet.</Typography>
            )}
            <Grid container spacing={1} mt={1}>
              {(job.completedPhotos || []).map((url, idx) => (
                <Grid item key={idx}>
                  <img
                    src={url}
                    alt={`completed-${idx}`}
                    style={{ width: 100, height: 100, objectFit: 'cover', cursor: 'pointer', borderRadius: 4 }}
                    onClick={() => openImagePopup(url)}
                  />
                </Grid>
              ))}
            </Grid>
          </Box>

          {/* SIGNATURE */}
          <Box mt={3}>
            <Typography variant="h6">Client Signature</Typography>
            <Divider sx={{ mb: 1 }} />
            {signatureURL ? (
              <img
                src={signatureURL}
                alt="signature"
                style={{ border: '1px solid #ccc', height: 120, borderRadius: 4 }}
              />
            ) : (
              <>
                <Box
                  sx={{
                    border: '1px solid #ccc',
                    width: 320,
                    height: 140,
                    mb: 1,
                    borderRadius: 1
                  }}
                >
                  <SignatureCanvas
                    penColor="black"
                    canvasProps={{ width: 320, height: 140, style: { display: 'block' } }}
                    ref={ref => setSigPad(ref)}
                  />
                </Box>
                <Button variant="outlined" onClick={handleSaveSignature}>Save Signature</Button>
              </>
            )}
          </Box>

          {/* TIME TRACKING */}
          <Box mt={3}>
            <Typography variant="h6">Time Tracking</Typography>
            <Divider sx={{ mb: 1 }} />
            <Typography><strong>Your total:</strong> {userTotal} hrs</Typography>
            <Typography><strong>Job total:</strong> {jobTotal} hrs</Typography>
            <Box mt={1} display="flex" alignItems="center" gap={2}>
              <TextField
                label="Add Hours"
                type="number"
                value={hours}
                onChange={e => setHours(e.target.value)}
                sx={{ width: 160 }}
              />
              <Button variant="outlined" onClick={handleAddHours}>Submit</Button>
            </Box>
          </Box>

          {/* ACTIONS */}
          <Box mt={4} display="flex" gap={2} flexWrap="wrap">
            <Button
              variant="contained"
              onClick={() => history.push(`/jobs/${jobId}/edit`)}
            >
              Edit Job
            </Button>

            <Button variant="outlined" onClick={() => history.push('/')}>
              Back to List
            </Button>

            {job.status === 'complete' ? (
              <Button variant="outlined" color="warning" onClick={handleReopenJob}>
                Reopen Job
              </Button>
            ) : (
              <Button variant="outlined" color="success" onClick={handleCompleteJob}>
                Complete Job
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* IMAGE DIALOG */}
      <Dialog
        open={imageDialogOpen}
        onClose={() => setImageDialogOpen(false)}
        maxWidth="lg"
        PaperProps={{
          sx: {
            backgroundColor: 'transparent',
            boxShadow: 'none',
            overflow: 'hidden'
          }
        }}
      >
        <DialogContent
          sx={{
            p: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'transparent'
          }}
        >
          <img
            src={dialogImageSrc}
            alt="popup"
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              objectFit: 'contain',
              background: 'none'
            }}
          />
        </DialogContent>
      </Dialog>

      {/* RESEND CONFIRMATION */}
      <Dialog open={resendOpen} onClose={() => !resending && setResendOpen(false)}>
        <DialogTitle>Resend completion email?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setResendOpen(false)} disabled={resending}>Cancel</Button>
          <Button onClick={doResend} disabled={resending} variant="contained">
            {resending ? 'Sending…' : 'Resend'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* SNACKBAR */}
      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnack(s => ({ ...s, open: false }))}
          severity={snack.severity}
          sx={{ width: '100%' }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
