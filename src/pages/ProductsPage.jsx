// ProductsPage.jsx (universal laminate support)
//
// Laminate materials can be used on BOTH sheet and roll products.
// The laminate dropdown is filtered by whether the material has the right cost:
// - Sheet products: laminate options are materials with costPerSheet > 0
// - Roll products:  laminate options are materials with costPerMetre > 0
//
// Base material lists are still restricted:
// - Sheet base materials must have costPerSheet > 0
// - Roll base materials must have costPerMetre > 0 and rollWidthMm > 0

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
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
  IconButton,
} from "@mui/material";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import AddCircleRoundedIcon from "@mui/icons-material/AddCircleRounded";

import { db } from "../firebase/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import {
  calcManualItem,
  calcSheetSignManualYield,
  calcRollPrintByMetre,
  getQtyDiscountPct,
} from "../services/pricingEngine";
import {
  getLaminateOptions,
  getLegacyCompatibleMaterial,
  getMaterialDisplayName,
  getRollBaseMaterials,
  getSheetBaseMaterials,
  supportsLaminateForBase,
} from "../utils/materialCompat";

const normalize = (s) => (s || "").toString().trim();
const num = (x, fallback = 0) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
};

const emptyForm = {
  name: "",
  category: "General",
  active: true,
  calculatorType: "manual_item",

  unitPrice: 0,

  widthMm: 600,
  heightMm: 900,
  sides: 1,
  minutesTrimPerUnit: 5,

  materialId: "",

  // sheet
  unitsPerSheet: 4,
  minSheetEquiv: 0.5,
  sheetStep: 0.5,
  laminateMaterialId: "",
  inkPerM2Override: 0,
  labourPerSheet: 0,

  // roll
  minMetres: 1,
  metreStep: 0.1,
  inkPerMetre: 0,
  labourPerMetre: 0,

  qtyDiscounts: [
    { minQty: 10, pct: 5 },
    { minQty: 50, pct: 10 },
  ],
};

function cleanQtyDiscounts(rows) {
  if (!Array.isArray(rows)) return [];
  const cleaned = rows
    .map((r) => ({
      minQty: Math.max(0, Math.floor(num(r?.minQty, 0))),
      pct: Math.max(0, num(r?.pct, 0)),
    }))
    .filter((r) => r.minQty > 0 && r.pct > 0);

  const map = {};
  for (const r of cleaned) map[r.minQty] = Math.max(map[r.minQty] || 0, r.pct);

  return Object.keys(map)
    .map((k) => ({ minQty: Number(k), pct: map[k] }))
    .sort((a, b) => a.minQty - b.minQty);
}

