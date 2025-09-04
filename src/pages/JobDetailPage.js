// src/pages/JobDetailPage.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  DialogActions,
  Paper,
  IconButton,
  Tooltip,
  Backdrop,
  CircularProgress,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers';
import DeleteIcon from '@mui/icons-material/Delete';
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
  deleteField,
  deleteDoc,
  arrayRemove,
} from 'firebase/firestore';
import { db, storage } from '../firebase/firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import SignatureCanvas from 'react-signature-canvas';
import { useAuth } from '../contexts/AuthContext';
// import OhsPromptOnLoad from '../components/OhsPromptOnLoad';
import { jsPDF } from 'jspdf';
import { convertSurveyToJob } from '../services/surveyService';

const FUNCTIONS_BASE =
  process.env.REACT_APP_FUNCTIONS_BASE ||
  'https://us-central1-install-scheduler.cloudfunctions.net';

// ---------- helpers ----------
const getUserNameFromAny = (u, userMap) => {
  const id = typeof u === 'string' ? u : (u && (u.id || u.uid)) || '';
  const rec = id ? userMap?.[id] : null;
  return rec?.shortName || rec?.displayName || rec?.email || 'Unknown';
};

const fmtDateAU = (val) => {
  const d =
    val?.toDate?.() instanceof Date ? val.toDate() :
    (val instanceof Date ? val : null);
  return d ? d.toLocaleDateString('en-AU') : '';
};

