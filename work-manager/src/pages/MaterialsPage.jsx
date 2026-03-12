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
  OutlinedInput,
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
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import ShoppingCartCheckoutRoundedIcon from "@mui/icons-material/ShoppingCartCheckoutRounded";

import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../firebase/firebase";
import {
  APPLICABLE_TO_OPTIONS,
  MATERIAL_GROUPS,
  MATERIAL_STATUS_OPTIONS,
  MATERIAL_TYPES,
  PURCHASE_UNITS,
  STOCK_UNITS,
  getApplicableToLabel,
  getMaterialGroupLabel,
  getMaterialTypeLabel,
  getMaterialTypeMeta,
  getPurchaseUnitLabel,
  getStockUnitLabel,
} from "../constants/materials";
import useSuppliers from "../hooks/useSuppliers";
import {
  buildMaterialPayload,
  getDefaultMaterialForm,
  getInitialMaterialForm,
  isLowStock,
  normalizeMaterialRecord,
  sortMaterials,
} from "../utils/materials";
import { getSupplierDisplayName } from "../utils/suppliers";
import {
  buildDraftPurchaseOrderPayload,
  buildPurchaseOrderLineFromMaterial,
} from "../utils/purchaseOrders";

const APPLICABLE_TO_SELECT_PROPS = {
  PaperProps: {
    sx: {
      maxHeight: 320,
    },
  },
};

function currency(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `$${number.toFixed(2)}`;
}

function getDimensionsSummary(material) {
  const dimensions = material?.dimensions || {};
  const parts = [];

  if (dimensions.widthMm) parts.push(`${dimensions.widthMm}mm W`);
  if (dimensions.lengthM) parts.push(`${dimensions.lengthM}m L`);
  if (dimensions.sheetWidthMm && dimensions.sheetHeightMm) {
    parts.push(`${dimensions.sheetWidthMm} x ${dimensions.sheetHeightMm}mm`);
  }
  if (dimensions.gsm) parts.push(`${dimensions.gsm}gsm`);
  if (dimensions.thicknessMicron) parts.push(`${dimensions.thicknessMicron}μm`);

  return parts.length ? parts.join(" • ") : "—";
}

function getSelectedSupplier(suppliers = [], supplierId = "") {
  return suppliers.find((supplier) => supplier.id === supplierId) || null;
}

