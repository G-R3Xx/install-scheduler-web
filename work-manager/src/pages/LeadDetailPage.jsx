import React, { useEffect, useMemo, useRef, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import RequestQuoteRoundedIcon from "@mui/icons-material/RequestQuoteRounded";

import { db, storage } from "../firebase/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { makeDocNumber } from "../utils/numbering";
import LeadEmailsPanel from "../components/LeadEmailsPanel";

const num = (x, fallback = 0) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
};

const norm = (s) => (s || "").toString().trim();

function leadStatusChip(status) {
  const s = (status || "new").toString().toLowerCase();
  const map = {
    new: { label: "New", color: "info" },
    quoting: { label: "Quoting", color: "primary" },
    quoted: { label: "Quoted", color: "warning" },
    won: { label: "Won", color: "success" },
    lost: { label: "Lost", color: "default" },
    on_hold: { label: "On Hold", color: "default" },
  };
  const v = map[s] || map.new;
  return <Chip size="small" label={v.label} color={v.color} />;
}

function fileTypeLabel(category) {
  const c = (category || "other").toString().toLowerCase();
  if (c === "email") return "Email";
  if (c === "artwork") return "Artwork";
  if (c === "photo") return "Photo";
  return "File";
}

export default function LeadDetailPage() {
  const { id } = useParams();
  const history = useHistory();

  const [lead, setLead] = useState(null);
  const [files, setFiles] = useState([]);
  const [loadingErr, setLoadingErr] = useState("");

  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  const [fileCategory, setFileCategory] = useState("email");
  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "leads", id),
      (snap) => {
        if (!snap.exists()) {
          setLoadingErr(`Lead not found: ${id}`);
          setLead(null);
          return;
        }
        setLoadingErr("");
        setLead({ id: snap.id, ...snap.data() });
      },
      (e) => {
        console.error(e);
        setLoadingErr(e?.message || "Failed to load lead");
      }
    );

    const qy = query(collection(db, "leads", id, "files"), orderBy("uploadedAt", "desc"));
    const unsubFiles = onSnapshot(
      qy,
      (snap) => setFiles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => console.error(e)
    );

    return () => {
      unsub();
      unsubFiles();
    };
  }, [id]);

  const updateLead = async (patch) => {
    setBusy(true);
    try {
      await updateDoc(doc(db, "leads", id), { ...patch, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Save failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const canCreateQuote = useMemo(() => {
    if (!lead) return false;
    return !!(norm(lead.companyName) || norm(lead.contactName) || norm(lead.email) || norm(lead.phone));
  }, [lead]);

  const applyEmailContextToLead = async (email) => {
    if (!lead || !email) return;

    const pieces = [];
    if ((email.subject || "").trim()) pieces.push(`Email subject: ${email.subject}`);
    if ((email.fromText || "").trim()) pieces.push(`From: ${email.fromText}`);
    if ((email.snippet || "").trim()) pieces.push(`Summary: ${email.snippet}`);

    const block = pieces.join("\n");
    const current = (lead.description || "").trim();
    const nextDescription = current
      ? current.includes(block)
        ? current
        : `${current}\n\n${block}`
      : block;

    setLead((p) => ({ ...p, description: nextDescription }));

    setBusy(true);
    try {
      await updateDoc(doc(db, "leads", id), {
        description: nextDescription,
        updatedAt: serverTimestamp(),
      });
      setSnack({ open: true, msg: "Email context added to lead details.", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to apply email context", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (fileList) => {
    if (!storage) {
      setSnack({ open: true, msg: "Storage is not configured (storage export missing).", severity: "error" });
      return;
    }
    if (!lead) return;

    const arr = Array.from(fileList || []);
    if (!arr.length) return;

    setBusy(true);
    try {
      for (const f of arr) {
        const safeName = (f.name || "file").replace(/[^\w.\-()\s]/g, "_");
        const path = `leads/${lead.id}/${fileCategory}/${Date.now()}_${safeName}`;
        const storageRef = ref(storage, path);

        await uploadBytes(storageRef, f);
        const url = await getDownloadURL(storageRef);

        await addDoc(collection(db, "leads", lead.id, "files"), {
          category: fileCategory,
          name: f.name || safeName,
          path,
          url,
          size: num(f.size, 0),
          contentType: f.type || "",
          uploadedAt: serverTimestamp(),
          uploadedBy: "",
        });
      }

      setSnack({ open: true, msg: "Files uploaded.", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Upload failed", severity: "error" });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteFile = async (fileDoc) => {
    if (!fileDoc) return;
    setBusy(true);
    try {
      if (storage && fileDoc.path) {
        try {
          await deleteObject(ref(storage, fileDoc.path));
        } catch (e) {
          console.warn("Storage delete warning:", e?.message || e);
        }
      }
      await deleteDoc(doc(db, "leads", id, "files", fileDoc.id));
      setSnack({ open: true, msg: "File removed.", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Delete failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const createQuoteFromLead = async () => {
    if (!lead) return;

    if (lead.quoteId) {
      history.push(`/quotes/${lead.quoteId}`);
      return;
    }

    if (!canCreateQuote) {
      setSnack({ open: true, msg: "Add some client details first.", severity: "warning" });
      return;
    }

    setBusy(true);
    try {
      let clientId = lead.clientId || "";

      if (!clientId && norm(lead.email)) {
        const qs = await getDocs(query(collection(db, "clients"), where("email", "==", norm(lead.email))));
        if (!qs.empty) clientId = qs.docs[0].id;
      }

      if (!clientId && norm(lead.companyName)) {
        const qs = await getDocs(query(collection(db, "clients"), where("companyName", "==", norm(lead.companyName))));
        if (!qs.empty) clientId = qs.docs[0].id;
      }

      if (!clientId) {
        const clientRef = await addDoc(collection(db, "clients"), {
          companyName: norm(lead.companyName),
          contactName: norm(lead.contactName),
          email: norm(lead.email),
          phone: norm(lead.phone),
          address: norm(lead.address),
          clientTypeId: "",
          clientTypeName: "General",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        clientId = clientRef.id;

        await updateDoc(doc(db, "leads", lead.id), {
          clientId,
          updatedAt: serverTimestamp(),
        });
      }

      const quoteNumber = makeDocNumber("Q");
      const clientSnapshot = {
        companyName: norm(lead.companyName),
        contactName: norm(lead.contactName),
        email: norm(lead.email),
        phone: norm(lead.phone),
        address: norm(lead.address),
        clientTypeId: "",
        clientTypeName: "General",
        clientDiscountPct: 0,
      };

      const quotePayload = {
        quoteNumber,
        status: "draft",
        sourceLeadId: lead.id,
        leadNumber: lead.leadNumber || "",
        clientId,
        clientSnapshot,
        notes: norm(lead.description),
        lineItems: [],
        totals: { costTotal: 0, sellTotal: 0, itemCount: 0 },
        orderId: "",
        orderNumber: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const quoteRef = await addDoc(collection(db, "quotes"), quotePayload);

      await updateDoc(doc(db, "leads", lead.id), {
        quoteId: quoteRef.id,
        quoteNumber,
        status: lead.status === "new" ? "quoting" : lead.status,
        updatedAt: serverTimestamp(),
      });

      setSnack({ open: true, msg: "Quote created from lead.", severity: "success" });
      history.push(`/quotes/${quoteRef.id}`);
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to create quote", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (loadingErr) {
    return (
      <Box sx={{ maxWidth: 900, mx: "auto" }}>
        <Alert severity="error">{loadingErr}</Alert>
      </Box>
    );
  }

  if (!lead) {
    return (
      <Box sx={{ maxWidth: 900, mx: "auto" }}>
        <Typography sx={{ opacity: 0.8 }}>Loading…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton onClick={() => history.push("/leads")} size="small" title="Back to Leads">
          <ArrowBackRoundedIcon />
        </IconButton>

        <Typography variant="h4" sx={{ fontWeight: 900, flex: 1 }}>
          {lead.leadNumber || "Lead"}
        </Typography>

        {leadStatusChip(lead.status)}

        {lead.quoteId ? (
          <Button
            variant="outlined"
            startIcon={<LaunchRoundedIcon />}
            onClick={() => history.push(`/quotes/${lead.quoteId}`)}
            sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
          >
            Open Quote
          </Button>
        ) : (
          <Button
            variant="contained"
            startIcon={<RequestQuoteRoundedIcon />}
            onClick={createQuoteFromLead}
            disabled={busy}
            sx={{ textTransform: "none", borderRadius: 2, fontWeight: 900 }}
          >
            Create Quote
          </Button>
        )}
      </Stack>

      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Company"
              value={lead.companyName || ""}
              onChange={(e) => setLead((p) => ({ ...p, companyName: e.target.value }))}
              onBlur={() => updateLead({ companyName: lead.companyName || "" })}
              fullWidth
            />
            <TextField
              label="Contact"
              value={lead.contactName || ""}
              onChange={(e) => setLead((p) => ({ ...p, contactName: e.target.value }))}
              onBlur={() => updateLead({ contactName: lead.contactName || "" })}
              fullWidth
            />
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Email"
              value={lead.email || ""}
              onChange={(e) => setLead((p) => ({ ...p, email: e.target.value }))}
              onBlur={() => updateLead({ email: lead.email || "" })}
              fullWidth
            />
            <TextField
              label="Phone"
              value={lead.phone || ""}
              onChange={(e) => setLead((p) => ({ ...p, phone: e.target.value }))}
              onBlur={() => updateLead({ phone: lead.phone || "" })}
              fullWidth
            />
          </Stack>

          <TextField
            label="Address"
            value={lead.address || ""}
            onChange={(e) => setLead((p) => ({ ...p, address: e.target.value }))}
            onBlur={() => updateLead({ address: lead.address || "" })}
            fullWidth
          />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel>Source</InputLabel>
              <Select label="Source" value={lead.source || "email"} onChange={(e) => updateLead({ source: e.target.value })}>
                <MenuItem value="email">Email</MenuItem>
                <MenuItem value="phone">Phone</MenuItem>
                <MenuItem value="walk_in">Walk-in</MenuItem>
                <MenuItem value="web">Web</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select label="Status" value={lead.status || "new"} onChange={(e) => updateLead({ status: e.target.value })}>
                <MenuItem value="new">New</MenuItem>
                <MenuItem value="quoting">Quoting</MenuItem>
                <MenuItem value="quoted">Quoted</MenuItem>
                <MenuItem value="won">Won</MenuItem>
                <MenuItem value="lost">Lost</MenuItem>
                <MenuItem value="on_hold">On Hold</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <TextField
            label="Rough job details"
            value={lead.description || ""}
            onChange={(e) => setLead((p) => ({ ...p, description: e.target.value }))}
            onBlur={() => updateLead({ description: lead.description || "" })}
            fullWidth
            multiline
            minRows={4}
          />
        </Stack>
      </Paper>

      <LeadEmailsPanel
        leadId={id}
        onUseEmailContext={applyEmailContextToLead}
        defaultOpenLatest
      />

      <Paper sx={{ p: 2, borderRadius: 3, mt: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            Uploaded Attachments
          </Typography>

          <Stack direction="row" spacing={1} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>Type</InputLabel>
              <Select label="Type" value={fileCategory} onChange={(e) => setFileCategory(e.target.value)}>
                <MenuItem value="email">Received email</MenuItem>
                <MenuItem value="artwork">Supplied artwork</MenuItem>
                <MenuItem value="photo">Photos</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => uploadFiles(e.target.files)}
            />
            <Button
              variant="contained"
              startIcon={<UploadFileRoundedIcon />}
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}
            >
              Upload
            </Button>
          </Stack>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        {files.length ? (
          <Stack spacing={1}>
            {files.map((f) => (
              <Paper key={f.id} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box sx={{ minWidth: 100 }}>
                    <Chip size="small" label={fileTypeLabel(f.category)} variant="outlined" />
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name || "File"}
                    </Typography>
                    <Typography sx={{ opacity: 0.7, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.contentType || ""} {f.size ? `• ${(Number(f.size) / 1024).toFixed(0)} KB` : ""}
                    </Typography>
                  </Box>

                  {f.url ? (
                    <Button
                      variant="outlined"
                      startIcon={<LaunchRoundedIcon />}
                      onClick={() => window.open(f.url, "_blank", "noopener,noreferrer")}
                      sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
                    >
                      Open
                    </Button>
                  ) : null}

                  <IconButton title="Remove" onClick={() => deleteFile(f)} disabled={busy}>
                    <DeleteRoundedIcon />
                  </IconButton>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Typography sx={{ opacity: 0.7, textAlign: "center", py: 4 }}>
            No attachments yet. Upload received emails, artwork, or photos here.
          </Typography>
        )}
      </Paper>

      <Snackbar
        open={snack.open}
        autoHideDuration={2500}
        onClose={() => setSnack((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snack.severity} sx={{ width: "100%" }}>
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