// Inline busy overlay
function BusyOverlay({ open, text = "Working…" }) {
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

export default function JobDetailPage() {
  const { jobId } = useParams();
  const history = useHistory();
  const { currentUser, userMap } = useAuth();

  const [busy, setBusy] = useState(false);

  const [job, setJob] = useState(null);
  const [hours, setHours] = useState('');
  const [timeEntries, setTimeEntries] = useState([]);
  const [sigPad, setSigPad] = useState(null);
  const [signatureURL, setSignatureURL] = useState(null);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [dialogImageSrc, setDialogImageSrc] = useState('');
  const ENABLE_OHS = process.env.REACT_APP_ENABLE_OHS === '1';

  // resend email UX state
  const [resendOpen, setResendOpen] = useState(false);
  const [resending, setResending] = useState(false);
  const [snack, setSnack] = useState({ open: false, severity: 'success', msg: '' });

  // ---- Convert to Job dialog ----
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertDate, setConvertDate] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [assignSel, setAssignSel] = useState([]); // [{id,label}]

  // Installer notes (INSIDE the component)
  const [installerNotes, setInstallerNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const isSurvey = job?.jobType === 'survey';
  const statusLc = String(job?.status || '').toLowerCase();
  const isComplete = ['complete', 'completed', 'done'].includes(statusLc);

  // ---------- data fetch ----------
  const fetchJob = useCallback(async () => {
    const snap = await getDoc(doc(db, 'jobs', jobId));
    if (!snap.exists()) return;
    const data = snap.data() || {};

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

    if (Array.isArray(rawPlans)) {
      plansRich = rawPlans.map((p) => {
        if (typeof p === 'string') return { url: p };
        if (p && typeof p === 'object') {
          return {
            url: p.url || p.href || p.downloadURL || p.path || p.storagePath || '',
            name: p.name || p.title || '',
          };
        }
        return { url: '' };
      });
      plans = plansRich.map((p) => p.url).filter(Boolean);
    } else if (typeof rawPlans === 'string') {
      plans = [rawPlans];
      plansRich = [{ url: rawPlans }];
    }

    const normalized = {
      id: snap.id,
      ...data,
      referencePhotos: Array.isArray(data.referencePhotos) ? data.referencePhotos : [],
      completedPhotos: Array.isArray(data.completedPhotos) ? data.completedPhotos : [],
      plans,
      plansRich,
    };

    setJob(normalized);
    setSignatureURL(normalized.signatureURL || null);
    setInstallerNotes(normalized.installerNotes || '');
  }, [jobId]);

  const fetchHours = useCallback(async () => {
    const entriesSnap = await getDocs(collection(db, 'jobs', jobId, 'timeEntries'));
    const entries = entriesSnap.docs.map((d) => d.data());
    setTimeEntries(entries);
  }, [jobId]);

  // Load assignable users (for Convert dialog)
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        setAllUsers(list);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const userOptions = useMemo(
    () => allUsers.map((u) => ({ id: u.id, label: u.shortName || u.displayName || u.email || u.id })),
    [allUsers]
  );

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
      timestamp: new Date(),
    });

    setHours('');
    fetchHours();
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setBusy(true);
    try {
      const newUrls = [];
      for (const file of files) {
        const fileRef = ref(storage, `jobs/${jobId}/photos/${file.name}`);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        newUrls.push(url);
      }

      setJob((prev) => ({
        ...prev,
        completedPhotos: [...(prev.completedPhotos || []), ...newUrls],
      }));

      await updateDoc(doc(db, 'jobs', jobId), {
        completedPhotos: [...(job?.completedPhotos || []), ...newUrls],
      });

      e.target.value = '';
    } finally {
      setBusy(false);
    }
  };

  // delete photo (works for referencePhotos & completedPhotos)
  const handleDeletePhoto = async (url, field = 'referencePhotos') => {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return;
    setBusy(true);
    try {
      try {
        const fileRef = ref(storage, url);
        await deleteObject(fileRef);
      } catch {
        /* non-storage or no perms */
      }

      const nextArr = (job?.[field] || []).filter((u) => u !== url);
      await updateDoc(doc(db, 'jobs', jobId), { [field]: nextArr });
      setJob((prev) => ({ ...prev, [field]: nextArr }));
    } catch (err) {
      console.error('Failed to delete photo', err);
      alert('Failed to delete photo.');
    } finally {
      setBusy(false);
    }
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
    history.push('/');
  };

  const handleReopenJob = async () => {
    await updateDoc(doc(db, 'jobs', jobId), { status: 'in progress' });
    await fetchJob();
  };

  const openImagePopup = (url) => {
    setDialogImageSrc(url);
    setImageDialogOpen(true);
  };

  const handleMarkOhsCompleted = async () => {
    await updateDoc(doc(db, 'jobs', jobId), {
      ohsCompleted: true,
      ohsCompletedAt: serverTimestamp(),
      ohsLastBy: currentUser.uid,
      ohsLastByEmail: currentUser.email || null,
    });
    await fetchJob();
  };

  const handleClearOhsStatus = async () => {
    await updateDoc(doc(db, 'jobs', jobId), {
      ohsCompleted: false,
      ohsCompletedAt: deleteField(),
      ohsLastBy: deleteField(),
      ohsLastByEmail: deleteField(),
      ohsLastFormId: deleteField(),
    });
    await fetchJob();
  };

  const handleDeleteJob = async () => {
    if (!window.confirm('Are you sure you want to permanently delete this job?')) return;
    try {
      await deleteDoc(doc(db, 'jobs', jobId));
      history.push('/'); // go back to list
    } catch (err) {
      console.error('Failed to delete job', err);
      alert('Failed to delete job.');
    }
  };

  const handleSaveInstallerNotes = async () => {
    try {
      setSavingNotes(true);
      await updateDoc(doc(db, 'jobs', jobId), { installerNotes });
      setSnack({ open: true, severity: 'success', msg: 'Notes saved.' });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, severity: 'error', msg: 'Failed to save notes.' });
    } finally {
      setSavingNotes(false);
    }
  };

  // (kept in case you use it from a button later)
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
        data?.completedAt?.toDate ? data.completedAt.toDate().toLocaleString() : 'N/A';

      const completedByShort =
        (data.completedBy && userMap?.[data.completedBy]?.shortName) ||
        data.completedByEmail ||
        data.completedBy ||
        'Unknown';

      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      let y = 40;
      const left = 40;

      const line = (label, value = '') => {
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${label}:`, left, y);
        pdf.setFont('helvetica', 'normal');
        pdf.text(String(value ?? ''), left + 160, y);
        y += 20;
      };

      pdf.setFontSize(16);
      pdf.text('Job OHS Form', left, y);
      y += 20;

      pdf.setFontSize(11);
      line('Job', job.clientName || job.client || 'Untitled');
      line('Address', job.address || '');
      line('Completed At', completedAt);
      line('Completed By', completedByShort);

      y += 10;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Site Induction', left, y);
      y += 20;
      line('Induction completed', data.siteInduction ? 'Yes' : 'No');

      y += 10;
      pdf.setFont('helvetica', 'bold');
      pdf.text('PPE Checklist', left, y);
      y += 20;
      line('Hi-Vis', data?.ppe?.hiVis ? 'Yes' : 'No');
      line('Eye protection', data?.ppe?.eyeProtection ? 'Yes' : 'No');
      line('Hearing protection', data?.ppe?.hearingProtection ? 'Yes' : 'No');

      y += 10;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Key Risks', left, y);
      y += 20;
      line('Working at heights', data?.risks?.workingAtHeights ? 'Yes' : 'No');
      line('Electrical', data?.risks?.electrical ? 'Yes' : 'No');
      line('Public/Traffic', data?.risks?.publicTraffic ? 'Yes' : 'No');

      y += 10;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Controls / Notes', left, y);
      y += 20;
      pdf.setFont('helvetica', 'normal');
      (data.controlsNotes || '')
        .toString()
        .split('\n')
        .forEach((row) => {
          pdf.text(row, left, y);
          y += 16;
        });

      y += 10;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Contacts & Emergency', left, y);
      y += 20;
      pdf.setFont('helvetica', 'normal');
      line('Site contact', data.siteContact || '');
      line('Emergency info', data.emergencyInfo || '');

      const fileName = `OHS_${(job.clientName || job.client || jobId)
        .toString()
        .replace(/\s+/g, '_')}.pdf`;
      pdf.save(fileName);
    } catch (err) {
      console.error(err);
      alert('Failed to generate OHS PDF.');
    }
  };

  const openPlan = async (planObjOrUrl) => {
    const candidate =
      typeof planObjOrUrl === 'string'
        ? planObjOrUrl
        : planObjOrUrl?.url ||
          planObjOrUrl?.href ||
          planObjOrUrl?.downloadURL ||
          planObjOrUrl?.path ||
          planObjOrUrl?.storagePath ||
          '';

    if (!candidate) return;

    if (/^https?:\/\//i.test(candidate)) {
      window.open(candidate, '_blank');
      return;
    }
    try {
      const storageRef = ref(storage, candidate);
      const dl = await getDownloadURL(storageRef);
      window.open(dl, '_blank');
    } catch (err) {
      console.error('Failed to open plan', err);
      alert('Could not open plan file.');
    }
  };

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

  // >>> ADDED: Convert Survey -> Job <<<
  const doConvert = async () => {
    setBusy(true);
    try {
      // Handle MUI DatePicker values (Dayjs/Date/null)
      const dateValue =
        convertDate?.toDate?.() instanceof Date
          ? convertDate.toDate()
          : convertDate instanceof Date
          ? convertDate
          : null;

      const assignedIds = Array.isArray(assignSel) ? assignSel.map((v) => v.id) : [];
      await convertSurveyToJob(jobId, {
        installDate: dateValue || null,
        assignedTo: assignedIds,
        keepExistingDescription: true,
      });
      setConvertOpen(false);
      await fetchJob();
      setSnack({ open: true, severity: 'success', msg: 'Converted to job.' });
    } catch (e) {
      console.error(e);
      alert(e?.message || 'Failed to convert survey.');
    } finally {
      setBusy(false);
    }
  };

  // Sum hours per user and sort by largest first
  const hoursByUser = useMemo(() => {
    const map = {};
    for (const e of timeEntries) {
      const uid = e.userId || 'unknown';
      map[uid] = (map[uid] || 0) + (Number(e.hours) || 0);
    }
    return map;
  }, [timeEntries]);

  const hoursByUserList = useMemo(
    () =>
      Object.entries(hoursByUser)
        .map(([uid, hrs]) => ({ uid, hrs: Math.round(hrs * 10) / 10 }))
        .sort((a, b) => b.hrs - a.hrs),
    [hoursByUser]
  );

  if (!job) return <Box p={3}><Typography>Loading…</Typography></Box>;

  // normalize assignedTo to a clean array of string IDs for rendering
  const assignedIds = Array.isArray(job?.assignedTo)
    ? job.assignedTo
        .map((u) => (typeof u === 'string' ? u : u?.id || u?.uid || ''))
        .filter(Boolean)
    : [];

  const installDateStr = fmtDateAU(job.installDate);
  const jobTotal = timeEntries.reduce((s, e) => s + (e.hours || 0), 0);

  return (
    <Box p={3}>
      {/* Only prompt OHS for real jobs, not surveys */}
      {!isSurvey && ENABLE_OHS && /* OHS disabled */ null}

      <Card>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            {isSurvey ? 'Survey Details' : 'Job Details'}
          </Typography>

          {/* Survey banner */}
          {isSurvey && (
            <Paper
              elevation={0}
              sx={{
                p: 2,
                mb: 2,
                borderRadius: 2,
                bgcolor: 'rgba(25,118,210,0.08)',
                border: '1px solid rgba(25,118,210,0.35)',
              }}
            >
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                This is a <strong>Survey</strong>. It isn’t scheduled or trackable until converted to a job.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button variant="contained" onClick={() => setConvertOpen(true)}>
                  Convert to Job
                </Button>
                <Button variant="outlined" onClick={() => history.push('/')}>
                  Back to List
                </Button>
              </Box>
            </Paper>
          )}

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

          {/* JOB / SURVEY INFO */}
          <Box mt={3}>
            <Typography variant="h6">{isSurvey ? 'Survey Info' : 'Job Info'}</Typography>
            <Divider sx={{ mb: 1 }} />

            {job.description ? (
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                <strong>Description:</strong> {job.description}
              </Typography>
            ) : (
              <Typography><strong>Description:</strong> —</Typography>
            )}

            {Array.isArray(job.surveyNotes) && job.surveyNotes.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography sx={{ mb: 0.5 }}><strong>Survey notes:</strong></Typography>
                <ul style={{ marginTop: 0 }}>
                  {job.surveyNotes.map((n, i) => (
                    <li key={i} style={{ lineHeight: 1.5 }}>{n}</li>
                  ))}
                </ul>
              </Box>
            )}

            <Typography><strong>Status:</strong> {job.status}</Typography>

            {!isSurvey && (
              <>
                <Typography><strong>Install Date:</strong> {installDateStr}</Typography>
                <Typography sx={{ mt: 1 }}><strong>Assigned To:</strong></Typography>
                <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
                  {assignedIds.length
                    ? assignedIds.map((uid) => <Chip key={uid} label={getUserNameFromAny(uid, userMap)} />)
                    : <Chip label="Unassigned" />}
                </Box>
              </>
            )}
          </Box>

          {/* SURVEY SIGNS */}
          {isSurvey && (
            <Box mt={3}>
              <Typography variant="h6">Survey Signs</Typography>
              <Divider sx={{ mb: 1 }} />
              {(!job.signs || job.signs.length === 0) && (
                <Typography color="text.secondary">No signs captured.</Typography>
              )}
              <Grid container spacing={2} mt={0.5}>
                {(job.signs || []).map((s, idx) => (
                  <Grid item key={s.id || idx} xs={12} md={6}>
                    <Paper sx={{ p: 1.5, borderRadius: 2 }}>
                      <Typography variant="subtitle1" sx={{ mb: 1 }}>
                        {s.name || `Sign ${idx + 1}`}
                      </Typography>
                      {s.annotatedImageUrl || s.originalImageUrl ? (
                        <img
                          src={s.annotatedImageUrl || s.originalImageUrl}
                          alt={s.name || `sign-${idx + 1}`}
                          style={{ width: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 6, cursor: 'pointer', background: '#fff' }}
                          onClick={() => openImagePopup(s.annotatedImageUrl || s.originalImageUrl)}
                        />
                      ) : (
                        <Typography color="text.secondary">No image</Typography>
                      )}
                      {s.description && (
                        <Typography variant="body2" sx={{ mt: 1.0, whiteSpace: 'pre-wrap' }}>
                          {s.description}
                        </Typography>
                      )}
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {/* REFERENCE PHOTOS (surveys) */}
          {isSurvey && (
            <Box mt={3}>
              <Typography variant="h6">Reference Photos</Typography>
              <Divider sx={{ mb: 1 }} />
              {(!job.referencePhotos || job.referencePhotos.length === 0) ? (
                <Typography color="text.secondary">No reference photos.</Typography>
              ) : (
                <Grid container spacing={1} mt={0.5}>
                  {job.referencePhotos.map((url, idx) => (
                    <Grid item key={idx} sx={{ position: 'relative' }}>
                      <img
                        src={url}
                        alt={`ref-${idx}`}
                        style={{ width: 110, height: 110, objectFit: 'cover', cursor: 'pointer', borderRadius: 4, background: '#fff' }}
                        onClick={() => openImagePopup(url)}
                      />
                      <Tooltip title="Delete photo">
                        <IconButton
                          size="small"
                          sx={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            bgcolor: 'rgba(0,0,0,0.5)',
                            color: '#fff',
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                          }}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!window.confirm('Delete this photo?')) return;
                            try {
                              const refPath = url.split('/o/')[1]?.split('?')[0];
                              if (refPath) {
                                const storageRef = ref(storage, decodeURIComponent(refPath));
                                await deleteObject(storageRef).catch(() => {});
                              }
                              await updateDoc(doc(db, 'jobs', jobId), { referencePhotos: arrayRemove(url) });
                              setJob((prev) => ({
                                ...prev,
                                referencePhotos: prev.referencePhotos.filter((u) => u !== url),
                              }));
                            } catch (err) {
                              console.error('Failed to delete reference photo', err);
                              alert('Could not delete photo.');
                            }
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Grid>
                  ))}
                </Grid>
              )}
            </Box>
          )}

          {/* PLANS (PDF) */}
          {!isSurvey && (
            <Box mt={3}>
              <Typography variant="h6">Plans (PDF)</Typography>
              <Divider sx={{ mb: 1 }} />
              {(!job.plans || job.plans.length === 0) && (
                <Typography color="text.secondary">No plans uploaded.</Typography>
              )}
              <Box display="flex" flexDirection="column" gap={1} mt={1}>
                {(job.plansRich && job.plansRich.length ? job.plansRich : (job.plans || []).map((u) => ({ url: u }))).map((p, idx) => {
                  const url = p.url || '';
                  const label =
                    p.name ||
                    p.title ||
                    (() => {
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
          )}

          {/* REFERENCE / COMPLETED PHOTOS (jobs) */}
          {!isSurvey && (
            <>
              <Box mt={3}>
                <Typography variant="h6">Reference Photos</Typography>
                <Divider sx={{ mb: 1 }} />
                {(!job.referencePhotos || job.referencePhotos.length === 0) && (
                  <Typography color="text.secondary">No reference photos.</Typography>
                )}
                <Grid container spacing={1}>
                  {(job.referencePhotos || []).map((url, idx) => (
                    <Grid item key={idx}>
                      <Box
                        sx={{
                          position: 'relative',
                          width: 100,
                          height: 100,
                          borderRadius: 1,
                          overflow: 'hidden',
                          background: '#fff',
                          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                          cursor: 'pointer',
                        }}
                        onClick={() => openImagePopup(url)}
                      >
                        <img
                          src={url}
                          alt={`ref-${idx}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        <Button
                          size="small"
                          variant="contained"
                          color="error"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePhoto(url, 'referencePhotos');
                          }}
                          sx={{
                            minWidth: 0,
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            px: 0.5,
                            py: 0.1,
                            fontSize: 10,
                            lineHeight: 1.2,
                            borderRadius: 1,
                          }}
                        >
                          Delete
                        </Button>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Box>

              <Box mt={3}>
                <Typography variant="h6">Completed Photos</Typography>
                <Divider sx={{ mb: 1 }} />
                <Button variant="outlined" component="label" sx={{ mt: 1 }}>
                  Upload Photos
                  <input type="file" hidden accept="image/*" multiple onChange={handlePhotoUpload} />
                </Button>
                {(!job.completedPhotos || job.completedPhotos.length === 0) && (
                  <Typography color="text.secondary" mt={1}>
                    No completed photos yet.
                  </Typography>
                )}
                <Grid container spacing={1} mt={1}>
                  {(job.completedPhotos || []).map((url, idx) => (
                    <Grid item key={idx}>
                      <Box
                        sx={{
                          position: 'relative',
                          width: 100,
                          height: 100,
                          borderRadius: 1,
                          overflow: 'hidden',
                          background: '#fff',
                          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                          cursor: 'pointer',
                        }}
                        onClick={() => openImagePopup(url)}
                      >
                        <img
                          src={url}
                          alt={`completed-${idx}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        <Button
                          size="small"
                          variant="contained"
                          color="error"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePhoto(url, 'completedPhotos');
                          }}
                          sx={{
                            minWidth: 0,
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            px: 0.5,
                            py: 0.1,
                            fontSize: 10,
                            lineHeight: 1.2,
                            borderRadius: 1,
                          }}
                        >
                          Delete
                        </Button>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            </>
          )}

          {/* Installer Notes */}
          {!isSurvey && (
            <Box mt={3}>
              <Typography variant="h6">Installer Notes</Typography>
              <Divider sx={{ mb: 1 }} />
              <TextField
                label='Notes: Any issues? What fixings and/or extra media/substrates were used?'
                placeholder='E.g., Needed extra tek screws for panel 3; used ACM backing; minor wall bowing on north face...'
                value={installerNotes}
                onChange={(e) => setInstallerNotes(e.target.value)}
                multiline
                minRows={3}
                fullWidth
              />
              <Box sx={{ mt: 1.5 }}>
                <Button
                  variant="outlined"
                  onClick={handleSaveInstallerNotes}
                  disabled={savingNotes}
                >
                  {savingNotes ? 'Saving…' : 'Save Notes'}
                </Button>
              </Box>
            </Box>
          )}

          {/* SIGNATURE (jobs only) */}
          {!isSurvey && (
            <Box mt={3}>
              <Typography variant="h6">Client Signature</Typography>
              <Divider sx={{ mb: 1 }} />
              {signatureURL ? (
                <img
                  src={signatureURL}
                  alt="signature"
                  style={{ border: '1px solid #ccc', height: 120, borderRadius: 4, background: '#fff' }}
                />
              ) : (
                <>
                  <Box
                    sx={{
                      border: '1px solid #ccc',
                      width: 320,
                      height: 140,
                      mb: 1,
                      borderRadius: 1,
                      background: '#fff',
                    }}
                  >
                    <SignatureCanvas
                      penColor="black"
                      canvasProps={{ width: 320, height: 140, style: { display: 'block' } }}
                      ref={(ref) => setSigPad(ref)}
                    />
                  </Box>
                  <Button variant="outlined" onClick={handleSaveSignature}>
                    Save Signature
                  </Button>
                </>
              )}
            </Box>
          )}

          {/* TIME TRACKING (jobs only) */}
          {!isSurvey && (
            <Box mt={3}>
              <Typography variant="h6">Time Tracking</Typography>
              <Divider sx={{ mb: 1 }} />
              <Typography>
                <strong>Job total:</strong> {jobTotal} hrs
              </Typography>

              {hoursByUserList.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography sx={{ fontWeight: 600, mb: 0.5 }}>By user:</Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {hoursByUserList.map(({ uid, hrs }) => (
                      <Chip key={uid} label={`${getUserNameFromAny(uid, userMap)}: ${hrs} hrs`} />
                    ))}
                  </Box>
                </Box>
              )}

              <Box mt={2} display="flex" alignItems="center" gap={2}>
                <TextField
                  label="Add Hours"
                  type="number"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  sx={{ width: 160 }}
                />
                <Button variant="outlined" onClick={handleAddHours}>
                  Submit
                </Button>
              </Box>
            </Box>
          )}

          {/* ACTIONS */}
          <Box mt={4} display="flex" gap={2} flexWrap="wrap">
            <Button
              variant="contained"
              onClick={() => history.push(`/jobs/${jobId}/edit`)}
              disabled={isSurvey}
              title={isSurvey ? 'Convert to job to edit install details' : undefined}
            >
              Edit Job
            </Button>

            <Button variant="outlined" color="error" onClick={handleDeleteJob}>
              Delete Job
            </Button>

            <Button variant="outlined" onClick={() => history.push('/')}>
              Back to List
            </Button>

            {!isSurvey && (
              isComplete ? (
                <Button variant="outlined" color="warning" onClick={handleReopenJob}>
                  Reopen Job
                </Button>
              ) : (
                <Button variant="outlined" color="success" onClick={handleCompleteJob}>
                  Complete Job
                </Button>
              )
            )}
          </Box>
        </CardContent>
      </Card>

      {/* IMAGE DIALOG */}
      <Dialog
        open={imageDialogOpen}
        onClose={() => setImageDialogOpen(false)}
        maxWidth="lg"
        PaperProps={{ sx: { backgroundColor: 'transparent', boxShadow: 'none', overflow: 'hidden' } }}
      >
        <DialogContent
          sx={{
            p: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'transparent',
          }}
        >
          <img
            src={dialogImageSrc}
            alt="popup"
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', background: 'none' }}
          />
        </DialogContent>
      </Dialog>

      {/* CONVERT TO JOB DIALOG */}
      <Dialog open={convertOpen} onClose={() => setConvertOpen(false)}>
        <DialogTitle>Convert Survey to Job</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Box sx={{ display: 'grid', gap: 2, mt: 1, width: 420, maxWidth: '90vw' }}>
            <DatePicker
              label="Install Date (optional)"
              value={convertDate}
              onChange={(v) => setConvertDate(v)}
              slotProps={{ textField: { fullWidth: true } }}
            />
            <TextField
              select
              SelectProps={{ multiple: true, native: true }}
              label="Assign Users (optional)"
              value={assignSel.map((v) => v.id)}
              onChange={(e) => {
                const ids = Array.from(e.target.selectedOptions).map((o) => o.value);
                const selected = userOptions.filter((u) => ids.includes(u.id));
                setAssignSel(selected);
              }}
              fullWidth
            >
              {userOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConvertOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={doConvert}>
            Convert
          </Button>
        </DialogActions>
      </Dialog>

      {/* RESEND CONFIRMATION */}
      <Dialog open={resendOpen} onClose={() => setResendOpen(false)}>
        <DialogTitle>Resend completion email?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setResendOpen(false)} disabled={resending}>
            Cancel
          </Button>
          <Button onClick={doResend} disabled={resending} variant="contained">
            {resending ? 'Sending…' : 'Resend'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* SNACKBAR */}
      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnack((s) => ({ ...s, open: false }))} severity={snack.severity} sx={{ width: '100%' }}>
          {snack.msg}
        </Alert>
      </Snackbar>

      {/* Busy overlay */}
      <BusyOverlay open={busy} text="Uploading files… please don't close this window" />
    </Box>
  );
}
