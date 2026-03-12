import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import LocalShippingRoundedIcon from "@mui/icons-material/LocalShippingRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";

import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import {
  buildSupplierPayload,
  getDefaultSupplierForm,
  getInitialSupplierForm,
  getSupplierDisplayName,
  normalizeSupplierRecord,
  sortSuppliers,
} from "../utils/suppliers";

const SUPPLIER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export default function SuppliersPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [form, setForm] = useState(getDefaultSupplierForm());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const snapshot = await getDocs(collection(db, "suppliers"));
      const rows = snapshot.docs.map((snap) =>
        normalizeSupplierRecord(snap.id, snap.data())
      );

      setSuppliers(sortSuppliers(rows));
    } catch (err) {
      console.error("Failed to load suppliers:", err);
      setError(err?.message || "Failed to load suppliers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  const filteredSuppliers = useMemo(() => {
    const term = String(search || "").trim().toLowerCase();

    return suppliers.filter((supplier) => {
      const matchesSearch =
        !term ||
        String(supplier.name || "").toLowerCase().includes(term) ||
        String(supplier.code || "").toLowerCase().includes(term) ||
        String(supplier.contactName || "").toLowerCase().includes(term) ||
        String(supplier.email || "").toLowerCase().includes(term) ||
        String(supplier.phone || "").toLowerCase().includes(term);

      const matchesStatus =
        statusFilter === "all" || supplier.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [suppliers, search, statusFilter]);

  const activeCount = suppliers.filter((item) => item.status === "active").length;

  const handleOpenCreate = () => {
    setEditingSupplier(null);
    setForm(getDefaultSupplierForm());
    setDialogOpen(true);
  };

  const handleOpenEdit = (supplier) => {
    setEditingSupplier(supplier);
    setForm(getInitialSupplierForm(supplier));
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setEditingSupplier(null);
    setForm(getDefaultSupplierForm());
  };

  const handleFieldChange = (field) => (event) => {
    setForm((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = buildSupplierPayload(form);

      if (!payload.name) {
        throw new Error("Supplier name is required.");
      }

      const duplicateName = suppliers.find(
        (supplier) =>
          supplier.nameLower === payload.nameLower && supplier.id !== editingSupplier?.id
      );

      if (duplicateName) {
        throw new Error("A supplier with that name already exists.");
      }

      if (payload.codeUpper) {
        const duplicateCode = suppliers.find(
          (supplier) =>
            supplier.codeUpper === payload.codeUpper && supplier.id !== editingSupplier?.id
        );

        if (duplicateCode) {
          throw new Error("A supplier with that code already exists.");
        }
      }

      if (editingSupplier) {
        await updateDoc(doc(db, "suppliers", editingSupplier.id), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        setSuccess("Supplier updated.");
      } else {
        await addDoc(collection(db, "suppliers"), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setSuccess("Supplier created.");
      }

      handleCloseDialog();
      await loadSuppliers();
    } catch (err) {
      console.error("Failed to save supplier:", err);
      setError(err?.message || "Failed to save supplier.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Paper
          elevation={0}
          sx={{
            p: 3,
            borderRadius: 3,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <Stack
            direction={{ xs: "column", lg: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", lg: "center" }}
          >
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <LocalShippingRoundedIcon />
                <Typography variant="h5" fontWeight={700}>
                  Suppliers
                </Typography>
              </Stack>

              <Typography color="text.secondary">
                Directory of purchasing suppliers used by materials and purchase
                orders.
              </Typography>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`Total: ${suppliers.length}`} variant="outlined" />
                <Chip label={`Active: ${activeCount}`} variant="outlined" />
              </Stack>
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={loadSuppliers}
                disabled={loading || saving}
              >
                Refresh
              </Button>
              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={handleOpenCreate}
                disabled={loading || saving}
              >
                Add Supplier
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: 3,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField
              label="Search suppliers"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              fullWidth
            />

            <FormControl fullWidth>
              <InputLabel id="supplier-status-filter-label">Status</InputLabel>
              <Select
                labelId="supplier-status-filter-label"
                value={statusFilter}
                label="Status"
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <MenuItem value="all">All Statuses</MenuItem>
                {SUPPLIER_STATUS_OPTIONS.map((item) => (
                  <MenuItem key={item.value} value={item.value}>
                    {item.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Paper>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {success ? <Alert severity="success">{success}</Alert> : null}

        <Paper
          elevation={0}
          sx={{
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          {loading ? (
            <Box sx={{ py: 8, display: "flex", justifyContent: "center" }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Supplier</TableCell>
                    <TableCell>Contact</TableCell>
                    <TableCell>Lead Time</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {filteredSuppliers.map((supplier) => (
                    <TableRow key={supplier.id} hover>
                      <TableCell>
                        <Stack spacing={0.5}>
                          <Typography fontWeight={600}>
                            {getSupplierDisplayName(supplier)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {supplier.address || "—"}
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell>
                        <Stack spacing={0.5}>
                          <Typography variant="body2">
                            {supplier.contactName || "—"}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {supplier.email || "—"}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {supplier.phone || "—"}
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell>
                        {supplier.defaultLeadTimeDays || 0} day
                        {Number(supplier.defaultLeadTimeDays || 0) === 1 ? "" : "s"}
                      </TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          label={supplier.status || "active"}
                          color={supplier.status === "active" ? "success" : "default"}
                          variant="outlined"
                        />
                      </TableCell>

                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<EditRoundedIcon />}
                          onClick={() => handleOpenEdit(supplier)}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                  {!filteredSuppliers.length && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Box sx={{ py: 5, textAlign: "center" }}>
                          <Typography color="text.secondary">
                            No suppliers found.
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Stack>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} fullWidth maxWidth="md">
        <DialogTitle>
          {editingSupplier
            ? `Edit ${editingSupplier.name}`
            : "Add Supplier"}
        </DialogTitle>

        <DialogContent dividers>
          <Stack spacing={3} sx={{ pt: 1 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="Supplier Name"
                value={form.name}
                onChange={handleFieldChange("name")}
                fullWidth
                required
              />
              <TextField
                label="Code"
                value={form.code}
                onChange={handleFieldChange("code")}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="Contact Name"
                value={form.contactName}
                onChange={handleFieldChange("contactName")}
                fullWidth
              />
              <TextField
                label="Email"
                type="email"
                value={form.email}
                onChange={handleFieldChange("email")}
                fullWidth
              />
              <TextField
                label="Phone"
                value={form.phone}
                onChange={handleFieldChange("phone")}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="Website"
                value={form.website}
                onChange={handleFieldChange("website")}
                fullWidth
              />
              <TextField
                label="Default Lead Time (days)"
                type="number"
                value={form.defaultLeadTimeDays}
                onChange={handleFieldChange("defaultLeadTimeDays")}
                fullWidth
              />
            </Stack>

            <TextField
              label="Address"
              value={form.address}
              onChange={handleFieldChange("address")}
              fullWidth
              multiline
              minRows={2}
            />

            <FormControl fullWidth>
              <InputLabel id="supplier-status-label">Status</InputLabel>
              <Select
                labelId="supplier-status-label"
                value={form.status}
                label="Status"
                onChange={handleFieldChange("status")}
              >
                {SUPPLIER_STATUS_OPTIONS.map((item) => (
                  <MenuItem key={item.value} value={item.value}>
                    {item.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Notes"
              value={form.notes}
              onChange={handleFieldChange("notes")}
              fullWidth
              multiline
              minRows={4}
            />
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} variant="contained" disabled={saving}>
            {saving ? "Saving..." : editingSupplier ? "Save Changes" : "Create Supplier"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
