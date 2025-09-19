// src/pages/CreateJobPage.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Divider, Paper, TextField, Typography, Stack, IconButton, Tooltip,
} from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';
import DeleteIcon from '@mui/icons-material/Delete';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useHistory } from 'react-router-dom';
import {
  addDoc, collection, getDocs, serverTimestamp, Timestamp,
  doc, addDoc as addDocToSub, // alias just for clarity below
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useAuth } from '../contexts/AuthContext';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

export default function CreateJobPage() {
  const history = useHistory();
  const { currentUser } = useAuth();
  const storage = getStorage();

  const [form, setForm] = useState({
    type: 'job', // 'job' | 'survey-request'
    clientName: '', company: '', contact: '', phone: '', email: '', address: '',
    description: '', installDate: null, installTime: '', assignedTo: [], companyLogoUrl: null,
    estimatedHours: '', // optional numeric input
  });
  const [allUsers, setAllUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Local uploads (only for jobs; survey-requests won’t use these but we still allow)
  const [planFiles, setPlanFiles] = useState([]);           // File[]
  const [refPhotos, setRefPhotos] = useState([]);           // [{id, file, url}]
  const [logoPreview, setLogoPreview] = useState(null);

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
      setLogoPreview(URL.createObjectURL(file));
      const ref = storageRef(storage, `logos/${Date.now()}_${file.name}`);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      setForm((f) => ({ ...f, companyLogoUrl: url }));
    } catch (err) {
      console.error('Logo upload failed', err);
      alert('Upload failed. Please try a different image.');
    }
  };

  const addPlanFiles = (files) => {
    const arr = Array.from(files || []);
    setPlanFiles((prev) => [...prev, ...arr]);
  };
  const removePlanFile = (idx) => {
    setPlanFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const addRefPhotos = (files) => {
    const arr = Array.from(files || []).map((f) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file: f,
      url: URL.createObjectURL(f),
    }));
    setRefPhotos((prev) => [...prev, ...arr]);
  };
  const removeRefPhoto = (id) => {
    setRefPhotos((prev) => {
      const tgt = prev.find((p) => p.id === id);
      if (tgt?.url?.startsWith('blob:')) URL.revokeObjectURL(tgt.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  const buildInstallTimestamp = () => {
    if (!form.installDate) return null;
    // clone date-only (local) and optionally apply time
    const base = new Date(form.installDate);
    if (form.installTime) {
      const [h, m] = form.installTime.split(':').map(Number);
      base.setHours(h || 0, m || 0, 0, 0);
    } else {
      base.setHours(0, 0, 0, 0);
    }
    return Timestamp.fromDate(base);
  };

  const handleCreate = async () => {
    try {
      setSaving(true); setError('');

      const ts = buildInstallTimestamp();
      const jobType = form.type === 'survey-request' ? 'survey-request' : 'job';

      // 1) Create the job doc
      const jobDocRef = await addDoc(collection(db, 'jobs'), {
        clientName: form.clientName || '', company: form.company || '', contact: form.contact || '',
        phone: form.phone || '', email: form.email || '', address: form.address || '',
        description: form.description || '',
        jobType,
        status: 'in progress',
        installDate: ts,
        installTime: form.installTime || null, // optional time stored separately
        assignedTo: form.assignedTo.map((u) => u.id || u),
        companyLogoUrl: form.companyLogoUrl || null,
        estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : null,
        createdAt: serverTimestamp(), createdBy: currentUser?.uid || null,
      });

      // 2) Upload plans + create subcollection docs
      if (planFiles.length) {
        for (const f of planFiles) {
          const pRef = storageRef(storage, `jobs/${jobDocRef.id}/plans/${Date.now()}_${f.name}`);
          await uploadBytes(pRef, f);
          const url = await getDownloadURL(pRef);
          await addDocToSub(collection(db, 'jobs', jobDocRef.id, 'plans'), {
            url,
            name: f.name || 'Plan.pdf',
            createdAt: serverTimestamp(),
          });
        }
      }

      // 3) Upload reference photos + create subcollection docs
      if (refPhotos.length) {
        for (const p of refPhotos) {
          const rRef = storageRef(storage, `jobs/${jobDocRef.id}/reference/${Date.now()}_${p.file.name}`);
          await uploadBytes(rRef, p.file);
          const url = await getDownloadURL(rRef);
          await addDocToSub(collection(db, 'jobs', jobDocRef.id, 'referencePhotos'), {
            url,
            createdAt: serverTimestamp(),
          });
        }
      }

      // 4) Clean local blobs
      refPhotos.forEach((p) => { if (p.url?.startsWith('blob:')) URL.revokeObjectURL(p.url); });

      // 5) Done — go to Job List (as requested)
      history.push('/');
    } catch (e) {
      console.error(e);
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
    <Box sx={{ p: 2, maxWidth: 980, mx: 'auto' }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Create — Job or Survey Request</Typography>
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
                variant={form.type==='survey-request'?'contained':'outlined'}
                onClick={()=>setForm(f=>({...f,type:'survey-request'}))}
              >
                Survey Request
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
            <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
              Upload Logo
              <input hidden type="file" accept="image/*" onChange={(e)=>handleLogoUpload(e.target.files?.[0])}/>
            </Button>
            {(form.companyLogoUrl || logoPreview) && (
              <Box sx={{ mt: 1 }}>
                <img
                  src={form.companyLogoUrl || logoPreview}
                  alt="logo"
                  style={{ maxHeight: 60, maxWidth: 120, objectFit: 'contain', background: '#fff', borderRadius: 4 }}
                />
              </Box>
            )}
          </Box>

          {/* Date (required) + Optional Time */}
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

          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Scheduled time (optional)</Typography>
            <TextField
              type="time"
              value={form.installTime || ''}
              onChange={(e) => setForm((f) => ({ ...f, installTime: e.target.value }))}
              InputLabelProps={{ shrink: true }}
            />
          </Box>

          {/* Estimated/Allowed hours */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Allowed / Quoted hours (optional)</Typography>
            <TextField
              type="number"
              inputProps={{ step: '0.1', min: '0' }}
              placeholder="e.g. 6"
              value={form.estimatedHours}
              onChange={(e)=>setForm(f=>({...f, estimatedHours: e.target.value}))}
              sx={{ width: 180 }}
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

          {/* Files section (uploading here per your preference; saved to subcollections) */}
          <Divider />

          <Typography variant="h6">Plans (PDF)</Typography>
          <Box sx={{ display:'flex', gap:1, alignItems:'center', flexWrap:'wrap' }}>
            <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
              Add Plans
              <input hidden type="file" accept="application/pdf" multiple onChange={(e)=>addPlanFiles(e.target.files)} />
            </Button>
          </Box>
          <Box>
            {!planFiles.length && <Typography color="text.secondary">No plans selected.</Typography>}
            {planFiles.map((f, idx) => (
              <Box key={idx} sx={{ display:'flex', alignItems:'center', gap:1, py:0.5 }}>
                <PictureAsPdfIcon fontSize="small" />
                <Typography variant="body2">{f.name}</Typography>
                <IconButton size="small" onClick={()=>removePlanFile(idx)}><DeleteIcon fontSize="small"/></IconButton>
              </Box>
            ))}
          </Box>

          <Typography variant="h6" sx={{ mt: 1 }}>Reference Photos</Typography>
          <Box sx={{ display:'flex', gap:1, alignItems:'center', flexWrap:'wrap' }}>
            <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
              Add Photos
              <input hidden type="file" accept="image/*" multiple onChange={(e)=>addRefPhotos(e.target.files)} />
            </Button>
          </Box>
          <Box sx={{ display:'flex', gap:1, flexWrap:'wrap' }}>
            {!refPhotos.length && <Typography color="text.secondary">No reference photos selected.</Typography>}
            {refPhotos.map((p) => (
              <Box key={p.id} sx={{ display:'inline-flex', alignItems:'center', p:0.5, gap:0.5 }}>
                <img src={p.url} alt="ref" style={{ width:110, height:80, objectFit:'cover', borderRadius:4, background:'#fff' }}/>
                <Tooltip title="Remove photo">
                  <IconButton size="small" onClick={()=>removeRefPhoto(p.id)}><DeleteIcon fontSize="small"/></IconButton>
                </Tooltip>
              </Box>
            ))}
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
