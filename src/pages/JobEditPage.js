// src/pages/JobEditPage.js
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  Grid,
  IconButton,
  TextField,
  Chip,
  Autocomplete,
  CircularProgress,
  Backdrop,
  Switch,
  FormControlLabel,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import ImageRoundedIcon from "@mui/icons-material/ImageRounded";
import { useParams, useHistory } from "react-router-dom";

import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, storage } from "../firebase/firebase";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { useAuth } from "../contexts/AuthContext";
import { DatePicker, TimeField } from "@mui/x-date-pickers";

// ---------- helpers ----------
const toJSDate = (tsOrDate) =>
  tsOrDate?.toDate?.() instanceof Date ? tsOrDate.toDate() : tsOrDate instanceof Date ? tsOrDate : null;

function Busy({ open, text = "Working…" }) {
  return (
    <Backdrop open={open} sx={{ zIndex: 2000, color: "#fff" }}>
      <Box sx={{ display: "grid", justifyItems: "center", gap: 1.5 }}>
        <CircularProgress />
        <Typography sx={{ fontWeight: 600 }}>{text}</Typography>
      </Box>
    </Backdrop>
  );
}

export default function JobEditPage() {
  const { jobId, id } = useParams();
  const resolvedId = jobId || id;
  const history = useHistory();
  const { userMap } = useAuth();

  // job core
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // basic fields
  const [clientName, setClientName] = useState("");
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [surveyRequest, setSurveyRequest] = useState(false);

  // date/time
  const [installDate, setInstallDate] = useState(null); // JS Date (date part)
  const [installTime, setInstallTime] = useState(null); // JS Date representing time-of-day or null

  // hours & assigned users
  const [allowedHours, setAllowedHours] = useState("");
  const [assignedOptions, setAssignedOptions] = useState([]); // [{uid,label}]
  const [assignedSelected, setAssignedSelected] = useState([]); // [{uid,label}]

  // logo
  const [companyLogoUrl, setCompanyLogoUrl] = useState(null);

  // assets
  const [refPhotos, setRefPhotos] = useState([]); // [{id,url,name,mime}]
  const [plans, setPlans] = useState([]); // [{id,url,name,mime}]

  // ---------- load ----------
  const load = useCallback(async () => {
    if (!resolvedId) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, "jobs", resolvedId));
      if (!snap.exists()) {
        setJob(null);
        return;
      }
      const data = { id: snap.id, ...(snap.data() || {}) };
      setJob(data);

      // basic
      setClientName(data.clientName || "");
      setCompany(data.company || "");
      setContact(data.contact || "");
      setPhone(data.phone || "");
      setEmail(data.email || "");
      setAddress(data.address || "");
      setDescription(data.description || "");
      setSurveyRequest(Boolean(data.surveyRequest));
      setCompanyLogoUrl(data.companyLogoUrl || null);

      // date/time
      const js = toJSDate(data.installDate);
      setInstallDate(js || null);
      setInstallTime(data.installTime && js ? js : null);

      // hours
      setAllowedHours(
        Number.isFinite(Number(data.allowedHours)) ? String(Number(data.allowedHours)) : ""
      );

      // options from userMap
      const opts =
        Object.entries(userMap || {}).map(([uid, u]) => ({
          uid,
          label: u.shortName || u.displayName || u.email || "User",
        })) ?? [];
      setAssignedOptions(opts);

      const currentAssigned = (Array.isArray(data.assignedTo)
        ? data.assignedTo
        : data.assignedTo
        ? [data.assignedTo]
        : []
      ).map((uid) => {
        const u = userMap?.[uid];
        return {
          uid,
          label: u?.shortName || u?.displayName || u?.email || uid,
        };
      });
      setAssignedSelected(currentAssigned);

      // load subcollections
      const rp = await getDocs(collection(db, "jobs", resolvedId, "referencePhotos"));
      setRefPhotos(rp.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));

      const pl = await getDocs(collection(db, "jobs", resolvedId, "plans"));
      setPlans(pl.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
    } finally {
      setLoading(false);
    }
  }, [resolvedId, userMap]);

  useEffect(() => {
    load();
  }, [load]);

  // ---------- upload / delete shared helpers ----------
  const handleUpload = async (files, subcollection, setState) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setBusy(true);
    try {
      for (const f of arr) {
        const r = ref(storage, `jobs/${resolvedId}/${subcollection}/${Date.now()}_${f.name}`);
        await uploadBytes(r, f);
        const url = await getDownloadURL(r);
        await addDoc(collection(db, "jobs", resolvedId, subcollection), {
          url,
          name: f.name || null,
          mime: f.type || null,
          createdAt: serverTimestamp(),
        });
      }
      const snap = await getDocs(collection(db, "jobs", resolvedId, subcollection));
      setState(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (item, subcollection, setState) => {
    setBusy(true);
    try {
      // best-effort delete from storage
      try {
        const u = new URL(item.url);
        const path = decodeURIComponent(u.pathname.replace(/^\/v0\/b\/[^/]+\/o\//, ""));
        await deleteObject(ref(storage, path));
      } catch {
        /* ignore */
      }
      await deleteDoc(doc(db, "jobs", resolvedId, subcollection, item.id));
      const snap = await getDocs(collection(db, "jobs", resolvedId, subcollection));
      setState(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
    } finally {
      setBusy(false);
    }
  };

  // logo upload
  const uploadLogo = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = ref(storage, `jobs/${resolvedId}/logo/${Date.now()}_${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setCompanyLogoUrl(url);
    } finally {
      setBusy(false);
    }
  };

  // ---------- save ----------
  const save = async () => {
    if (!job) return;
    setBusy(true);
    try {
      // combine date + time (if time set)
      let combinedDate = installDate ? new Date(installDate) : null;
      let installTimeFlag = false;
      if (combinedDate && installTime instanceof Date) {
        combinedDate.setHours(installTime.getHours(), installTime.getMinutes(), 0, 0);
        installTimeFlag = true;
      }

      const payload = {
        clientName: clientName || null,
        company: company || null,
        contact: contact || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        description: description || null,
        surveyRequest: surveyRequest || false,
        companyLogoUrl: companyLogoUrl || null,

        installDate: combinedDate || null,
        installTime: installTimeFlag,

        allowedHours: allowedHours === "" ? null : Number(allowedHours),
        assignedTo: assignedSelected.map((o) => o.uid),

        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, "jobs", resolvedId), payload);
      await load();
    } finally {
      setBusy(false);
    }
  };

  // ---------- render ----------
  if (!resolvedId) {
    return (
      <Box p={2}>
        <Typography color="error">Invalid job id.</Typography>
      </Box>
    );
  }
  if (loading) {
    return (
      <Box p={2}>
        <Typography>Loading…</Typography>
      </Box>
    );
  }
  if (!job) {
    return (
      <Box p={2}>
        <Typography>Job not found.</Typography>
      </Box>
    );
  }

  const pageTitle = job.clientName ? `Edit Job — ${job.clientName}` : "Edit Job";

  return (
    <Box sx={{ p: 2, maxWidth: 1100, mx: "auto" }}>
      <Busy open={busy} />

      <Typography variant="h5" sx={{ mb: 2 }}>
        {pageTitle}
      </Typography>

      {/* Basic details */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
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

          <Grid item xs={12} md={4}>
            <DatePicker
              label="Install Date"
              value={installDate}
              onChange={(v) => setInstallDate(v)}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TimeField
              label="Install Time"
              value={installTime}
              onChange={(v) => setInstallTime(v)}
              format="h:mm a"
              fullWidth
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Quoted / Allowed Hours"
              value={allowedHours}
              onChange={(e) => setAllowedHours(e.target.value)}
              type="number"
              inputProps={{ step: "0.25", min: "0" }}
              fullWidth
            />
          </Grid>

          <Grid item xs={12}>
            <Autocomplete
              multiple
              options={assignedOptions}
              getOptionLabel={(o) => o.label}
              value={assignedSelected}
              onChange={(_, val) => setAssignedSelected(val)}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip {...getTagProps({ index })} key={option.uid} label={option.label} sx={{ mr: 0.5 }} />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} label="Assigned Users" placeholder="Select users…" />
              )}
            />
          </Grid>

          <Grid item xs={12} md={6} sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <FormControlLabel
              control={
                <Switch checked={surveyRequest} onChange={(e) => setSurveyRequest(e.target.checked)} />
              }
              label="Survey Request"
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "flex-end" }}>
              {companyLogoUrl ? (
                <img
                  src={companyLogoUrl}
                  alt="logo"
                  style={{ height: 44, objectFit: "contain", borderRadius: 4, background: "#fff", padding: 4 }}
                />
              ) : (
                <ImageRoundedIcon sx={{ opacity: 0.6 }} />
              )}
              <Button variant="outlined" component="label">
                Upload Company Logo
                <input hidden type="file" accept="image/*" onChange={(e) => uploadLogo(e.target.files?.[0])} />
              </Button>
            </Box>
          </Grid>
        </Grid>

        <Box sx={{ mt: 2, display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button variant="contained" onClick={save}>
            Save
          </Button>
          <Button variant="outlined" onClick={() => history.push(`/jobs/${resolvedId}`)}>
            Back to Job
          </Button>
          <Button variant="outlined" onClick={() => history.push("/")}>
            Back to List
          </Button>
        </Box>
      </Paper>

      {/* Reference Photos */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h6">Reference Photos</Typography>
          <Button variant="outlined" component="label">
            Select Images
            <input
              hidden
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(e) => handleUpload(e.target.files, "referencePhotos", setRefPhotos)}
            />
          </Button>
        </Box>

        <Grid container spacing={1} mt={1}>
          {refPhotos.map((p) => {
            const isPDF = (p.mime && /pdf/i.test(p.mime)) || /\.pdf(\?|$)/i.test(p.url || "");
            return (
              <Grid item key={p.id}>
                <Box
                  sx={{
                    position: "relative",
                    width: 160,
                    height: 100,
                    borderRadius: 1,
                    bgcolor: "background.paper",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    p: 1,
                    boxShadow: 1,
                  }}
                >
                  {isPDF ? (
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        alignItems: "center",
                        gap: 1,
                        width: "100%",
                      }}
                    >
                      <PictureAsPdfRoundedIcon color="error" />
                      <Typography
                        variant="body2"
                        sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={p.name || "PDF"}
                      >
                        {p.name || "PDF"}
                      </Typography>
                      <IconButton
                        size="small"
                        component="a"
                        href={p.url}
                        target="_blank"
                        rel="noopener"
                        aria-label="Open PDF"
                      >
                        <OpenInNewRoundedIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ) : (
                    <img
                      src={p.url}
                      alt={p.name || "reference"}
                      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6 }}
                    />
                  )}
                  <IconButton
                    size="small"
                    onClick={() => handleDelete(p, "referencePhotos", setRefPhotos)}
                    sx={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      bgcolor: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      "&:hover": { bgcolor: "rgba(0,0,0,0.75)" },
                    }}
                    aria-label="Delete reference"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Grid>
            );
          })}
          {refPhotos.length === 0 && (
            <Grid item xs={12}>
              <Typography color="text.secondary">No reference photos uploaded.</Typography>
            </Grid>
          )}
        </Grid>
      </Paper>

      {/* Plans / PDFs */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h6">Plans / PDFs</Typography>
          <Button variant="outlined" component="label">
            Upload Plans
            <input
              hidden
              type="file"
              accept="application/pdf,image/*"
              multiple
              onChange={(e) => handleUpload(e.target.files, "plans", setPlans)}
            />
          </Button>
        </Box>

        <Grid container spacing={1} mt={1}>
          {plans.map((p) => {
            const isPDF = (p.mime && /pdf/i.test(p.mime)) || /\.pdf(\?|$)/i.test(p.url || "");
            return (
              <Grid item key={p.id}>
                <Box
                  sx={{
                    position: "relative",
                    width: 160,
                    height: 100,
                    borderRadius: 1,
                    bgcolor: "background.paper",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    p: 1,
                    boxShadow: 1,
                  }}
                >
                  {isPDF ? (
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        alignItems: "center",
                        gap: 1,
                        width: "100%",
                      }}
                    >
                      <PictureAsPdfRoundedIcon color="error" />
                      <Typography
                        variant="body2"
                        sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={p.name || "PDF"}
                      >
                        {p.name || "PDF"}
                      </Typography>
                      <IconButton
                        size="small"
                        component="a"
                        href={p.url}
                        target="_blank"
                        rel="noopener"
                        aria-label="Open PDF"
                      >
                        <OpenInNewRoundedIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ) : (
                    <img
                      src={p.url}
                      alt={p.name || "plan"}
                      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6 }}
                    />
                  )}
                  <IconButton
                    size="small"
                    onClick={() => handleDelete(p, "plans", setPlans)}
                    sx={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      bgcolor: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      "&:hover": { bgcolor: "rgba(0,0,0,0.75)" },
                    }}
                    aria-label="Delete plan"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Grid>
            );
          })}
          {plans.length === 0 && (
            <Grid item xs={12}>
              <Typography color="text.secondary">No plans uploaded.</Typography>
            </Grid>
          )}
        </Grid>
      </Paper>
    </Box>
  );
}
