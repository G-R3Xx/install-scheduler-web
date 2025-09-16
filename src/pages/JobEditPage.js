// src/pages/JobEditPage.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Divider, Paper, TextField, Typography, Stack, IconButton
} from '@mui/material';
import { useParams, useHistory } from 'react-router-dom';
import {
  collection, doc, getDoc, getDocs, serverTimestamp, Timestamp, updateDoc, addDoc, deleteDoc
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import DeleteIcon from '@mui/icons-material/Delete';
import UploadIcon from '@mui/icons-material/Upload';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';

export default function JobEditPage() {
  // Accept either /jobs/:id/edit or /jobs/:jobId/edit
  const { id: idParam, jobId: jobIdParam } = useParams();
  const id = idParam || jobIdParam;

  const history = useHistory();
  const storage = getStorage();

  const [form, setForm] = useState({
    clientName: '', company: '', contact: '', phone: '', email: '', address: '',
    description: '', installDate: null, installTime: '', assignedTo: [], companyLogoUrl: null,
  });

  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState([]);
  const [refPhotos, setRefPhotos] = useState([]);

  // Fetch job + related docs
  useEffect(() => {
    if (!id) return; // guard until we actually have an ID
    (async () => {
      // job
      const snap = await getDoc(doc(db, 'jobs', id));
      if (snap.exists()) {
        const d = snap.data();
        setForm({
          clientName: d.clientName || '',
          company: d.company || '',
          contact: d.contact || '',
          phone: d.phone || '',
          email: d.email || '',
          address: d.address || '',
          description: d.description || '',
          installDate: d.installDate?.toDate ? d.installDate.toDate() : d.installDate || null,
          installTime: d.installTime || '',
          assignedTo: Array.isArray(d.assignedTo) ? d.assignedTo : d.assignedTo ? [d.assignedTo] : [],
          companyLogoUrl: d.companyLogoUrl || null,
        });
      }

      // users
      const usersSnap = await getDocs(collection(db, 'users'));
      setUsers(usersSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));

      // plans
      const plansSnap = await getDocs(collection(db, 'jobs', id, 'plans'));
      setPlans(plansSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));

      // reference photos
      const refSnap = await getDocs(collection(db, 'jobs', id, 'referencePhotos'));
      setRefPhotos(refSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));
    })();
  }, [id]);

  const canSave = useMemo(
    () => form.clientName.trim() && (form.email.trim() || form.phone.trim()) && !!form.installDate,
    [form]
  );

  const toggleAssignee = (uid) => {
    setForm((f) => {
      const exists = f.assignedTo.some((u) => (u.id || u) === uid);
      return {
        ...f,
        assignedTo: exists ? f.assignedTo.filter((u) => (u.id || u) !== uid) : [...f.assignedTo, uid],
      };
    });
  };

  const handleLogoUpload = async (file) => {
    if (!file || !id) return;
    const r = ref(storage, `logos/${Date.now()}_${file.name}`);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    setForm((f) => ({ ...f, companyLogoUrl: url }));
  };

  const buildInstallTimestamp = () => {
    if (!form.installDate) return null;
    const base = new Date(form.installDate);
    if (form.installTime) {
      const [h, m] = form.installTime.split(':').map(Number);
      base.setHours(h || 0, m || 0, 0, 0);
    } else {
      base.setHours(0, 0, 0, 0);
    }
    return Timestamp.fromDate(base);
  };

  const save = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'jobs', id), {
        clientName: form.clientName, company: form.company, contact: form.contact,
        phone: form.phone, email: form.email, address: form.address, description: form.description,
        installDate: buildInstallTimestamp(),
        installTime: form.installTime || null,
        assignedTo: form.assignedTo.map((u) => (u.id || u)),
        companyLogoUrl: form.companyLogoUrl || null,
        updatedAt: serverTimestamp(),
      });
      history.push(`/jobs/${id}`);
    } finally {
      setSaving(false);
    }
  };

  /* --------- plans + reference photos management --------- */
  const uploadPlan = async (file) => {
    if (!file || !id) return;
    const r = ref(storage, `jobs/${id}/plans/${Date.now()}_${file.name}`);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    await addDoc(collection(db, 'jobs', id, 'plans'), { url, name: file.name, createdAt: serverTimestamp() });
    const plansSnap = await getDocs(collection(db, 'jobs', id, 'plans'));
    setPlans(plansSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));
  };

  const deletePlan = async (p) => {
    if (!id) return;
    try {
      try {
        const u = new URL(p.url);
        const path = decodeURIComponent(u.pathname.replace(/^\/v0\/b\/[^/]+\/o\//, ''));
        await deleteObject(ref(storage, path));
      } catch {}
      await deleteDoc(doc(db, 'jobs', id, 'plans', p.id));
      const plansSnap = await getDocs(collection(db, 'jobs', id, 'plans'));
      setPlans(plansSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));
    } catch {}
  };

  const uploadRefPhotos = async (files) => {
    if (!id) return;
    const arr = Array.from(files || []);
    for (const f of arr) {
      const r = ref(storage, `jobs/${id}/reference/${Date.now()}_${f.name}`);
      await uploadBytes(r, f);
      const url = await getDownloadURL(r);
      await addDoc(collection(db, 'jobs', id, 'referencePhotos'), { url, createdAt: serverTimestamp() });
    }
    const refSnap = await getDocs(collection(db, 'jobs', id, 'referencePhotos'));
    setRefPhotos(refSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));
  };

  const deleteRefPhoto = async (p) => {
    if (!id) return;
    try {
      try {
        const u = new URL(p.url);
        const path = decodeURIComponent(u.pathname.replace(/^\/v0\/b\/[^/]+\/o\//, ''));
        await deleteObject(ref(storage, path));
      } catch {}
      await deleteDoc(doc(db, 'jobs', id, 'referencePhotos', p.id));
      const refSnap = await getDocs(collection(db, 'jobs', id, 'referencePhotos'));
      setRefPhotos(refSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));
    } catch {}
  };

  // local date field value
  const dateValue = form.installDate
    ? new Date(form.installDate.getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10)
    : '';

  if (!id) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="error">No job ID in route. Make sure the path is either /jobs/:id/edit or /jobs/:jobId/edit.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Edit Job</Typography>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <TextField label="Client / Job Name" value={form.clientName} onChange={(e)=>setForm(f=>({...f,clientName:e.target.value}))}/>
          <TextField label="Company" value={form.company} onChange={(e)=>setForm(f=>({...f,company:e.target.value}))}/>
          <TextField label="Contact" value={form.contact} onChange={(e)=>setForm(f=>({...f,contact:e.target.value}))}/>
          <TextField label="Phone" value={form.phone} onChange={(e)=>setForm(f=>({...f,phone:e.target.value}))}/>
          <TextField label="Email" type="email" value={form.email} onChange={(e)=>setForm(f=>({...f,email:e.target.value}))}/>
          <TextField label="Address" value={form.address} onChange={(e)=>setForm(f=>({...f,address:e.target.value}))}/>
          <TextField label="Description" value={form.description} onChange={(e)=>setForm(f=>({...f,description:e.target.value}))} multiline minRows={2}/>

          {/* Logo */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Company Logo</Typography>
            <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
              Upload Logo
              <input hidden type="file" accept="image/*" onChange={(e)=>handleLogoUpload(e.target.files?.[0])}/>
            </Button>
            {form.companyLogoUrl && (
              <Box sx={{ mt: 1 }}>
                <img src={form.companyLogoUrl} alt="logo" style={{ maxHeight: 60, maxWidth: 120, objectFit: 'contain' }}/>
              </Box>
            )}
          </Box>

          {/* Date + Optional Time */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Scheduled date</Typography>
            <TextField
              type="date"
              value={dateValue}
              onChange={(e)=>setForm(f=>({...f, installDate: e.target.value ? new Date(e.target.value) : null}))}
              InputLabelProps={{ shrink: true }}
            />
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Scheduled time (optional)</Typography>
            <TextField
              type="time"
              value={form.installTime || ''}
              onChange={(e)=>setForm(f=>({...f, installTime: e.target.value}))}
              InputLabelProps={{ shrink: true }}
            />
          </Box>

          {/* Assign */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Assign to</Typography>
            <Box sx={{ display:'flex', flexWrap:'wrap', gap: 1 }}>
              {users.map(u => {
                const selected = form.assignedTo.some((x)=> (x.id || x) === u.id);
                return (
                  <Button key={u.id} variant={selected ? 'contained' : 'outlined'} size="small" onClick={()=>toggleAssignee(u.id)}>
                    {u.shortName || u.displayName || 'User'}
                  </Button>
                );
              })}
            </Box>
          </Box>

          <Divider />

          {/* Plans */}
          <Typography variant="h6">Plans (PDF)</Typography>
          <Box sx={{ display:'flex', gap:1, alignItems:'center', flexWrap:'wrap' }}>
            <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
              Upload Plan (PDF)
              <input hidden type="file" accept="application/pdf" onChange={(e)=>uploadPlan(e.target.files?.[0])}/>
            </Button>
          </Box>
          <Box>
            {plans.length === 0 && <Typography color="text.secondary">No plans uploaded.</Typography>}
            {plans.map(p => (
              <Box key={p.id} sx={{ display:'flex', alignItems:'center', gap:1, py:0.5 }}>
                <PictureAsPdfIcon fontSize="small" />
                <a href={p.url} target="_blank" rel="noreferrer">{p.name || 'Plan.pdf'}</a>
                <IconButton size="small" onClick={()=>deletePlan(p)}><DeleteIcon fontSize="small"/></IconButton>
              </Box>
            ))}
          </Box>

          {/* Reference Photos */}
          <Typography variant="h6" sx={{ mt: 1 }}>Reference Photos</Typography>
          <Box sx={{ display:'flex', gap:1, alignItems:'center', flexWrap:'wrap' }}>
            <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
              Upload Photos
              <input hidden type="file" accept="image/*" multiple onChange={(e)=>uploadRefPhotos(e.target.files)} />
            </Button>
          </Box>
          <Box sx={{ display:'flex', gap:1, flexWrap:'wrap' }}>
            {refPhotos.length === 0 && <Typography color="text.secondary">No reference photos.</Typography>}
            {refPhotos.map(p => (
              <Box key={p.id} sx={{ display:'inline-flex', alignItems:'center', p:0.5 }}>
                <img src={p.url} alt="ref" style={{ width:120, height:90, objectFit:'cover', borderRadius:4 }}/>
                <IconButton size="small" onClick={()=>deleteRefPhoto(p)}><DeleteIcon fontSize="small"/></IconButton>
              </Box>
            ))}
          </Box>

          {/* Footer */}
          <Box sx={{ display:'flex', gap:1, flexWrap:'wrap' }}>
            <Button variant="contained" disabled={!canSave || saving} onClick={save}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
            <Button variant="outlined" onClick={()=>history.push(`/jobs/${id}`)}>Cancel</Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
