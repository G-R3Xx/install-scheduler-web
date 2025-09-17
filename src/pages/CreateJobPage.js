// src/pages/CreateJobPage.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Divider, Paper, TextField, Typography, Stack
} from '@mui/material';
import { useHistory } from 'react-router-dom';
import {
  addDoc, collection, getDocs, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useAuth } from '../contexts/AuthContext';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export default function CreateJobPage() {
  const history = useHistory();
  const { currentUser } = useAuth();
  const storage = getStorage();

  const [form, setForm] = useState({
    type: 'job',
    clientName: '', company: '', contact: '', phone: '', email: '', address: '',
    description: '', installDate: null, installTime: '', assignedTo: [], companyLogoUrl: null,
  });
  const [allUsers, setAllUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
        setAllUsers(arr);
      } catch {}
    })();
  }, []);

  const canSave = useMemo(
    () => form.clientName.trim() && (form.email.trim() || form.phone.trim()) && !!form.installDate,
    [form]
  );

  const toggleAssignee = (uid) => {
    setForm((f) => {
      const exists = f.assignedTo.some((u) => (u.id || u) === uid);
      return {
        ...f,
        assignedTo: exists
          ? f.assignedTo.filter((u) => (u.id || u) !== uid)
          : [...f.assignedTo, { id: uid }],
      };
    });
  };

  const handleLogoUpload = async (file) => {
    if (!file) return;
    try {
      const storageRef = ref(storage, `logos/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setForm((f) => ({ ...f, companyLogoUrl: url }));
    } catch (err) {
      console.error('Logo upload failed', err);
    }
  };

  /**
   * Build Firestore Timestamp from installDate + installTime (in local time).
   */
  const buildInstallTimestamp = () => {
    if (!form.installDate) return null;

    // Clone date (local midnight)
    const base = new Date(
      form.installDate.getFullYear(),
      form.installDate.getMonth(),
      form.installDate.getDate()
    );

    // Apply time if present
    if (form.installTime) {
      const [h, m] = form.installTime.split(':').map(Number);
      base.setHours(h || 0, m || 0, 0, 0);
    }

    return Timestamp.fromDate(base);
  };

  const handleCreate = async () => {
    try {
      setSaving(true); setError('');

      const ts = buildInstallTimestamp();
      const jobType = form.type === 'survey' ? 'survey-request' : 'job';

      const docRef = await addDoc(collection(db, 'jobs'), {
        clientName: form.clientName || '', company: form.company || '', contact: form.contact || '',
        phone: form.phone || '', email: form.email || '', address: form.address || '',
        description: form.description || '',
        jobType,
        status: 'in progress',
        installDate: ts,
        installTime: form.installTime || null, // optional time stored separately
        assignedTo: form.assignedTo.map((u) => u.id || u),
        referencePhotos: [], plans: [],
        companyLogoUrl: form.companyLogoUrl || null,
        createdAt: serverTimestamp(), createdBy: currentUser?.uid || null,
      });

      if (jobType === 'survey-request') {
        const params = new URLSearchParams({ jobId: docRef.id });
        history.push(`/surveys/new?${params.toString()}`);
      } else {
        history.push('/'); // ✅ back to job list immediately
      }
    } catch (e) {
      setError(e.message || 'Failed to create job.');
    } finally {
      setSaving(false);
    }
  };

  // Helpers to render date/time inputs preserving local values
  const dateValue = form.installDate
    ? new Date(form.installDate.getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10)
    : '';

  return (
    <Box sx={{ p: 2, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Create — Job or Survey</Typography>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          {/* Type toggle */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Type</Typography>
            <div role="group" aria-label="type" style={{ display: 'flex', gap: 12 }}>
              <Button
                size="small"
                variant={form.type==='job'?'contained':'outlined'}
                onClick={()=>setForm(f=>({...f,type:'job'}))}
              >
                Job
              </Button>
              <Button
                size="small"
                variant={form.type==='survey'?'contained':'outlined'}
                onClick={()=>setForm(f=>({...f,type:'survey'}))}
              >
                Survey
              </Button>
            </div>
          </Box>

          <Divider />

          <TextField label="Client / Job Name" value={form.clientName} onChange={(e)=>setForm(f=>({...f,clientName:e.target.value}))}/>
          <TextField label="Company" value={form.company} onChange={(e)=>setForm(f=>({...f,company:e.target.value}))}/>
          <TextField label="Contact" value={form.contact} onChange={(e)=>setForm(f=>({...f,contact:e.target.value}))}/>
          <TextField label="Email" type="email" value={form.email} onChange={(e)=>setForm(f=>({...f,email:e.target.value}))}/>
          <TextField label="Phone" value={form.phone} onChange={(e)=>setForm(f=>({...f,phone:e.target.value}))}/>
          <TextField label="Address" value={form.address} onChange={(e)=>setForm(f=>({...f,address:e.target.value}))}/>
          <TextField label="Description" value={form.description} onChange={(e)=>setForm(f=>({...f,description:e.target.value}))} multiline minRows={2}/>

          {/* Logo upload */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Company Logo</Typography>
            <Button variant="outlined" component="label">
              Upload Logo
              <input hidden type="file" accept="image/*" onChange={(e)=>handleLogoUpload(e.target.files?.[0])}/>
            </Button>
            {form.companyLogoUrl && (
              <Box sx={{ mt: 1 }}>
                <img src={form.companyLogoUrl} alt="logo" style={{ maxHeight: 60, maxWidth: 120, objectFit: 'contain' }}/>
              </Box>
            )}
          </Box>

          {/* Date (required) */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Scheduled date</Typography>
            <TextField
              type="date"
              value={dateValue}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  installDate: e.target.value ? new Date(e.target.value) : null,
                }))
              }
              InputLabelProps={{ shrink: true }}
            />
          </Box>

          {/* Optional Time */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Scheduled time (optional)</Typography>
            <TextField
              type="time"
              value={form.installTime || ''}
              onChange={(e) => setForm((f) => ({ ...f, installTime: e.target.value }))}
              InputLabelProps={{ shrink: true }}
            />
          </Box>

          {/* Assign */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Assign to</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {allUsers.map((u) => {
                const selected = form.assignedTo.some((x) => (x.id || x) === u.id);
                return (
                  <Button key={u.id} variant={selected?'contained':'outlined'} size="small" onClick={()=>toggleAssignee(u.id)}>
                    {u.shortName || u.displayName || 'User'}
                  </Button>
                );
              })}
            </Box>
          </Box>

          {error && <Typography color="error">{error}</Typography>}

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button disabled={!canSave || saving} variant="contained" onClick={handleCreate}>
              {saving ? 'Saving…' : 'Create'}
            </Button>
            <Button variant="outlined" onClick={()=>history.goBack()}>Cancel</Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
