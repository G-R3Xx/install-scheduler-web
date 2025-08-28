// src/pages/OhsFormPage.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Button,
  Paper,
  Divider,
  Alert
} from '@mui/material';
import { useParams, useHistory, Link } from 'react-router-dom';
import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useAuth } from '../contexts/AuthContext';

const COMPLETED_FLAG_HOURS = 24; // informational, actual expiry is evaluated in the prompt

export default function OhsFormPage() {
  const { jobId } = useParams();
  const history = useHistory();
  const { currentUser } = useAuth();

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Basic fields — tweak to suit your compliance checklist
  const [siteInduction, setSiteInduction] = useState(false);
  const [ppeHiVis, setPpeHiVis] = useState(false);
  const [ppeEye, setPpeEye] = useState(false);
  const [ppeHearing, setPpeHearing] = useState(false);
  const [riskWorkingAtHeights, setRiskWorkingAtHeights] = useState(false);
  const [riskElectrical, setRiskElectrical] = useState(false);
  const [riskPublicTraffic, setRiskPublicTraffic] = useState(false);
  const [controlsNotes, setControlsNotes] = useState('');
  const [siteContact, setSiteContact] = useState('');
  const [emergencyInfo, setEmergencyInfo] = useState('');

  const completedKey = useMemo(() => `ohsCompleted_${jobId}`, [jobId]);

  useEffect(() => {
    let isMounted = true;
    async function loadJob() {
      try {
        setError('');
        if (!jobId) return;
        const jobRef = doc(db, 'jobs', jobId);
        const snap = await getDoc(jobRef);
        if (snap.exists()) {
          if (isMounted) setJob({ id: snap.id, ...snap.data() });
        } else {
          if (isMounted) setError('Job not found.');
        }
      } catch (e) {
        if (isMounted) setError(e.message || 'Failed to load job.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadJob();
    return () => { isMounted = false; };
  }, [jobId]);

  const canSubmit = useMemo(() => !!jobId && !!currentUser, [jobId, currentUser]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      setSaving(true);
      setError('');

      const payload = {
        jobId,
        completedBy: currentUser.uid,
        completedByEmail: currentUser.email || null,
        completedAt: serverTimestamp(),
        siteInduction,
        ppe: {
          hiVis: ppeHiVis,
          eyeProtection: ppeEye,
          hearingProtection: ppeHearing
        },
        risks: {
          workingAtHeights: riskWorkingAtHeights,
          electrical: riskElectrical,
          publicTraffic: riskPublicTraffic
        },
        controlsNotes,
        siteContact,
        emergencyInfo,
      };

      // 1) Save the OHS form under the job
      const formsRef = collection(db, 'jobs', jobId, 'ohsForms');
      const formRef = await addDoc(formsRef, payload);

      // 2) Stamp the parent job for instant indicators
      const jobRef = doc(db, 'jobs', jobId);
      await updateDoc(jobRef, {
        ohsCompleted: true,                 // ✅ boolean flag
        ohsCompletedAt: serverTimestamp(),  // ✅ timestamp for display/sorting
        ohsLastBy: currentUser.uid,
        ohsLastByEmail: currentUser.email || null,
        ohsLastFormId: formRef.id
      });

      // 3) Mark completion locally to avoid re-prompt + redirect back cleanly
      localStorage.setItem(completedKey, String(Date.now()));
      history.replace(`/jobs/${jobId}?ohs=completed`);
    } catch (e) {
      setError(e.message || 'Failed to save OHS form.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body1">Loading…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, margin: '0 auto' }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Job OHS Form
      </Typography>
      {job && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Job: <strong>{job.client || job.clientName || 'Untitled'}</strong>
          {job.address ? ` — ${job.address}` : ''}
          {' · '}
          <Link to={`/jobs/${jobId}`}>Back to Job</Link>
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <form onSubmit={handleSubmit}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>Site Induction</Typography>
          <FormGroup sx={{ mb: 2 }}>
            <FormControlLabel
              control={<Checkbox checked={siteInduction} onChange={(e) => setSiteInduction(e.target.checked)} />}
              label="Site induction completed / reviewed"
            />
          </FormGroup>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle1" sx={{ mb: 1 }}>PPE Checklist</Typography>
          <FormGroup sx={{ mb: 2 }}>
            <FormControlLabel control={<Checkbox checked={ppeHiVis} onChange={(e) => setPpeHiVis(e.target.checked)} />} label="Hi-Vis" />
            <FormControlLabel control={<Checkbox checked={ppeEye} onChange={(e) => setPpeEye(e.target.checked)} />} label="Eye protection" />
            <FormControlLabel control={<Checkbox checked={ppeHearing} onChange={(e) => setPpeHearing(e.target.checked)} />} label="Hearing protection" />
          </FormGroup>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle1" sx={{ mb: 1 }}>Key Risks</Typography>
          <FormGroup sx={{ mb: 2 }}>
            <FormControlLabel control={<Checkbox checked={riskWorkingAtHeights} onChange={(e) => setRiskWorkingAtHeights(e.target.checked)} />} label="Working at heights" />
            <FormControlLabel control={<Checkbox checked={riskElectrical} onChange={(e) => setRiskElectrical(e.target.checked)} />} label="Electrical hazards" />
            <FormControlLabel control={<Checkbox checked={riskPublicTraffic} onChange={(e) => setRiskPublicTraffic(e.target.checked)} />} label="Public / traffic interface" />
          </FormGroup>

          <TextField
            label="Controls / Notes"
            value={controlsNotes}
            onChange={(e) => setControlsNotes(e.target.value)}
            fullWidth
            multiline
            minRows={3}
            sx={{ mb: 2 }}
          />

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle1" sx={{ mb: 1 }}>Contacts & Emergency</Typography>

          <TextField
            label="Site contact (name & phone)"
            value={siteContact}
            onChange={(e) => setSiteContact(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
          />
          <TextField
            label="Emergency info (nearest hospital / address / notes)"
            value={emergencyInfo}
            onChange={(e) => setEmergencyInfo(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />

          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button
              type="button"
              variant="text"
              onClick={() => history.goBack()}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={!canSubmit || saving}
            >
              {saving ? 'Saving…' : 'Save OHS Form'}
            </Button>
          </Box>
        </form>
      </Paper>
    </Box>
  );
}
