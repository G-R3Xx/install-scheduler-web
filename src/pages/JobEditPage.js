import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Grid, Divider, Autocomplete, Avatar
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers';
import { useParams, useHistory } from 'react-router-dom';
import { db, storage } from '../firebase/firebase';
import { doc, getDoc, updateDoc, collection, getDocs, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export default function JobEditPage() {
  const { jobId } = useParams();
  const history = useHistory();

  const [job, setJob] = useState(null);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState([]);

  // logo editing state
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);

  // load job
  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, 'jobs', jobId));
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() };
        const installDate =
          data.installDate?.toDate?.() ? data.installDate.toDate() :
          (data.installDate instanceof Date ? data.installDate : null);

        setJob({ ...data, installDate });
        setLogoPreview(data.companyLogoUrl || null);
      }
    })();
  }, [jobId]);

  // load users for assignment
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'users'));
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
      setUsers(list);
    })();
  }, []);

  const userOptions = useMemo(
    () => users.map(u => ({ id: u.id, label: u.shortName || u.displayName || u.email || u.id })),
    [users]
  );

  if (!job) return <Box p={3}><Typography>Loading…</Typography></Box>;

  const assignedIds = Array.isArray(job.assignedTo) ? job.assignedTo : (job.assignedTo ? [job.assignedTo] : []);

  const handleAssignChange = (_, valueArr) => {
    const ids = valueArr.map(v => v.id);
    setJob(prev => ({ ...prev, assignedTo: ids }));
  };

  const onLogoChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
    e.target.value = '';
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setJob(prev => ({ ...prev, companyLogoUrl: null }));
  };

  const initials = (job.company || job.clientName || 'J')
    .split(/\s+/).slice(0,2).map(s => s[0]?.toUpperCase()).join('');

  const saveBasics = async () => {
    setSaving(true);
    try {
      let companyLogoUrl = job.companyLogoUrl || null;
      if (logoFile) {
        try {
          const logoRef = ref(storage, `jobs/${jobId}/companyLogo.png`);
          await uploadBytes(logoRef, logoFile);
          companyLogoUrl = await getDownloadURL(logoRef);
          console.log('[upload] logo →', companyLogoUrl);
        } catch (err) {
          console.error('Logo upload failed:', err);
          alert('Logo failed to upload. You can try again.');
        }
      }

      await updateDoc(doc(db, 'jobs', jobId), {
        clientName: job.clientName || '',
        company: job.company || '',
        contact: job.contact || '',
        phone: job.phone || '',
        email: job.email || '',
        address: job.address || '',
        description: job.description || '',
        assignedTo: Array.isArray(job.assignedTo) ? job.assignedTo : [],
        companyLogoUrl,
        installDate: job.installDate ? Timestamp.fromDate(job.installDate) : null,
      });

      history.push(`/jobs/${jobId}`);
    } catch (err) {
      console.error('Save failed:', err);
      alert(err?.message || 'Failed to save job.');
    } finally {
      setSaving(false);
    }
  };

  // ---- uploads for photos/plans ----
  const uploadMany = async (files, pathPrefix) => {
    const urls = [];
    for (const f of files) {
      const r = ref(storage, `${pathPrefix}/${f.name}`);
      await uploadBytes(r, f);
      const url = await getDownloadURL(r);
      urls.push(url);
      console.log('[upload]', pathPrefix, f.name, '→', url);
    }
    return urls;
  };

  const addReferencePhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      const urls = await uploadMany(files, `jobs/${jobId}/referencePhotos`);
      const newArr = [...(job.referencePhotos || []), ...urls];
      setJob(prev => ({ ...prev, referencePhotos: newArr }));
      await updateDoc(doc(db, 'jobs', jobId), { referencePhotos: newArr });
    } catch (err) {
      console.error('Reference upload failed:', err);
      alert('Some reference photos failed to upload.');
    } finally {
      e.target.value = '';
    }
  };

  const addPlans = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      const urls = await uploadMany(files, `jobs/${jobId}/plans`);
      const newArr = [...(job.plans || []), ...urls];
      setJob(prev => ({ ...prev, plans: newArr }));
      await updateDoc(doc(db, 'jobs', jobId), { plans: newArr });
    } catch (err) {
      console.error('Plan upload failed:', err);
      alert('Some plans failed to upload.');
    } finally {
      e.target.value = '';
    }
  };

  const removeFromArrayField = async (field, url) => {
    try {
      const arr = [...(job[field] || [])].filter(u => u !== url);
      setJob(prev => ({ ...prev, [field]: arr }));
      await updateDoc(doc(db, 'jobs', jobId), { [field]: arr });
    } catch (err) {
      console.error('Remove failed:', err);
      alert('Failed to remove file reference.');
    }
  };

  return (
    <Box p={3}>
      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Typography variant="h5" gutterBottom>Edit Job</Typography>

        {/* Logo controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Avatar
            variant="square"
            src={logoPreview || undefined}
            alt="Company Logo"
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
            <input type="file" hidden accept="image/*" onChange={onLogoChange} />
          </Button>
          {logoPreview && (
            <Button variant="text" color="error" onClick={removeLogo}>
              Remove
            </Button>
          )}
        </Box>

        {/* Basic fields */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField fullWidth label="Client" sx={{ mb: 2 }}
              value={job.clientName || ''} onChange={e => setJob({ ...job, clientName: e.target.value })} />
            <TextField fullWidth label="Company" sx={{ mb: 2 }}
              value={job.company || ''} onChange={e => setJob({ ...job, company: e.target.value })} />
            <TextField fullWidth label="Contact" sx={{ mb: 2 }}
              value={job.contact || ''} onChange={e => setJob({ ...job, contact: e.target.value })} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth label="Phone" sx={{ mb: 2 }}
              value={job.phone || ''} onChange={e => setJob({ ...job, phone: e.target.value })} />
            <TextField fullWidth label="Email" sx={{ mb: 2 }}
              value={job.email || ''} onChange={e => setJob({ ...job, email: e.target.value })} />
            <TextField fullWidth label="Address" sx={{ mb: 2 }}
              value={job.address || ''} onChange={e => setJob({ ...job, address: e.target.value })} />
          </Grid>

          {/* Install Date */}
          <Grid item xs={12} md={6}>
            <DatePicker
              label="Install Date"
              value={job.installDate || null}
              onChange={(val) => setJob(prev => ({ ...prev, installDate: val }))}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>

          {/* Description full width */}
          <Grid item xs={12}>
            <TextField
              fullWidth multiline minRows={6}
              label="Description"
              value={job.description || ''}
              onChange={e => setJob({ ...job, description: e.target.value })}
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />

        {/* Assigned Users */}
        <Typography variant="h6" gutterBottom>Assigned Users</Typography>
        <Autocomplete
          multiple
          options={userOptions}
          value={userOptions.filter(u => assignedIds.includes(u.id))}
          onChange={handleAssignChange}
          renderInput={(params) => <TextField {...params} label="Select users" placeholder="Start typing…" />}
          sx={{ maxWidth: 520, mb: 2 }}
        />

        <Divider sx={{ my: 2 }} />

        {/* Reference Photos */}
        <Typography variant="h6" gutterBottom>Reference Photos</Typography>
        <Button variant="outlined" component="label" sx={{ mb: 1 }}>
          Add Reference Photos
          <input
            type="file"
            hidden
            accept="image/*"
            multiple
            onChange={addReferencePhotos}
          />
        </Button>
        <Grid container spacing={1} sx={{ mb: 2 }}>
          {(job.referencePhotos || []).map((u, i) => (
            <Grid item key={i}>
              <Box sx={{ position: 'relative' }}>
                <img src={u} alt={`ref-${i}`} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6 }} />
                <Button size="small" variant="contained" color="error"
                  sx={{ position: 'absolute', top: 4, right: 4, minWidth: 24, px: 1 }}
                  onClick={() => removeFromArrayField('referencePhotos', u)}
                >
                  X
                </Button>
              </Box>
            </Grid>
          ))}
        </Grid>

        {/* Plans */}
        <Typography variant="h6" gutterBottom>Plans (PDF)</Typography>
        <Button variant="outlined" component="label" sx={{ mb: 1 }}>
          Add Plans
          <input
            type="file"
            hidden
            accept="application/pdf"
            multiple
            onChange={addPlans}
          />
        </Button>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {(job.plans || []).map((u, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button variant="outlined" onClick={() => window.open(u, '_blank')} sx={{ justifyContent: 'flex-start' }}>
                {decodeURIComponent(u.split('?')[0]).split('/').pop()}
              </Button>
              <Button size="small" color="error" onClick={() => removeFromArrayField('plans', u)}>Remove</Button>
            </Box>
          ))}
        </Box>

        <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
          <Button variant="contained" onClick={saveBasics} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outlined" onClick={() => history.push(`/jobs/${jobId}`)}>Cancel</Button>
        </Box>
      </Paper>
    </Box>
  );
}
