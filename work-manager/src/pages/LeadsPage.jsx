import React, { useEffect, useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";

import { db } from "../firebase/firebase";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { makeDocNumber } from "../utils/numbering";

const norm = (s) => (s || "").toString().trim().toLowerCase();

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

export default function LeadsPage() {
  const history = useHistory();

  const [leads, setLeads] = useState([]);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");

  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    companyName: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    description: "",
    source: "email",
    status: "new",
  });

  useEffect(() => {
    const qy = query(collection(db, "leads"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        setErr("");
        setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (e) => {
        console.error(e);
        setErr(e?.message || "Failed to load leads");
      }
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = norm(search);
    if (!s) return leads;
    return leads.filter((l) => {
      const a = `${l.leadNumber || ""} ${l.companyName || ""} ${l.contactName || ""} ${l.email || ""} ${l.phone || ""} ${l.description || ""}`;
      return norm(a).includes(s);
    });
  }, [leads, search]);

  const openCreate = () => {
    setForm({
      companyName: "",
      contactName: "",
      email: "",
      phone: "",
      address: "",
      description: "",
      source: "email",
      status: "new",
    });
    setCreateOpen(true);
  };

  const createLead = async () => {
    const companyName = (form.companyName || "").trim();
    const contactName = (form.contactName || "").trim();
    if (!companyName && !contactName) {
      setSnack({ open: true, msg: "Enter at least Company or Contact name.", severity: "error" });
      return;
    }

    setBusy(true);
    try {
      const leadNumber = makeDocNumber("LD");
      const payload = {
        leadNumber,
        status: form.status || "new",
        source: form.source || "email",

        companyName: companyName || "",
        contactName: contactName || "",
        email: (form.email || "").trim(),
        phone: (form.phone || "").trim(),
        address: (form.address || "").trim(),

        description: (form.description || "").trim(),

        // Links
        clientId: "",
        quoteId: "",
        quoteNumber: "",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const ref = await addDoc(collection(db, "leads"), payload);
      setSnack({ open: true, msg: "Lead created.", severity: "success" });
      setCreateOpen(false);
      history.push(`/leads/${ref.id}`);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to create lead");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
            Leads
          </Typography>
          <Typography sx={{ opacity: 0.8 }}>
            Log incoming enquiries (email/phone), attach files, then create a Quote.
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={openCreate}
          disabled={busy}
          sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}
        >
          New Lead
        </Button>
      </Stack>

      {err ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      ) : null}

      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
          <TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} fullWidth />
          <Box sx={{ minWidth: 180, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <Typography sx={{ opacity: 0.8 }}>{filtered.length} lead(s)</Typography>
          </Box>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack spacing={1.25}>
          {filtered.map((l) => (
            <Paper
              key={l.id}
              variant="outlined"
              sx={{ p: 1.5, borderRadius: 2, display: "flex", gap: 2, alignItems: "center" }}
            >
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontWeight: 900 }}>{l.leadNumber || "Lead"}</Typography>
                  {leadStatusChip(l.status)}
                  {l.quoteId ? <Chip size="small" label={`Quote ${l.quoteNumber || ""}`} variant="outlined" /> : null}
                </Stack>

                <Typography sx={{ opacity: 0.85 }}>
                  {l.companyName || "—"}
                  {l.contactName ? ` • ${l.contactName}` : ""}
                </Typography>

                <Typography sx={{ opacity: 0.7, fontSize: 12 }}>
                  {(l.email || "").trim()}
                  {l.phone ? ` • ${l.phone}` : ""}
                </Typography>
              </Box>

              <Button
                variant="outlined"
                endIcon={<OpenInNewRoundedIcon />}
                onClick={() => history.push(`/leads/${l.id}`)}
                sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
              >
                Open
              </Button>
            </Paper>
          ))}

          {filtered.length === 0 ? (
            <Typography sx={{ opacity: 0.7, textAlign: "center", py: 4 }}>
              No leads yet. Click <strong>New Lead</strong>.
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => (busy ? null : setCreateOpen(false))} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 900 }}>New Lead</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Company"
                value={form.companyName}
                onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))}
                fullWidth
                autoFocus
              />
              <TextField
                label="Contact"
                value={form.contactName}
                onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                fullWidth
              />
              <TextField
                label="Phone"
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                fullWidth
              />
            </Stack>

            <TextField
              label="Address"
              value={form.address}
              onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
              fullWidth
            />

            <TextField
              label="Rough job details"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              fullWidth
              multiline
              minRows={3}
            />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel>Source</InputLabel>
                <Select
                  label="Source"
                  value={form.source}
                  onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))}
                >
                  <MenuItem value="email">Email</MenuItem>
                  <MenuItem value="phone">Phone</MenuItem>
                  <MenuItem value="walk_in">Walk-in</MenuItem>
                  <MenuItem value="web">Web</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status"
                  value={form.status}
                  onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                >
                  <MenuItem value="new">New</MenuItem>
                  <MenuItem value="quoting">Quoting</MenuItem>
                  <MenuItem value="quoted">Quoted</MenuItem>
                  <MenuItem value="won">Won</MenuItem>
                  <MenuItem value="lost">Lost</MenuItem>
                  <MenuItem value="on_hold">On Hold</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={busy} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={createLead}
            disabled={busy}
            sx={{ textTransform: "none", fontWeight: 900, borderRadius: 2 }}
          >
            Create Lead
          </Button>
        </DialogActions>
      </Dialog>

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
