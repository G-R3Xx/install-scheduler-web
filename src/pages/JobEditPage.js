// src/pages/JobEditPage.js
import React, { useEffect, useState } from 'react';
import {
  Box, Button, Divider, Paper, TextField, Typography, Stack,
  Chip
} from '@mui/material';
import { useParams, useHistory } from 'react-router-dom';
import {
  doc, getDoc, updateDoc, collection, getDocs, serverTimestamp
} from 'firebase/firestore';
import { db, storage } from '../firebase/firebase';
import { getDownloadURL, ref, uploadBytes, deleteObject } from 'firebase/storage';
import { useAuth } from '../contexts/AuthContext';

export default function JobEditPage() {
  const { jobId } = useParams();
  const history = useHistory();
  const { currentUser } = useAuth();

  const [job, setJob] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'jobs', jobId));
        if (snap.exists()) setJob({ id: snap.id, ...snap.data() });
        const usersSnap = await getDocs(collection(db, 'users'));
        setAllUsers(usersSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
      } catch (e) {
        console.error(e);
      }
    })();
  }, [jobId]);

  const handleChange = (key, val) => setJob((j) => ({ ...j, [key]: val }));

  const handleLogoUpload = async (file) => {
    if (!file) return;
    try {
      const fileRef = ref(storage, `logos/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      setJob((j) => ({ ...j, companyLogoUrl: url }));
    } catch (err) {
      console.error('Logo upload failed', err);
    }
  };

  const toggleAssignee = (uid) => {
    setJob((j) => {
      const exists = j.assignedTo?.some((u) => (u.id || u) === uid);
      return {
        ...j,
        assignedTo: exists
          ? j.assignedTo.filter((u) => (u.id || u) !== uid)
          : [...(j.assignedTo || []), { id: uid }],
      };
    });
  };

  const handleSave = async () => {
    if (!job) return;
    try {
      setSaving(true);
      await updateDoc(doc(db, 'jobs', jobId), {
        clientName: job.clientName || '',
        company: job.company || '',
        contact: job.contact || '',
        phone: job.phone || '',
        email: job.email || '',
        address: job.address || '',
        description: job.description || '',
        status: job.status || 'in progress',
        installDate: job.installDate || null,
        installTime: job.installTime || null,
        assignedTo: job.assignedTo?.map((u) => u.id || u) || [],
        companyLogoUrl: job.companyLogoUrl || null,
        updatedAt: serverTimestamp(),
      });
      history.push(`/jobs/${jobId}`);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Failed to save job.');
    } finally {
      setSaving(false);
    }
  };

  if (!job) return <Box p={3}><Typography>Loading…</Typography></Box>;

  const isSurvey = String(job?.jobType || '').toLowerCase() === 'survey';

  return (
    <Box sx={{ p: 2, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Edit — {isSurvey ? 'Survey' : 'Job'}
      </Typography>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <TextField
            label="Client / Job Name"
            value={job.clientName || ''}
            onChange={(e) => handleChange('clientName', e.target.value)}
          />
          <TextField
            label="Company"
            value={job.company || ''}
            onChange={(e) => handleChange('company', e.target.value)}
          />
          <TextField
            label="Contact"
            value={job.contact || ''}
            onChange={(e) => handleChange('contact', e.target.value)}
          />
          <TextField
            label="Email"
            value={job.email || ''}
            onChange={(e) => handleChange('email', e.target.value)}
          />
          <TextField
            label="Phone"
            value={job.phone || ''}
            onChange={(e) => handleChange('phone', e.target.value)}
          />
          <TextField
            label="Address"
            value={job.address || ''}
            onChange={(e) => handleChange('address', e.target.value)}
          />
          <TextField
            label="Description"
            value={job.description || ''}
            onChange={(e) => handleChange('description', e.target.value)}
            multiline
            minRows={2}
          />

          {/* Logo upload */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Company Logo</Typography>
            <Button variant="outlined" component="label">
              Upload Logo
              <input hidden type="file" accept="image/*" onChange={(e) => handleLogoUpload(e.target.files?.[0])} />
            </Button>
            {job.companyLogoUrl && (
              <Box sx={{ mt: 1 }}>
                <img src={job.companyLogoUrl} alt="logo" style={{ maxHeight: 60, maxWidth: 120, objectFit: 'contain' }} />
              </Box>
            )}
          </Box>

          {/* Jobs have scheduling + assignment */}
          {!isSurvey && (
            <>
              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>Scheduled date</Typography>
                <TextField
                  type="date"
                  value={
                    job.installDate?.toDate?.()
                      ? job.installDate.toDate().toISOString().slice(0, 10)
                      : ''
                  }
                  onChange={(e) =>
                    handleChange('installDate', e.target.value ? new Date(e.target.value) : null)
                  }
                  InputLabelProps={{ shrink: true }}
                />
              </Box>

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>Scheduled time (optional)</Typography>
                <TextField
                  type="time"
                  value={job.installTime || ''}
                  onChange={(e) => handleChange('installTime', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Box>

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>Assign to</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {allUsers.map((u) => {
                    const selected = job.assignedTo?.some((x) => (x.id || x) === u.id);
                    return (
                      <Button
                        key={u.id}
                        variant={selected ? 'contained' : 'outlined'}
                        size="small"
                        onClick={() => toggleAssignee(u.id)}
                      >
                        {u.shortName || u.displayName || 'User'}
                      </Button>
                    );
                  })}
                </Box>
              </Box>
            </>
          )}

          {error && <Typography color="error">{error}</Typography>}

          <Divider />

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button disabled={saving} variant="contained" onClick={handleSave}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="outlined" onClick={() => history.goBack()}>
              Cancel
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
