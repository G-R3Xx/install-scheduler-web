import React, { useEffect, useState, useMemo } from 'react';
import {
  Box, Button, Divider, Paper, TextField, Typography, Stack
} from '@mui/material';
import { useParams, useHistory } from 'react-router-dom';
import {
  doc, getDoc, getDocs, serverTimestamp, Timestamp, updateDoc, collection
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export default function JobEditPage() {
  const params = useParams();
  const jobId = params.id || params.jobId;
  const history = useHistory();
  const storage = getStorage();

  const [form, setForm] = useState({
    clientName: '', company: '', contact: '', phone: '', email: '', address: '',
    description: '', installDate: null, installTime: '', assignedTo: [], companyLogoUrl: null,
    allowedHours: ''
  });

  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!jobId) return;
      const snap = await getDoc(doc(db, 'jobs', jobId));
      if (snap.exists()) {
        const d = snap.data();
        setForm({
          clientName: d.clientName || '', company: d.company || '', contact: d.contact || '',
          phone: d.phone || '', email: d.email || '', address: d.address || '',
          description: d.description || '',
          installDate: d.installDate?.toDate ? d.installDate.toDate() : d.installDate || null,
          installTime: d.installTime || '',
          assignedTo: Array.isArray(d.assignedTo) ? d.assignedTo : d.assignedTo ? [d.assignedTo] : [],
          companyLogoUrl: d.companyLogoUrl || null,
          allowedHours: d.allowedHours || ''
        });
      }
      const usersSnap = await getDocs(collection(db, 'users'));
      setUsers(usersSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) })));
    })();
  }, [jobId]);

  const canSave = useMemo(
    () => form.clientName.trim() && (form.email.trim() || form.phone.trim()),
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
    if (!file) return;
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

  const handleSave = async () => {
    try {
      setSaving(true);
      const ts = buildInstallTimestamp();
      await updateDoc(doc(db, 'jobs', jobId), {
        clientName: form.clientName || '',
        company: form.company || '',
        contact: form.contact || '',
        phone: form.phone || '',
        email: form.email || '',
        address: form.address || '',
        description: form.description || '',
        installDate: ts,
        installTime: form.installTime || null,
        assignedTo: form.assignedTo.map((u) => (u.id || u)),
        companyLogoUrl: form.companyLogoUrl || null,
        allowedHours: form.allowedHours || '',
        updatedAt: serverTimestamp(),
      });
      history.push(`/jobs/${jobId}`);
    } catch (e) {
      console.error('Save failed', e);
      alert(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const dateValue = form.installDate
    ? new Date(form.installDate.getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10)
    : '';

  return (
    <Box sx={{ p: 2, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Edit Job</Typography>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <TextField
            label="Client / Job Name"
            value={form.clientName}
            onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
            fullWidth
          />
          <TextField
            label="Company"
            value={form.company}
            onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
            fullWidth
          />
          <TextField
            label="Contact"
            value={form.contact}
            onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
            fullWidth
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            fullWidth
          />
          <TextField
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            fullWidth
          />
          <TextField
            label="Address"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            fullWidth
          />
          <TextField
            label="Description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            fullWidth multiline minRows={2}
          />

          {/* Logo upload */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Company Logo</Typography>
            <Button variant="outlined" component="label">
              Upload Logo
              <input hidden type="file" accept="image/*" onChange={(e) => handleLogoUpload(e.target.files?.[0])} />
            </Button>
            {form.companyLogoUrl && (
              <Box sx={{ mt: 1 }}>
                <img
                  src={form.companyLogoUrl}
                  alt="logo"
                  style={{ maxHeight: 60, maxWidth: 120, objectFit: 'contain' }}
                />
              </Box>
            )}
          </Box>

          {/* Date */}
          <TextField
            type="date"
            label="Scheduled Date"
            value={dateValue}
            onChange={(e) => setForm((f) => ({ ...f, installDate: e.target.value ? new Date(e.target.value) : null }))}
            InputLabelProps={{ shrink: true }}
          />

          {/* Time */}
          <TextField
            type="time"
            label="Scheduled Time (optional)"
            value={form.installTime || ''}
            onChange={(e) => setForm((f) => ({ ...f, installTime: e.target.value }))}
            InputLabelProps={{ shrink: true }}
          />

          {/* Allowed Hours */}
          <TextField
            type="number"
            label="Quoted / Allowed Hours"
            value={form.allowedHours}
            onChange={(e) => setForm((f) => ({ ...f, allowedHours: e.target.value }))}
            fullWidth
          />

          {/* Assign */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Assign to</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {users.map((u) => {
                const selected = form.assignedTo.some((x) => (x.id || x) === u.id);
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

          <Divider />

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" disabled={!canSave || saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
            <Button variant="outlined" onClick={() => history.push(`/jobs/${jobId}`)}>
              Cancel
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}

