import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Grid, Divider, Autocomplete, Avatar
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers';
import { useHistory } from 'react-router-dom';
import { db, storage } from '../firebase/firebase';
import { addDoc, collection, getDocs, doc, updateDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export default function CreateJobPage() {
  const history = useHistory();

  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    clientName: '',
    company: '',
    contact: '',
    phone: '',
    email: '',
    address: '',
    description: '',
    installDate: null,
    assignedTo: [],          // [{id,label}]
  });

  // selections (not yet uploaded)
  const [refFiles, setRefFiles] = useState([]);
  const [planFiles, setPlanFiles] = useState([]);

  // logo state (not yet uploaded)
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'users'));
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
      setUsers(list);
    })();
  }, []);

  const userOptions = useMemo(
    () => users.map(u => ({
      id: u.id,
      label: u.shortName || u.displayName || u.email || u.id
    })),
    [users]
  );

  // ---- helpers ----
  const uploadMany = async (jobId, files, path) => {
    const urls = [];
    for (const f of files) {
      const fileRef = ref(storage, `jobs/${jobId}/${path}/${f.name}`);
      await uploadBytes(fileRef, f);
      const url = await getDownloadURL(fileRef);
      urls.push(url);
      console.log(`[upload] ${path}:`, f.name, '→', url);
    }
    return urls;
  };

  const handleLogoChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
    // allow choosing the same file again later
    e.target.value = '';
  };

  const initials = (form.company || form.clientName || 'J')
    .split(/\s+/).slice(0,2).map(s => s[0]?.toUpperCase()).join('');

  const handleCreate = async () => {
    setSaving(true);
    try {
      // 1) create job
      const docRef = await addDoc(collection(db, 'jobs'), {
        clientName: form.clientName || '',
        company: form.company || '',
        contact: form.contact || '',
        phone: form.phone || '',
        email: form.email || '',
        address: form.address || '',
        description: form.description || '',
        status: 'in progress',
        installDate: form.installDate ? Timestamp.fromDate(form.installDate) : null,
        assignedTo: form.assignedTo.map(v => v.id),
        referencePhotos: [],
        plans: [],
        companyLogoUrl: null,
        createdAt: serverTimestamp(),
      });

      // 2) uploads (optional)
      let refUrls = [];
      let planUrls = [];
      try {
        refUrls = refFiles.length ? await uploadMany(docRef.id, refFiles, 'referencePhotos') : [];
        planUrls = planFiles.length ? await uploadMany(docRef.id, planFiles, 'plans') : [];
      } catch (err) {
        console.error('Upload error:', err);
        alert('Some files failed to upload. You can still save and add later from Edit Job.');
      }

      // 3) logo upload (optional)
      let logoUrl = null;
      if (logoFile) {
        try {
          const logoRef = ref(storage, `jobs/${docRef.id}/companyLogo.png`);
          await uploadBytes(logoRef, logoFile);
          logoUrl = await getDownloadURL(logoRef);
          console.log('[upload] logo →', logoUrl);
        } catch (err) {
          console.error('Logo upload failed:', err);
          alert('Logo failed to upload. You can upload it later in Edit Job.');
        }
      }

      // 4) update with URLs
      await updateDoc(doc(db, 'jobs', docRef.id), {
        referencePhotos: refUrls,
        plans: planUrls,
        companyLogoUrl: logoUrl,
      });

      history.push(`/jobs/${docRef.id}`);
    } catch (err) {
      console.error('Create job failed:', err);
      alert(err?.message || 'Failed to create job.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box p={3}>
      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Typography variant="h5" gutterBottom>Create Job</Typography>

        {/* Logo upload (with tiny preview) */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Avatar
            variant="square"
            src={logoPreview || undefined}
            alt="Company Logo Preview"
            sx={{
              width: 40, height: 40,
              bgcolor: '#fff', p: 0.5,
              border: '1px solid rgba(0,0,0,0.15)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.18)'
            }}
          >
            {initials}
          </Avatar>
          <Button variant="outlined" component="label">
            {logoPreview ? 'Change Logo' : 'Upload Logo'}
            <input
              type="file"
              hidden
              accept="image/*"
              onChange={handleLogoChange}
            />
          </Button>
          {logoPreview && (
            <Button variant="text" onClick={() => { setLogoFile(null); setLogoPreview(null); }}>
              Remove
            </Button>
          )}
        </Box>

        {/* Basic fields */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField fullWidth label="Client" sx={{ mb: 2 }}
              value={form.clientName}
              onChange={e => setForm({ ...form, clientName: e.target.value })}
            />
            <TextField fullWidth label="Company" sx={{ mb: 2 }}
              value={form.company}
              onChange={e => setForm({ ...form, company: e.target.value })}
            />
            <TextField fullWidth label="Contact" sx={{ mb: 2 }}
              value={form.contact}
              onChange={e => setForm({ ...form, contact: e.target.value })}
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <TextField fullWidth label="Phone" sx={{ mb: 2 }}
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
            />
            <TextField fullWidth label="Email" sx={{ mb: 2 }}
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
            />
            <TextField fullWidth label="Address" sx={{ mb: 2 }}
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
            />
          </Grid>

          {/* Install Date */}
          <Grid item xs={12} md={6}>
            <DatePicker
              label="Install Date"
              value={form.installDate}
              onChange={(val) => setForm({ ...form, installDate: val })}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>

          {/* Description full width */}
          <Grid item xs={12}>
            <TextField
              fullWidth multiline minRows={6}
              label="Description"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />

        {/* Assign Users */}
        <Typography variant="h6" gutterBottom>Assign Users</Typography>
        <Autocomplete
          multiple
          options={userOptions}
          value={form.assignedTo}
          onChange={(_, v) => setForm({ ...form, assignedTo: v })}
          renderInput={(params) => <TextField {...params} label="Select users" placeholder="Start typing…" />}
          sx={{ maxWidth: 520, mb: 2 }}
        />

        <Divider sx={{ my: 2 }} />

        {/* Reference Photos */}
        <Typography variant="h6" gutterBottom>Reference Photos</Typography>
        <Button variant="outlined" component="label" sx={{ mb: 1 }}>
          Choose Images
          <input
            type="file"
            hidden
            accept="image/*"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              setRefFiles(files);
              e.target.value = ''; // allow re-select same files later
            }}
          />
        </Button>
        {refFiles.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            {refFiles.map((f, i) => (
              <Box key={i} sx={{ width: 64, height: 64, borderRadius: 1, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.2)' }}>
                {f.type.startsWith('image/')
                  ? <img src={URL.createObjectURL(f)} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Typography variant="caption" sx={{ p: 0.5, display: 'block' }}>{f.name}</Typography>}
              </Box>
            ))}
          </Box>
        )}

        {/* Plans */}
        <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>Plans (PDF)</Typography>
        <Button variant="outlined" component="label" sx={{ mb: 1 }}>
          Choose PDF(s)
          <input
            type="file"
            hidden
            accept="application/pdf"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              setPlanFiles(files);
              e.target.value = '';
            }}
          />
        </Button>
        {planFiles.length > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2 }}>
            {planFiles.map((f, i) => (
              <Typography key={i} variant="body2" sx={{ opacity: 0.85 }}>
                • {f.name}
              </Typography>
            ))}
          </Box>
        )}

        <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
          <Button variant="contained" onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating…' : 'Create Job'}
          </Button>
          <Button variant="outlined" onClick={() => history.push('/')}>Cancel</Button>
        </Box>
      </Paper>
    </Box>
  );
}