export default function ProductsPage() {
  const [rateCard, setRateCard] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [products, setProducts] = useState([]);
  const [loadingErr, setLoadingErr] = useState("");

  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [busy, setBusy] = useState(false);

  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });
  const [previewQty, setPreviewQty] = useState(10);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "rateCards", "default"));
        setRateCard(snap.exists() ? snap.data() : null);
      } catch (e) {
        console.error(e);
      }
    })();

    const unsubM = onSnapshot(
      query(collection(db, "materials"), orderBy("name", "asc")),
      (snap) => setMaterials(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => console.error(e)
    );

    const unsubP = onSnapshot(
      query(collection(db, "products"), orderBy("name", "asc")),
      (snap) => {
        setLoadingErr("");
        setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error(err);
        setLoadingErr(err?.message || "Failed to load products");
      }
    );

    return () => {
      unsubM();
      unsubP();
    };
  }, []);

  const filtered = useMemo(() => {
    const s = normalize(search).toLowerCase();
    if (!s) return products;
    return products.filter((p) => (p.name || "").toLowerCase().includes(s));
  }, [products, search]);

  const sheetBaseMaterials = useMemo(() => getSheetBaseMaterials(materials), [materials]);

  const rollBaseMaterials = useMemo(() => getRollBaseMaterials(materials), [materials]);

  const selectedBaseMaterial = useMemo(
    () => materials.find((m) => m.id === form.materialId) || null,
    [materials, form.materialId]
  );

  const sheetLaminateOptions = useMemo(
    () => getLaminateOptions(materials, selectedBaseMaterial || "sheet_media"),
    [materials, selectedBaseMaterial]
  );

  const rollLaminateOptions = useMemo(
    () => getLaminateOptions(materials, selectedBaseMaterial || "roll_media"),
    [materials, selectedBaseMaterial]
  );

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      materialId: sheetBaseMaterials[0]?.id || rollBaseMaterials[0]?.id || "",
      laminateMaterialId: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (p) => {
    setEditingId(p.id);
    const ct = p.calculatorType || "manual_item";
    const d = p.defaults || {};
    setForm({
      name: p.name || "",
      category: p.category || "General",
      active: p.active !== false,
      calculatorType: ct,
      unitPrice: num(p.unitPrice, 0),

      materialId: p.materialId || "",
      laminateMaterialId: p.laminateMaterialId || d.laminateMaterialId || "",

      widthMm: num(d.widthMm, 600),
      heightMm: num(d.heightMm, 900),
      sides: num(d.sides, 1),
      minutesTrimPerUnit: num(d.minutesTrimPerUnit, 5),

      unitsPerSheet: num(d.unitsPerSheet, 4),
      minSheetEquiv: num(d.minSheetEquiv, 0.5),
      sheetStep: num(d.sheetStep, 0.5),
      inkPerM2Override: num(d.inkPerM2Override, 0),
      labourPerSheet: num(d.labourPerSheet, 0),

      minMetres: num(d.minMetres, 1),
      metreStep: num(d.metreStep, 0.1),
      inkPerMetre: num(d.inkPerMetre, 0),
      labourPerMetre: num(d.labourPerMetre, 0),

      qtyDiscounts: Array.isArray(p.qtyDiscounts) ? p.qtyDiscounts : (d.qtyDiscounts || []),
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
      setSnack({ open: true, msg: "Product name is required.", severity: "error" });
      return;
    }

    const payload = {
      name,
      category: normalize(form.category) || "General",
      active: !!form.active,
      calculatorType: form.calculatorType,
      qtyDiscounts: cleanQtyDiscounts(form.qtyDiscounts),
      updatedAt: serverTimestamp(),
    };

    if (form.calculatorType === "manual_item") {
      payload.unitPrice = Math.max(0, num(form.unitPrice, 0));
      payload.materialId = "";
      payload.laminateMaterialId = "";
      payload.defaults = {};
    } else {
      const rawBaseMaterial = materials.find((m) => m.id === form.materialId) || null;
      const rawLaminateMaterial = materials.find((m) => m.id === form.laminateMaterialId) || null;

      payload.unitPrice = 0;
      payload.materialId = form.materialId || "";
      payload.laminateMaterialId = form.laminateMaterialId || "";
      payload.materialSelection = {
        primaryMaterialId: form.materialId || "",
        primaryType: rawBaseMaterial?.materialType || rawBaseMaterial?.type || "",
        laminateMaterialId: form.laminateMaterialId || "",
      };
      payload.materialType = rawBaseMaterial?.materialType || rawBaseMaterial?.type || "";
      payload.laminateMaterialType =
        rawLaminateMaterial?.materialType || rawLaminateMaterial?.type || "";

      payload.defaults = {
        widthMm: Math.max(0, Math.floor(num(form.widthMm, 0))),
        heightMm: Math.max(0, Math.floor(num(form.heightMm, 0))),
        sides: Math.max(1, Math.floor(num(form.sides, 1))),
        minutesTrimPerUnit: Math.max(0, num(form.minutesTrimPerUnit, 0)),
      };

      if (form.calculatorType === "sheet_sign_manual_yield") {
        payload.defaults.unitsPerSheet = Math.max(1, Math.floor(num(form.unitsPerSheet, 1)));
        payload.defaults.minSheetEquiv = Math.max(0, num(form.minSheetEquiv, 0.5));
        payload.defaults.sheetStep = Math.max(0.000001, num(form.sheetStep, 0.5));
        payload.defaults.laminateMaterialId = form.laminateMaterialId || "";
        payload.defaults.inkPerM2Override = Math.max(0, num(form.inkPerM2Override, 0));
        payload.defaults.labourPerSheet = Math.max(0, num(form.labourPerSheet, 0));
      }

      if (form.calculatorType === "roll_print_by_metre") {
        payload.defaults.laminateMaterialId = form.laminateMaterialId || "";
        payload.defaults.minMetres = Math.max(0, num(form.minMetres, 1));
        payload.defaults.metreStep = Math.max(0.000001, num(form.metreStep, 0.1));
        payload.defaults.inkPerMetre = Math.max(0, num(form.inkPerMetre, 0));
        payload.defaults.labourPerMetre = Math.max(0, num(form.labourPerMetre, 0));
      }
    }

    setBusy(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, "products", editingId), payload);
        setSnack({ open: true, msg: "Product updated.", severity: "success" });
      } else {
        await addDoc(collection(db, "products"), { ...payload, createdAt: serverTimestamp() });
        setSnack({ open: true, msg: "Product created.", severity: "success" });
      }
      setDialogOpen(false);
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Save failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (form.calculatorType === "sheet_sign_manual_yield") {
      const bm = materials.find((m) => m.id === form.materialId);
      if (!form.materialId || !sheetBaseMaterials.some((m) => m.id === bm?.id)) {
        setForm((p) => ({ ...p, materialId: sheetBaseMaterials[0]?.id || "" }));
      }

      const lm = materials.find((m) => m.id === form.laminateMaterialId);
      if (form.laminateMaterialId && !supportsLaminateForBase(lm, bm || "sheet_media")) {
        setForm((p) => ({ ...p, laminateMaterialId: "" }));
      }
    }

    if (form.calculatorType === "roll_print_by_metre") {
      const bm = materials.find((m) => m.id === form.materialId);
      if (!form.materialId || !rollBaseMaterials.some((m) => m.id === bm?.id)) {
        setForm((p) => ({ ...p, materialId: rollBaseMaterials[0]?.id || "" }));
      }

      const lm = materials.find((m) => m.id === form.laminateMaterialId);
      if (form.laminateMaterialId && !supportsLaminateForBase(lm, bm || "roll_media")) {
        setForm((p) => ({ ...p, laminateMaterialId: "" }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.calculatorType, materials.length]);

  const preview = useMemo(() => {
    if (!rateCard) return null;
    const qd = getQtyDiscountPct(previewQty, form.qtyDiscounts);

    const rawMat = materials.find((m) => m.id === form.materialId) || null;
    const rawLam = materials.find((m) => m.id === form.laminateMaterialId) || null;
    const mat =
      form.calculatorType === "roll_print_by_metre"
        ? getLegacyCompatibleMaterial(rawMat, "roll")
        : getLegacyCompatibleMaterial(rawMat, "sheet");
    const lam =
      form.calculatorType === "roll_print_by_metre"
        ? getLegacyCompatibleMaterial(rawLam, "roll")
        : getLegacyCompatibleMaterial(rawLam, "sheet");

    if (form.calculatorType === "manual_item") {
      return calcManualItem({ qty: previewQty, unitPrice: form.unitPrice, discountPct: qd, rateCard });
    }

    if (form.calculatorType === "sheet_sign_manual_yield") {
      return calcSheetSignManualYield({
        qty: previewQty,
        widthMm: form.widthMm,
        heightMm: form.heightMm,
        sides: form.sides,
        unitsPerSheet: form.unitsPerSheet,
        minutesTrimPerUnit: form.minutesTrimPerUnit,
        minSheetEquiv: form.minSheetEquiv,
        sheetStep: form.sheetStep,
        laminateMaterial: lam && supportsLaminateForBase(rawLam, rawMat || "sheet_media") ? lam : null,
        inkPerM2Override: form.inkPerM2Override,
        labourPerSheet: form.labourPerSheet,
        discountPct: qd,
        rateCard,
        material: mat,
      });
    }

    return calcRollPrintByMetre({
      qty: previewQty,
      widthMm: form.widthMm,
      heightMm: form.heightMm,
      sides: form.sides,
      minutesTrimPerUnit: form.minutesTrimPerUnit,
      minMetres: form.minMetres,
      metreStep: form.metreStep,
      inkPerMetre: form.inkPerMetre,
      labourPerMetre: form.labourPerMetre,
      discountPct: qd,
      rateCard,
      material: mat,
      laminateMaterial: lam && supportsLaminateForBase(rawLam, rawMat || "roll_media") ? lam : null,
    });
  }, [form, previewQty, rateCard, materials]);

  const addDiscountRow = () => setForm((p) => ({ ...p, qtyDiscounts: [...(p.qtyDiscounts || []), { minQty: 0, pct: 0 }] }));
  const removeDiscountRow = (idx) => setForm((p) => ({ ...p, qtyDiscounts: (p.qtyDiscounts || []).filter((_, i) => i !== idx) }));
  const updateDiscountRow = (idx, patch) => setForm((p) => ({ ...p, qtyDiscounts: (p.qtyDiscounts || []).map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
            Products
          </Typography>
          <Typography sx={{ opacity: 0.8 }}>
            Laminate materials can be universal (one material can work for sheet + roll).
          </Typography>
        </Box>

        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openCreate} sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}>
          New Product
        </Button>
      </Stack>

      {!rateCard && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No default rate card found. Go to <strong>Rate Card</strong> first to create defaults.
        </Alert>
      )}

      {loadingErr && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadingErr}
        </Alert>
      )}

      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
          <TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} fullWidth />
          <Box sx={{ minWidth: 180, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <Typography sx={{ opacity: 0.8 }}>{filtered.length} item(s)</Typography>
          </Box>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack spacing={1.25}>
          {filtered.map((p) => (
            <Paper key={p.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2, display: "flex", gap: 2, alignItems: "center" }}>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 900 }}>
                  {p.name} {p.active === false ? <span style={{ opacity: 0.6, fontWeight: 600 }}>(inactive)</span> : null}
                </Typography>
                <Typography sx={{ opacity: 0.75 }}>
                  {p.category || "General"} •{" "}
                  {p.calculatorType === "manual_item"
                    ? "Manual item"
                    : p.calculatorType === "roll_print_by_metre"
                    ? "Roll by metre"
                    : "Sheet yield"}
                </Typography>
              </Box>

              <Button variant="outlined" onClick={() => openEdit(p)} sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}>
                Edit
              </Button>
            </Paper>
          ))}

          {filtered.length === 0 && (
            <Typography sx={{ opacity: 0.7, textAlign: "center", py: 3 }}>
              No products yet. Click <strong>New Product</strong>.
            </Typography>
          )}
        </Stack>
      </Paper>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 900 }}>{editingId ? "Edit Product" : "New Product"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Product Name *" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} fullWidth autoFocus />
              <TextField label="Category" value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} fullWidth />
            </Stack>

            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch checked={!!form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
              <Typography sx={{ fontWeight: 800 }}>Active</Typography>
            </Stack>

            <FormControl fullWidth>
              <InputLabel>Calculator Type</InputLabel>
              <Select value={form.calculatorType} label="Calculator Type" onChange={(e) => setForm((p) => ({ ...p, calculatorType: e.target.value }))}>
                <MenuItem value="manual_item">Manual item (simple)</MenuItem>
                <MenuItem value="sheet_sign_manual_yield">Sheet sign (manual yield)</MenuItem>
                <MenuItem value="roll_print_by_metre">Roll print (by metre)</MenuItem>
              </Select>
            </FormControl>

            {form.calculatorType === "manual_item" ? (
              <TextField label="Unit Price ($)" value={form.unitPrice} onChange={(e) => setForm((p) => ({ ...p, unitPrice: e.target.value }))} fullWidth />
            ) : (
              <>
                <FormControl fullWidth>
                  <InputLabel>Base Material</InputLabel>
                  <Select value={form.materialId} label="Base Material" onChange={(e) => setForm((p) => ({ ...p, materialId: e.target.value }))}>
                    {(form.calculatorType === "roll_print_by_metre" ? rollBaseMaterials : sheetBaseMaterials).map((m) => (
                      <MenuItem key={m.id} value={m.id}>
                        {getMaterialDisplayName(m)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>Laminate Material (optional)</InputLabel>
                  <Select value={form.laminateMaterialId} label="Laminate Material (optional)" onChange={(e) => setForm((p) => ({ ...p, laminateMaterialId: e.target.value }))}>
                    <MenuItem value="">
                      <em>None</em>
                    </MenuItem>
                    {(form.calculatorType === "roll_print_by_metre" ? rollLaminateOptions : sheetLaminateOptions).map((m) => (
                      <MenuItem key={m.id} value={m.id}>
                        {getMaterialDisplayName(m)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField label="Width (mm)" value={form.widthMm} onChange={(e) => setForm((p) => ({ ...p, widthMm: e.target.value }))} fullWidth />
                  <TextField label="Height (mm)" value={form.heightMm} onChange={(e) => setForm((p) => ({ ...p, heightMm: e.target.value }))} fullWidth />
                </Stack>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField label="Sides" value={form.sides} onChange={(e) => setForm((p) => ({ ...p, sides: e.target.value }))} fullWidth />
                  <TextField label="Trim minutes per unit" value={form.minutesTrimPerUnit} onChange={(e) => setForm((p) => ({ ...p, minutesTrimPerUnit: e.target.value }))} fullWidth />
                </Stack>

                {form.calculatorType === "sheet_sign_manual_yield" && (
                  <>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField label="Units per sheet" value={form.unitsPerSheet} onChange={(e) => setForm((p) => ({ ...p, unitsPerSheet: e.target.value }))} fullWidth />
                      <TextField label="Min sheet equiv" value={form.minSheetEquiv} onChange={(e) => setForm((p) => ({ ...p, minSheetEquiv: e.target.value }))} fullWidth />
                      <TextField label="Sheet step" value={form.sheetStep} onChange={(e) => setForm((p) => ({ ...p, sheetStep: e.target.value }))} fullWidth />
                    </Stack>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField label="Ink override $/m² (optional)" value={form.inkPerM2Override} onChange={(e) => setForm((p) => ({ ...p, inkPerM2Override: e.target.value }))} fullWidth />
                      <TextField label="Labour $/sheet (optional)" value={form.labourPerSheet} onChange={(e) => setForm((p) => ({ ...p, labourPerSheet: e.target.value }))} fullWidth />
                    </Stack>
                  </>
                )}

                {form.calculatorType === "roll_print_by_metre" && (
                  <>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField label="Minimum metres" value={form.minMetres} onChange={(e) => setForm((p) => ({ ...p, minMetres: e.target.value }))} fullWidth />
                      <TextField label="Metre step" value={form.metreStep} onChange={(e) => setForm((p) => ({ ...p, metreStep: e.target.value }))} fullWidth />
                    </Stack>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField label="Ink $/m (per side)" value={form.inkPerMetre} onChange={(e) => setForm((p) => ({ ...p, inkPerMetre: e.target.value }))} fullWidth />
                      <TextField label="Labour $/m" value={form.labourPerMetre} onChange={(e) => setForm((p) => ({ ...p, labourPerMetre: e.target.value }))} fullWidth />
                    </Stack>
                  </>
                )}
              </>
            )}

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography sx={{ fontWeight: 900 }}>Quantity Discounts</Typography>
                <Button
                  variant="outlined"
                  startIcon={<AddCircleRoundedIcon />}
                  onClick={addDiscountRow}
                  sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
                >
                  Add Tier
                </Button>
              </Stack>

              <Stack spacing={1}>
                {(form.qtyDiscounts || []).map((row, idx) => (
                  <Stack key={idx} direction={{ xs: "column", sm: "row" }} spacing={1} alignItems="center">
                    <TextField label="Min qty" value={row.minQty} onChange={(e) => updateDiscountRow(idx, { minQty: e.target.value })} sx={{ width: 160 }} />
                    <TextField label="Discount %" value={row.pct} onChange={(e) => updateDiscountRow(idx, { pct: e.target.value })} sx={{ width: 160 }} />
                    <Box sx={{ flex: 1 }} />
                    <IconButton title="Remove tier" onClick={() => removeDiscountRow(idx)}>
                      <DeleteRoundedIcon />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            </Paper>

            <Divider />

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography sx={{ fontWeight: 900, mb: 1 }}>Preview</Typography>
              {!preview ? (
                <Typography sx={{ opacity: 0.7 }}>Set up a Rate Card first.</Typography>
              ) : (
                <>
                  <Typography sx={{ opacity: 0.85 }}>
                    Unit sell: <strong>${preview.unit.sell.toFixed(2)}</strong> • Total sell:{" "}
                    <strong>${preview.breakdown.sellTotal.toFixed(2)}</strong>
                  </Typography>
                  <Typography sx={{ opacity: 0.75, mt: 0.5 }}>
                    Stock: ${Number(preview.breakdown.stockTotal ?? preview.breakdown.materialTotal ?? 0).toFixed(2)} • Lam: ${Number(preview.breakdown.laminateTotal ?? 0).toFixed(2)} • Ink: ${Number(preview.breakdown.inkTotal ?? 0).toFixed(2)} • Labour: ${Number(preview.breakdown.labourTotal ?? 0).toFixed(2)}
                  </Typography>
                </>
              )}
            </Paper>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeDialog} disabled={busy} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={busy} sx={{ textTransform: "none", fontWeight: 900, borderRadius: 2 }}>
            {editingId ? "Save" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={2500} onClose={() => setSnack((p) => ({ ...p, open: false }))} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity={snack.severity} sx={{ width: "100%" }}>
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
