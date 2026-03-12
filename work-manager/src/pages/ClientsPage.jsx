import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
} from "@mui/material";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";

import { db } from "../firebase/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

const emptyForm = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  clientTypeId: "",
};

function normalize(s) {
  return (s || "").toString().trim();
}

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [clientTypes, setClientTypes] = useState([]);
  const [loadingErr, setLoadingErr] = useState("");
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [busy, setBusy] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  useEffect(() => {
    const qc = query(collection(db, "clients"), orderBy("companyName", "asc"));
    const unsubC = onSnapshot(
      qc,
      (snap) => {
        setLoadingErr("");
        setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error(err);
        setLoadingErr(err?.message || "Failed to load clients");
      }
    );

    const qt = query(collection(db, "clientTypes"), orderBy("sortOrder", "asc"));
    const unsubT = onSnapshot(
      qt,
      (snap) => setClientTypes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error(err)
    );

    return () => {
      unsubC();
      unsubT();
    };
  }, []);

  const typeMap = useMemo(() => {
    const m = {};
    for (const t of clientTypes) m[t.id] = t;
    return m;
  }, [clientTypes]);

  const filtered = useMemo(() => {
    const s = normalize(search).toLowerCase();
    if (!s) return clients;

    return clients.filter((c) => {
      const typeName = typeMap[c.clientTypeId]?.name || "";
      const hay = [c.companyName, c.contactName, c.email, c.phone, c.address, typeName]
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [clients, search, typeMap]);

  const openCreate = () => {
    const defaultType = clientTypes.find((t) => (t.name || "").toLowerCase() === "general") || clientTypes[0];
    setEditingId(null);
    setForm({ ...emptyForm, clientTypeId: defaultType?.id || "" });
    setDialogOpen(true);
  };

  const openEdit = (client) => {
    setEditingId(client.id);
    setForm({
      companyName: client.companyName || "",
      contactName: client.contactName || "",
      email: client.email || "",
      phone: client.phone || "",
      address: client.address || "",
      notes: client.notes || "",
      clientTypeId: client.clientTypeId || "",
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (busy) return;
    setDialogOpen(false);
  };

  const saveClient = async () => {
    const companyName = normalize(form.companyName);
    if (!companyName) {
      setSnack({ open: true, msg: "Company name is required.", severity: "error" });
      return;
    }

    const typeId = normalize(form.clientTypeId);
    const type = typeId ? typeMap[typeId] : null;

    const payload = {
      companyName,
      contactName: normalize(form.contactName),
      email: normalize(form.email),
      phone: normalize(form.phone),
      address: normalize(form.address),
      notes: normalize(form.notes),
      clientTypeId: typeId || "",
      clientTypeName: type?.name || "",
      updatedAt: serverTimestamp(),
    };

    setBusy(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, "clients", editingId), payload);
        setSnack({ open: true, msg: "Client updated.", severity: "success" });
      } else {
        await addDoc(collection(db, "clients"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        setSnack({ open: true, msg: "Client created.", severity: "success" });
      }
      setDialogOpen(false);
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Save failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "clients", confirmDelete.id));
      setSnack({ open: true, msg: "Client deleted.", severity: "success" });
      setConfirmDelete(null);
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Delete failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
            Clients
          </Typography>
          <Typography sx={{ opacity: 0.8 }}>
            Clients include a type (General / Trade / Trade+ etc.) for automatic discounts.
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={openCreate}
          sx={{ borderRadius: 2, textTransform: "none", fontWeight: 800 }}
        >
          New Client
        </Button>
      </Stack>

      {loadingErr && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadingErr}
        </Alert>
      )}

      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
          <TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} fullWidth />
          <Box sx={{ minWidth: 180, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <Typography sx={{ opacity: 0.8 }}>
              {filtered.length} client{filtered.length === 1 ? "" : "s"}
            </Typography>
          </Box>
        </Stack>

        <Divider sx={{ mb: 1 }} />

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 900 }}>Company</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Contact</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Email</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Phone</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id} hover>
                <TableCell sx={{ fontWeight: 800 }}>{c.companyName || ""}</TableCell>
                <TableCell>{typeMap[c.clientTypeId]?.name || c.clientTypeName || ""}</TableCell>
                <TableCell>{c.contactName || ""}</TableCell>
                <TableCell>{c.email || ""}</TableCell>
                <TableCell>{c.phone || ""}</TableCell>
                <TableCell>
                  <IconButton onClick={() => openEdit(c)} size="small" title="Edit">
                    <EditRoundedIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    onClick={() => setConfirmDelete({ id: c.id, companyName: c.companyName || "this client" })}
                    size="small"
                    title="Delete"
                  >
                    <DeleteRoundedIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 4 }}>
                  <Typography sx={{ opacity: 0.7, textAlign: "center" }}>
                    No clients yet. Click <strong>New Client</strong> to add your first.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>{editingId ? "Edit Client" : "New Client"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Company Name *"
              value={form.companyName}
              onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))}
              fullWidth
              autoFocus
            />

            <FormControl fullWidth>
              <InputLabel>Client Type</InputLabel>
              <Select
                label="Client Type"
                value={form.clientTypeId}
                onChange={(e) => setForm((p) => ({ ...p, clientTypeId: e.target.value }))}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {clientTypes
                  .filter((t) => t.active !== false)
                  .map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name} ({Number(t.discountPct || 0)}%)
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>

            <TextField
              label="Contact Name"
              value={form.contactName}
              onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))}
              fullWidth
            />

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
              multiline
              minRows={2}
            />

            <TextField
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              fullWidth
              multiline
              minRows={3}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeDialog} disabled={busy} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={saveClient}
            disabled={busy}
            sx={{ textTransform: "none", fontWeight: 800, borderRadius: 2 }}
          >
            {editingId ? "Save Changes" : "Create Client"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirmDelete} onClose={() => (busy ? null : setConfirmDelete(null))}>
        <DialogTitle sx={{ fontWeight: 900 }}>Delete client?</DialogTitle>
        <DialogContent dividers>
          <Typography>
            Delete <strong>{confirmDelete?.companyName}</strong>? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConfirmDelete(null)} disabled={busy} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={doDelete}
            disabled={busy}
            sx={{ textTransform: "none", fontWeight: 800, borderRadius: 2 }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
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
