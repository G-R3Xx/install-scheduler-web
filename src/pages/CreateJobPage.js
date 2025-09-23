// src/pages/CreateJobPage.js
import React, { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  TextField,
  Typography,
  Button,
  Grid,
  Chip,
  Backdrop,
  CircularProgress,
  Switch,
  FormControlLabel,
  Divider,
  Stack,
  Link,
} from '@mui/material';
import { useHistory } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase/firebase';
import { useAuth } from '../contexts/AuthContext';

function BusyOverlay({ open, text }) {
  return (
    <Backdrop open={open} sx={{ zIndex: 2000, color: '#fff' }}>
      <Box sx={{ textAlign: 'center' }}>
        <CircularProgress sx={{ mb: 1 }} />
        <Typography sx={{ fontWeight: 600 }}>{text}</Typography>
        <Typography variant="body2" sx={{ opacity: 0.9 }}>
          Please don’t close this window.
        </Typography>
      </Box>
    </Backdrop>
  );
}

export default function CreateJobPage() {
  const history = useHistory();
  const { currentUser, userMap } = useAuth();

  // Core fields
  const [clientName, setClientName] = useState('');
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');

  // Schedule / assignment
  const [installDate, setInstallDate] = useState(''); // yyyy-mm-dd
  const [installTime, setInstallTime] = useState(''); // HH:mm
  const [assignedTo, setAssignedTo] = useState([]);   // array of userIds

  // Hours / survey
  const [allowedHours, setAllowedHours] = useState('');
  const [isSurveyRequest, setIsSurveyRequest] = useState(false);

  // Uploads
  const [logoFile, setLogoFile] = useState(null);
  const [refPhotoFiles, setRefPhotoFiles] = useState([]);
  const [planFiles, setPlanFiles] = useState([]);

  // Busy overlay
  const [saving, setSaving] = useState(false);
  const [uploadingAssets, setUploadingAssets] = useState(false);

  // Build a sorted list of users from userMap
  const users = useMemo(() => {
    const arr = Object.entries(userMap || {}).map(([uid, u]) => ({
      uid,
      shortName: u?.shortName || '',
      displayName: u?.displayName || '',
      email: u?.email || '',
    }));
    arr.sort((a, b) => (a.shortName || a.displayName || '').localeCompare(b.shortName || b.displayName || ''));
    return arr;
  }, [userMap]);

  const toggleAssign = (uid) => {
    setAssignedTo((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]
    );
  };

  const clearAssigned = () => setAssignedTo([]);

  const handleCreate = async () => {
    try {
      setSaving(true);

      const payload = {
        clientName: clientName || '',
        company: company || '',
        contact: contact || '',
        phone: phone || '',
        email: email || '',
        address: address || '',
        description: description || '',
        allowedHours: allowedHours ? Number(allowedHours) : null,
        installTime: installTime || null,
        installDate: installDate || null,
        assignedTo, // <- array of userIds from chips
        status: isSurveyRequest ? 'survey-request' : 'in progress',
        isSurveyRequest,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: currentUser?.uid || null,
        hoursTotal: 0,
        completedPhotoCount: 0,
      };

      const jobRef = await addDoc(collection(db, 'jobs'), payload);

      // Upload assets after doc creation
      try {
        setUploadingAssets(true);

        if (logoFile) {
          const r = ref(storage, `jobs/${jobRef.id}/logo_${Date.now()}_${logoFile.name}`);
          await uploadBytes(r, logoFile);
          const logoUrl = await getDownloadURL(r);
          await addDoc(collection(db, 'jobs', jobRef.id, 'assets'), {
            type: 'logo',
            url: logoUrl,
            fileName: logoFile.name,
            createdAt: serverTimestamp(),
          });
        }

        for (const f of refPhotoFiles) {
          const r = ref(storage, `jobs/${jobRef.id}/reference/${Date.now()}_${f.name}`);
          await uploadBytes(r, f);
          const url = await getDownloadURL(r);
          await addDoc(collection(db, 'jobs', jobRef.id, 'referencePhotos'), {
            url,
            fileName: f.name,
            createdAt: serverTimestamp(),
          });
        }

        for (const f of planFiles) {
          const r = ref(storage, `jobs/${jobRef.id}/plans/${Date.now()}_${f.name}`);
          await uploadBytes(r, f);
          const url = await getDownloadURL(r);
          await addDoc(collection(db, 'jobs', jobRef.id, 'plans'), {
            url,
            fileName: f.name,
            createdAt: serverTimestamp(),
          });
        }
      } finally {
        setUploadingAssets(false);
      }

      history.push('/');
    } catch (err) {
      console.error('Create job failed:', err);
      alert('Failed to create job. Please check fields and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 2, maxWidth: 1100, mx: 'auto' }}>
      <BusyOverlay open={saving || uploadingAssets} text={uploadingAssets ? 'Uploading files…' : 'Saving…'} />

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
          Create Job
        </Typography>

        {/* BASIC INFO */}
        <Typography variant="overline" sx={{ opacity: 0.8 }}>
          Basic Info
        </Typography>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={6}>
            <TextField label="Client Name" fullWidth value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField label="Company" fullWidth value={company} onChange={(e) => setCompany(e.target.value)} />
          </Grid>

          <Grid item xs={12} md={4}>
            <TextField label="Contact" fullWidth value={contact} onChange={(e) => setContact(e.target.value)} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField label="Phone" fullWidth value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField label="Email" fullWidth value={email} onChange={(e) => setEmail(e.target.value)} />
          </Grid>

          <Grid item xs={12}>
            <TextField label="Address" fullWidth value={address} onChange={(e) => setAddress(e.target.value)} />
          </Grid>

          <Grid item xs={12}>
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />

        {/* SCHEDULING */}
        <Typography variant="overline" sx={{ opacity: 0.8 }}>
          Scheduling & Assignment
        </Typography>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={4}>
            <TextField
              label="Install Date"
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={installDate}
              onChange={(e) => setInstallDate(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Install Time"
              type="time"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={installTime}
              onChange={(e) => setInstallTime(e.target.value)}
            />
          </Grid>

          <Grid item xs={12} md={4}>
            <TextField
              label="Quoted / Allowed Hours"
              type="number"
              fullWidth
              value={allowedHours}
              inputProps={{ min: 0, step: '0.25' }}
              onChange={(e) => setAllowedHours(e.target.value)}
            />
          </Grid>

          <Grid item xs={12} md={8}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="subtitle2">Assigned To</Typography>
              {!!assignedTo.length && (
                <Chip size="small" label={`${assignedTo.length} selected`} />
              )}
              {!!assignedTo.length && (
                <Link component="button" variant="caption" onClick={clearAssigned} sx={{ ml: 'auto' }}>
                  Clear
                </Link>
              )}
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {users.map((u) => {
                const selected = assignedTo.includes(u.uid);
                const label = u.shortName || u.displayName || u.email || u.uid;
                return (
                  <Chip
                    key={u.uid}
                    label={label}
                    color={selected ? 'primary' : 'default'}
                    variant={selected ? 'filled' : 'outlined'}
                    onClick={() => toggleAssign(u.uid)}
                    sx={{ cursor: 'pointer' }}
                  />
                );
              })}
              {!users.length && (
                <Typography variant="body2" sx={{ opacity: 0.7 }}>
                  No users found.
                </Typography>
              )}
            </Box>
          </Grid>

          <Grid item xs={12} md={4} sx={{ display: 'flex', alignItems: 'center' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={isSurveyRequest}
                  onChange={(e) => setIsSurveyRequest(e.target.checked)}
                />
              }
              label="Survey Request"
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />

        {/* UPLOADS */}
        <Typography variant="overline" sx={{ opacity: 0.8 }}>
          Uploads
        </Typography>
        <Grid container spacing={2}>
          {/* Logo */}
          <Grid item xs={12} md={4}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Company Logo</Typography>
              <Button variant="outlined" component="label">
                {logoFile ? 'Change Company Logo' : 'Upload Company Logo'}
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                />
              </Button>
              {logoFile && <Chip label={logoFile.name} size="small" />}
            </Stack>
          </Grid>

          {/* Reference photos */}
          <Grid item xs={12} md={4}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Reference Photos</Typography>
              <Button variant="outlined" component="label">
                Select Images
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setRefPhotoFiles(Array.from(e.target.files || []))}
                />
              </Button>
              {!!refPhotoFiles.length && (
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  {refPhotoFiles.length} image{refPhotoFiles.length > 1 ? 's' : ''} selected
                </Typography>
              )}
            </Stack>
          </Grid>

          {/* Plans PDFs */}
          <Grid item xs={12} md={4}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Plans (PDF)</Typography>
              <Button variant="outlined" component="label">
                Select PDF(s)
                <input
                  hidden
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={(e) => setPlanFiles(Array.from(e.target.files || []))}
                />
              </Button>
              {!!planFiles.length && (
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  {planFiles.length} PDF{planFiles.length > 1 ? 's' : ''} selected
                </Typography>
              )}
            </Stack>
          </Grid>
        </Grid>

        {/* ACTIONS */}
        <Box sx={{ mt: 3, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={handleCreate} disabled={saving || uploadingAssets}>
            Create
          </Button>
          <Button variant="outlined" onClick={() => history.push('/')}>
            Cancel
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
