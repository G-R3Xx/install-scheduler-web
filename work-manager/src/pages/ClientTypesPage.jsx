import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";

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

const normalize = (s) => (s || "").toString().trim();
const num = (x, fallback = 0) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
};

const emptyForm = {
  name: "",
  discountPct: 0,
  active: true,
  sortOrder: 100,
};

export default function ClientTypesPage() {
  const [items, setItems] = useState([]);
  const [loadingErr, setLoadingErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  useEffect(() => {
    const q = query(collection(db, "clientTypes"), orderBy("sortOrder", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoadingErr("");
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error(err);
        setLoadingErr(err?.message || "Failed to load client types");
      }
    );
    return () => unsub();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const openEdit = (t) => {
    setEditingId(t.id);
    setForm({
      name: t.name || "",
      discountPct: num(t.discountPct, 0),
      active: t.active !== false,
      sortOrder: num(t.sortOrder, 100),
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (busy) return;
    setDialogOpen(false);
  };

  const save = async () => {
    const name = normalize(form.name);
    if (!name) {
      setSnack({ open: true, msg: "Type name is required.", severity: "error" });
      return;
    }

    const payload = {
      name,
      discountPct: Math.max(0, num(form.discountPct, 0)),
      active: !!form.active,
      sortOrder: Math.floor(num(form.sortOrder, 100)),
      updatedAt: serverTimestamp(),
    };

    setBusy(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, "clientTypes", editingId), payload);
        setSnack({ open: true, msg: "Client type updated.", severity: "success" });
      } else {
        await addDoc(collection(db, "clientTypes"), { ...payload, createdAt: serverTimestamp() });
        setSnack({ open: true, msg: "Client type created.", severity: "success" });
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
      await deleteDoc(doc(db, "clientTypes", confirmDelete.id));
      setSnack({ open: true, msg: "Client type deleted.", severity: "success" });
      setConfirmDelete(null);
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Delete failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const createDefaults = async () => {
    setBusy(true);
    try {
      const existingNames = new Set(items.map((x) => (x.name || "").toLowerCase()));
      const defaults = [
        { name: "General", discountPct: 0, sortOrder: 10 },
        { name: "Trade", discountPct: 10, sortOrder: 20 },
        { name: "Trade +", discountPct: 15, sortOrder: 30 },
      ];

      for (const d of defaults) {
        if (existingNames.has(d.name.toLowerCase())) continue;
        await addDoc(collection(db, "clientTypes"), {
          ...d,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      setSnack({ open: true, msg: "Default client types created (where missing).", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Create defaults failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
            Client Types
          </Typography>
          <Typography sx={{ opacity: 0.8 }}>
            Pricing tiers (General / Trade / Trade+, etc.) with a default discount %.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<BoltRoundedIcon />}
            onClick={createDefaults}
            disabled={busy}
            sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}
          >
            Create Defaults
          </Button>
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={openCreate}
            disabled={busy}
            sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}
          >
            New Type
          </Button>
        </Stack>
      </Stack>

      {loadingErr && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadingErr}
        </Alert>
      )}

      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 900 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Discount %</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Sort</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Active</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((t) => (
              <TableRow key={t.id} hover>
                <TableCell sx={{ fontWeight: 900 }}>{t.name || ""}</TableCell>
                <TableCell>{num(t.discountPct, 0)}%</TableCell>
                <TableCell>{num(t.sortOrder, 100)}</TableCell>
                <TableCell>{t.active === false ? "No" : "Yes"}</TableCell>
                <TableCell>
                  <IconButton size="small" title="Edit" onClick={() => openEdit(t)}>
                    <EditRoundedIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    title="Delete"
                    onClick={() => setConfirmDelete({ id: t.id, name: t.name || "this type" })}
                  >
                    <DeleteRoundedIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}

            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} sx={{ py: 4 }}>
                  <Typography sx={{ opacity: 0.7, textAlign: "center" }}>
                    No client types yet. Click <strong>Create Defaults</strong> or <strong>New Type</strong>.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>{editingId ? "Edit Client Type" : "New Client Type"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Name *"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              fullWidth
              autoFocus
            />
            <TextField
              label="Discount (%)"
              value={form.discountPct}
              onChange={(e) => setForm((p) => ({ ...p, discountPct: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Sort order"
              value={form.sortOrder}
              onChange={(e) => setForm((p) => ({ ...p, sortOrder: e.target.value }))}
              fullWidth
              helperText="Lower numbers appear first."
            />
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch
                checked={!!form.active}
                onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
              />
              <Typography sx={{ fontWeight: 800 }}>Active</Typography>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeDialog} disabled={busy} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={busy}
            sx={{ textTransform: "none", fontWeight: 900, borderRadius: 2 }}
          >
            {editingId ? "Save" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirmDelete} onClose={() => (busy ? null : setConfirmDelete(null))}>
        <DialogTitle sx={{ fontWeight: 900 }}>Delete type?</DialogTitle>
        <DialogContent dividers>
          <Typography>
            Delete <strong>{confirmDelete?.name}</strong>? This cannot be undone.
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
            sx={{ textTransform: "none", fontWeight: 900, borderRadius: 2 }}
          >
            Delete
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