export default function MaterialsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const [form, setForm] = useState(getDefaultMaterialForm());
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [orderingMaterial, setOrderingMaterial] = useState(null);
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [orderUnitCost, setOrderUnitCost] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [creatingPo, setCreatingPo] = useState(false);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [supplierFilter, setSupplierFilter] = useState("all");

  const {
    suppliers,
    loading: suppliersLoading,
    error: suppliersError,
    refreshSuppliers,
  } = useSuppliers();

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const snapshot = await getDocs(collection(db, "materials"));
      const items = snapshot.docs.map((snap) =>
        normalizeMaterialRecord(snap.id, snap.data())
      );

      setMaterials(sortMaterials(items));
    } catch (err) {
      console.error("Failed to load materials:", err);
      setError(err?.message || "Failed to load materials.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  const filteredMaterials = useMemo(() => {
    const term = String(search || "").trim().toLowerCase();

    return materials.filter((material) => {
      const matchesSearch =
        !term ||
        String(material.name || "").toLowerCase().includes(term) ||
        String(material.supplierName || material.supplier || "")
          .toLowerCase()
          .includes(term) ||
        String(material.brand || "").toLowerCase().includes(term) ||
        String(material.sku || "").toLowerCase().includes(term) ||
        String(material.supplierSku || "").toLowerCase().includes(term);

      const matchesType =
        typeFilter === "all" || material.materialType === typeFilter;

      const matchesStatus =
        statusFilter === "all" || material.status === statusFilter;

      const matchesSupplier =
        supplierFilter === "all" || material.supplierId === supplierFilter;

      return matchesSearch && matchesType && matchesStatus && matchesSupplier;
    });
  }, [materials, search, typeFilter, statusFilter, supplierFilter]);

  const totalCount = materials.length;
  const activeCount = materials.filter((item) => item.status === "active").length;
  const lowStockCount = materials.filter((item) => isLowStock(item)).length;
  const linkedSupplierCount = materials.filter((item) => item.supplierId).length;

  const handleOpenCreate = () => {
    setEditingMaterial(null);
    setForm(getDefaultMaterialForm());
    setDialogOpen(true);
  };

  const handleOpenEdit = (material) => {
    setEditingMaterial(material);
    setForm(getInitialMaterialForm(material));
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setEditingMaterial(null);
    setForm(getDefaultMaterialForm());
  };

  const handleOpenOrderDialog = (material) => {
    setOrderingMaterial(material);
    setOrderQuantity(
      material?.preferredOrderQty ? String(material.preferredOrderQty) : "1"
    );
    setOrderUnitCost(
      material?.lastCost !== "" && material?.lastCost !== null && material?.lastCost !== undefined
        ? String(material.lastCost)
        : material?.pricing?.costPerUnit
        ? String(material.pricing.costPerUnit)
        : ""
    );
    setOrderNotes("");
    setOrderDialogOpen(true);
  };

  const handleCloseOrderDialog = () => {
    if (creatingPo) return;
    setOrderDialogOpen(false);
    setOrderingMaterial(null);
    setOrderQuantity("1");
    setOrderUnitCost("");
    setOrderNotes("");
  };

  const handleFieldChange = (field) => (event) => {
    const value = event.target.value;

    setForm((prev) => {
      const next = {
        ...prev,
        [field]: value,
      };

      if (field === "materialType") {
        const meta = getMaterialTypeMeta(value);
        next.materialGroup = meta.group;

        if (value === "sheet_media") {
          if (!prev.stockUnit || prev.stockUnit === "roll") next.stockUnit = "sheet";
          if (!prev.purchaseUnit || prev.purchaseUnit === "roll") {
            next.purchaseUnit = "sheet";
          }
        }

        if (value === "roll_media" || value === "roll_laminate") {
          if (!prev.stockUnit || prev.stockUnit === "sheet") next.stockUnit = "roll";
          if (!prev.purchaseUnit || prev.purchaseUnit === "sheet") {
            next.purchaseUnit = "roll";
          }
        }

        if (value === "fixing" || value === "item") {
          if (!prev.stockUnit) next.stockUnit = "each";
          if (!prev.purchaseUnit) next.purchaseUnit = "each";
        }
      }

      if (field === "supplierId") {
        const selectedSupplier = getSelectedSupplier(suppliers, value);
        next.supplierId = value;
        next.supplierName = selectedSupplier?.name || "";
        next.supplier = selectedSupplier?.name || "";
      }

      return next;
    });
  };

  const handleNestedFieldChange = (section, field) => (event) => {
    const value = event.target.value;

    setForm((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  };

  const handleApplicableToChange = (event) => {
    const value = event.target.value;

    setForm((prev) => ({
      ...prev,
      applicableTo: typeof value === "string" ? value.split(",") : value,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = buildMaterialPayload(form);

      if (!payload.name) {
        throw new Error("Material name is required.");
      }

      if (!payload.materialType) {
        throw new Error("Material type is required.");
      }

      if (!payload.stockUnit) {
        throw new Error("Stock unit is required.");
      }

      if (!payload.purchaseUnit) {
        throw new Error("Purchase unit is required.");
      }

      if (
        payload.materialType === "roll_laminate" &&
        (!payload.applicableTo || !payload.applicableTo.length)
      ) {
        throw new Error(
          "Roll laminate should have at least one Applicable To selection."
        );
      }

      if (editingMaterial) {
        await updateDoc(doc(db, "materials", editingMaterial.id), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        setSuccess("Material updated.");
      } else {
        await addDoc(collection(db, "materials"), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setSuccess("Material created.");
      }

      handleCloseDialog();
      await loadMaterials();
    } catch (err) {
      console.error("Failed to save material:", err);
      setError(err?.message || "Failed to save material.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateDraftPo = async () => {
    setCreatingPo(true);
    setError("");
    setSuccess("");

    try {
      if (!orderingMaterial) {
        throw new Error("No material selected for ordering.");
      }

      const supplier = getSelectedSupplier(suppliers, orderingMaterial.supplierId);
      if (!supplier) {
        throw new Error("This material does not have a linked supplier yet.");
      }

      const line = buildPurchaseOrderLineFromMaterial(orderingMaterial, {
        quantity: orderQuantity,
        unitCost: orderUnitCost,
        notes: orderNotes,
      });

      const payload = buildDraftPurchaseOrderPayload({
        supplier,
        lines: [line],
        currentUser: auth.currentUser,
        notes: orderNotes,
      });

      await addDoc(collection(db, "purchaseOrders"), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSuccess(
        `Draft purchase order created for ${supplier.name} using ${orderingMaterial.name}.`
      );
      handleCloseOrderDialog();
    } catch (err) {
      console.error("Failed to create draft purchase order:", err);
      setError(err?.message || "Failed to create draft purchase order.");
    } finally {
      setCreatingPo(false);
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
                <Inventory2RoundedIcon />
                <Typography variant="h5" fontWeight={700}>
                  Materials
                </Typography>
              </Stack>

              <Typography color="text.secondary">
                Flexible material types with supplier linking and purchasing fields,
                ready for draft purchase orders.
              </Typography>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`Total: ${totalCount}`} variant="outlined" />
                <Chip label={`Active: ${activeCount}`} variant="outlined" />
                <Chip
                  label={`Low stock: ${lowStockCount}`}
                  color={lowStockCount ? "warning" : "default"}
                  variant="outlined"
                />
                <Chip
                  label={`Linked suppliers: ${linkedSupplierCount}`}
                  color={linkedSupplierCount ? "info" : "default"}
                  variant="outlined"
                />
              </Stack>
            </Stack>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={() => {
                  loadMaterials();
                  refreshSuppliers();
                }}
                disabled={loading || saving || suppliersLoading}
              >
                Refresh
              </Button>

              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={handleOpenCreate}
                disabled={loading || saving}
              >
                Add Material
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
              label="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              fullWidth
            />

            <FormControl fullWidth>
              <InputLabel id="type-filter-label">Type</InputLabel>
              <Select
                labelId="type-filter-label"
                value={typeFilter}
                label="Type"
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <MenuItem value="all">All Types</MenuItem>
                {MATERIAL_TYPES.map((item) => (
                  <MenuItem key={item.value} value={item.value}>
                    {item.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="supplier-filter-label">Supplier</InputLabel>
              <Select
                labelId="supplier-filter-label"
                value={supplierFilter}
                label="Supplier"
                onChange={(event) => setSupplierFilter(event.target.value)}
              >
                <MenuItem value="all">All Suppliers</MenuItem>
                {suppliers.map((supplier) => (
                  <MenuItem key={supplier.id} value={supplier.id}>
                    {getSupplierDisplayName(supplier)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="status-filter-label">Status</InputLabel>
              <Select
                labelId="status-filter-label"
                value={statusFilter}
                label="Status"
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <MenuItem value="all">All Statuses</MenuItem>
                {MATERIAL_STATUS_OPTIONS.map((item) => (
                  <MenuItem key={item.value} value={item.value}>
                    {item.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Paper>

        {suppliersError ? <Alert severity="warning">{suppliersError}</Alert> : null}
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
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Supplier</TableCell>
                    <TableCell>Applicable To</TableCell>
                    <TableCell>Units</TableCell>
                    <TableCell>Stock</TableCell>
                    <TableCell>Last Cost</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {filteredMaterials.map((material) => {
                    const lowStock = isLowStock(material);

                    return (
                      <TableRow key={material.id} hover>
                        <TableCell>
                          <Stack spacing={0.5}>
                            <Typography fontWeight={600}>
                              {material.name || "Unnamed material"}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {getDimensionsSummary(material)}
                            </Typography>
                          </Stack>
                        </TableCell>

                        <TableCell>
                          <Stack spacing={0.75}>
                            <Chip
                              size="small"
                              label={
                                material.materialType === "other" && material.customTypeLabel
                                  ? material.customTypeLabel
                                  : getMaterialTypeLabel(material.materialType)
                              }
                              variant="outlined"
                              sx={{ width: "fit-content" }}
                            />
                            <Typography variant="body2" color="text.secondary">
                              {getMaterialGroupLabel(material.materialGroup)}
                            </Typography>
                          </Stack>
                        </TableCell>

                        <TableCell>
                          <Stack spacing={0.5}>
                            <Typography variant="body2" fontWeight={500}>
                              {material.supplierName || "—"}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {material.supplierSku || material.sku || "—"}
                            </Typography>
                          </Stack>
                        </TableCell>

                        <TableCell>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                            {material.applicableTo?.length ? (
                              material.applicableTo.map((item) => (
                                <Chip
                                  key={`${material.id}-${item}`}
                                  size="small"
                                  label={getApplicableToLabel(item)}
                                  variant="outlined"
                                />
                              ))
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                —
                              </Typography>
                            )}
                          </Stack>
                        </TableCell>

                        <TableCell>
                          <Typography variant="body2">
                            Stock: {getStockUnitLabel(material.stockUnit)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Buy: {getPurchaseUnitLabel(material.purchaseUnit)}
                          </Typography>
                        </TableCell>

                        <TableCell>
                          <Stack spacing={0.5}>
                            <Typography variant="body2">
                              On hand: {material.stock?.onHand || 0}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Reorder: {material.stock?.reorderLevel || 0}
                            </Typography>
                            {lowStock ? (
                              <Chip
                                size="small"
                                label="Low stock"
                                color="warning"
                                variant="outlined"
                                sx={{ width: "fit-content" }}
                              />
                            ) : null}
                          </Stack>
                        </TableCell>

                        <TableCell>
                          <Typography variant="body2">
                            Last: {currency(material.lastCost)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Sell: {currency(material.pricing?.sellPerUnit)}
                          </Typography>
                        </TableCell>

                        <TableCell>
                          <Chip
                            size="small"
                            label={material.status || "active"}
                            color={
                              material.status === "active"
                                ? "success"
                                : material.status === "inactive"
                                ? "default"
                                : "warning"
                            }
                            variant="outlined"
                          />
                        </TableCell>

                        <TableCell align="right">
                          <Stack
                            direction={{ xs: "column", sm: "row" }}
                            spacing={1}
                            justifyContent="flex-end"
                            alignItems={{ xs: "stretch", sm: "center" }}
                          >
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<EditRoundedIcon />}
                              onClick={() => handleOpenEdit(material)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<ShoppingCartCheckoutRoundedIcon />}
                              onClick={() => handleOpenOrderDialog(material)}
                              disabled={!material.supplierId}
                            >
                              Draft PO
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {!filteredMaterials.length && (
                    <TableRow>
                      <TableCell colSpan={9}>
                        <Box sx={{ py: 5, textAlign: "center" }}>
                          <Typography color="text.secondary">
                            No materials found.
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
          {editingMaterial ? `Edit ${editingMaterial.name}` : "Add Material"}
        </DialogTitle>

        <DialogContent dividers>
          <Stack spacing={3} sx={{ pt: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Basic Details
            </Typography>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="Material Name"
                value={form.name}
                onChange={handleFieldChange("name")}
                fullWidth
                required
              />

              <FormControl fullWidth>
                <InputLabel id="material-type-label">Material Type</InputLabel>
                <Select
                  labelId="material-type-label"
                  value={form.materialType}
                  label="Material Type"
                  onChange={handleFieldChange("materialType")}
                >
                  {MATERIAL_TYPES.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            {form.materialType === "other" ? (
              <TextField
                label="Custom Type Label"
                value={form.customTypeLabel}
                onChange={handleFieldChange("customTypeLabel")}
                fullWidth
              />
            ) : null}

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel id="material-group-label">Material Group</InputLabel>
                <Select
                  labelId="material-group-label"
                  value={form.materialGroup}
                  label="Material Group"
                  onChange={handleFieldChange("materialGroup")}
                >
                  {MATERIAL_GROUPS.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel id="material-status-label">Status</InputLabel>
                <Select
                  labelId="material-status-label"
                  value={form.status}
                  label="Status"
                  onChange={handleFieldChange("status")}
                >
                  {MATERIAL_STATUS_OPTIONS.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <FormControl fullWidth>
              <InputLabel id="applicable-to-label">Applicable To</InputLabel>
              <Select
                labelId="applicable-to-label"
                multiple
                value={form.applicableTo}
                onChange={handleApplicableToChange}
                input={<OutlinedInput label="Applicable To" />}
                renderValue={(selected) =>
                  selected.map((value) => getApplicableToLabel(value)).join(", ")
                }
                MenuProps={APPLICABLE_TO_SELECT_PROPS}
              >
                {APPLICABLE_TO_OPTIONS.map((item) => (
                  <MenuItem key={item.value} value={item.value}>
                    {item.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Typography variant="subtitle1" fontWeight={700}>
              Supplier & Purchasing
            </Typography>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel id="supplier-id-label">Supplier</InputLabel>
                <Select
                  labelId="supplier-id-label"
                  value={form.supplierId}
                  label="Supplier"
                  onChange={handleFieldChange("supplierId")}
                >
                  <MenuItem value="">No linked supplier</MenuItem>
                  {suppliers.map((supplier) => (
                    <MenuItem key={supplier.id} value={supplier.id}>
                      {getSupplierDisplayName(supplier)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Supplier SKU"
                value={form.supplierSku}
                onChange={handleFieldChange("supplierSku")}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="Brand"
                value={form.brand}
                onChange={handleFieldChange("brand")}
                fullWidth
              />
              <TextField
                label="Internal SKU"
                value={form.sku}
                onChange={handleFieldChange("sku")}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="Preferred Order Qty"
                type="number"
                value={form.preferredOrderQty}
                onChange={handleFieldChange("preferredOrderQty")}
                fullWidth
              />
              <TextField
                label="Minimum Order Qty"
                type="number"
                value={form.minimumOrderQty}
                onChange={handleFieldChange("minimumOrderQty")}
                fullWidth
              />
              <TextField
                label="Last Cost"
                type="number"
                value={form.lastCost}
                onChange={handleFieldChange("lastCost")}
                fullWidth
              />
            </Stack>

            {!suppliers.length ? (
              <Alert severity="info">
                No suppliers exist yet. Create suppliers in the new Suppliers page,
                then link materials to them here.
              </Alert>
            ) : null}

            <Typography variant="subtitle1" fontWeight={700}>
              Units
            </Typography>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel id="stock-unit-label">Stock Unit</InputLabel>
                <Select
                  labelId="stock-unit-label"
                  value={form.stockUnit}
                  label="Stock Unit"
                  onChange={handleFieldChange("stockUnit")}
                >
                  {STOCK_UNITS.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel id="purchase-unit-label">Purchase Unit</InputLabel>
                <Select
                  labelId="purchase-unit-label"
                  value={form.purchaseUnit}
                  label="Purchase Unit"
                  onChange={handleFieldChange("purchaseUnit")}
                >
                  {PURCHASE_UNITS.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <Typography variant="subtitle1" fontWeight={700}>
              Dimensions
            </Typography>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="Roll Width (mm)"
                type="number"
                value={form.dimensions.widthMm}
                onChange={handleNestedFieldChange("dimensions", "widthMm")}
                fullWidth
              />
              <TextField
                label="Roll Length (m)"
                type="number"
                value={form.dimensions.lengthM}
                onChange={handleNestedFieldChange("dimensions", "lengthM")}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="Sheet Width (mm)"
                type="number"
                value={form.dimensions.sheetWidthMm}
                onChange={handleNestedFieldChange("dimensions", "sheetWidthMm")}
                fullWidth
              />
              <TextField
                label="Sheet Height (mm)"
                type="number"
                value={form.dimensions.sheetHeightMm}
                onChange={handleNestedFieldChange("dimensions", "sheetHeightMm")}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="GSM"
                type="number"
                value={form.dimensions.gsm}
                onChange={handleNestedFieldChange("dimensions", "gsm")}
                fullWidth
              />
              <TextField
                label="Thickness (micron)"
                type="number"
                value={form.dimensions.thicknessMicron}
                onChange={handleNestedFieldChange("dimensions", "thicknessMicron")}
                fullWidth
              />
            </Stack>

            <Typography variant="subtitle1" fontWeight={700}>
              Pricing
            </Typography>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="Cost Per Unit"
                type="number"
                value={form.pricing.costPerUnit}
                onChange={handleNestedFieldChange("pricing", "costPerUnit")}
                fullWidth
              />
              <TextField
                label="Sell Per Unit"
                type="number"
                value={form.pricing.sellPerUnit}
                onChange={handleNestedFieldChange("pricing", "sellPerUnit")}
                fullWidth
              />
              <TextField
                label="Wastage %"
                type="number"
                value={form.pricing.wastagePercent}
                onChange={handleNestedFieldChange("pricing", "wastagePercent")}
                fullWidth
              />
            </Stack>

            <Typography variant="subtitle1" fontWeight={700}>
              Stock
            </Typography>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="On Hand"
                type="number"
                value={form.stock.onHand}
                onChange={handleNestedFieldChange("stock", "onHand")}
                fullWidth
              />
              <TextField
                label="Reorder Level"
                type="number"
                value={form.stock.reorderLevel}
                onChange={handleNestedFieldChange("stock", "reorderLevel")}
                fullWidth
              />
            </Stack>

            <Typography variant="subtitle1" fontWeight={700}>
              Notes
            </Typography>

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
            {saving ? "Saving..." : editingMaterial ? "Save Changes" : "Create Material"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={orderDialogOpen}
        onClose={handleCloseOrderDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {orderingMaterial ? `Create Draft PO for ${orderingMaterial.name}` : "Create Draft PO"}
        </DialogTitle>

        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {orderingMaterial && (
              <Alert severity="info">
                Supplier: {orderingMaterial.supplierName || "No linked supplier"}
              </Alert>
            )}

            <TextField
              label="Order Quantity"
              type="number"
              value={orderQuantity}
              onChange={(event) => setOrderQuantity(event.target.value)}
              fullWidth
            />

            <TextField
              label="Unit Cost"
              type="number"
              value={orderUnitCost}
              onChange={(event) => setOrderUnitCost(event.target.value)}
              fullWidth
            />

            <TextField
              label="Notes"
              value={orderNotes}
              onChange={(event) => setOrderNotes(event.target.value)}
              multiline
              minRows={3}
              fullWidth
            />
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleCloseOrderDialog} disabled={creatingPo}>
            Cancel
          </Button>
          <Button onClick={handleCreateDraftPo} variant="contained" disabled={creatingPo}>
            {creatingPo ? "Creating..." : "Create Draft PO"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
