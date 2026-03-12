import React, { useEffect, useMemo, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
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
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import AssignmentTurnedInRoundedIcon from "@mui/icons-material/AssignmentTurnedInRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";

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
  combineDiscountsPct,
} from "../services/pricingEngine";

import { makeDocNumber } from "../utils/numbering";
import {
  getLaminateOptions,
  getLegacyCompatibleMaterial,
  getMaterialDisplayName,
  getMaterialStatus,
  getRollBaseMaterials,
  getSheetBaseMaterials,
  supportsLaminateForBase,
} from "../utils/materialCompat";
import MaterialSelectorSection from "../components/MaterialSelectorSection";
import {
  buildMaterialSelectionForSave,
  buildSelectionFromLegacy,
  getMaterialById,
  getProductMaterialProfileFromCalculator,
  normalizeMaterialSelection,
} from "../utils/materialSelection";
import {
  applyExtrasToPreview,
  priceMaterialExtras,
} from "../utils/materialExtrasPricing";

const num = (x, fallback = 0) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
};

function money(x) {
  const n = Number(x || 0);
  return `$${n.toFixed(2)}`;
}

function makeLineId() {
  return `li_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function formatTs(value) {
  try {
    const d = value?.toDate ? value.toDate() : null;
    if (!d) return "—";
    return d.toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  } catch {
    return "—";
  }
}

function statusChip(status) {
  const s = (status || "draft").toString().toLowerCase();
  const map = {
    draft: { label: "Draft", color: "default" },
    sent: { label: "Sent", color: "info" },
    accepted: { label: "Accepted", color: "success" },
    rejected: { label: "Rejected", color: "error" },
  };
  const v = map[s] || map.draft;
  return <Chip size="small" label={v.label} color={v.color} />;
}

function approvalChip(status) {
  const s = (status || "").toString().toLowerCase();
  const map = {
    sent: { label: "Awaiting client", color: "info" },
    approved: { label: "Approved", color: "success" },
    changes_requested: { label: "Changes requested", color: "warning" },
    rejected: { label: "Rejected", color: "error" },
  };

  if (!s) return <Chip size="small" label="Not sent" variant="outlined" />;
  const v = map[s] || { label: s, color: "default" };
  return <Chip size="small" label={v.label} color={v.color} />;
}

function approvalActionLabel(action) {
  const s = (action || "").toString().toLowerCase();
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  if (s === "changes_requested") return "Changes requested";
  return s || "Response";
}

function buildSendQuoteUrl() {
  const explicit = import.meta.env.VITE_SEND_QUOTE_APPROVAL_EMAIL_URL;
  if (explicit) return explicit;

  const projectId = db?.app?.options?.projectId || "";
  if (!projectId) return "";
  return `https://australia-southeast1-${projectId}.cloudfunctions.net/sendQuoteApprovalEmail`;
}

function buildLineMaterialSelection(source, materials = []) {
  const fromSelection = normalizeMaterialSelection(source?.materialSelection || source?.inputs?.materialSelection || {});
  if (fromSelection.primaryMaterialId || fromSelection.laminateMaterialId || (fromSelection.extras || []).length) {
    return fromSelection;
  }

  return buildSelectionFromLegacy(
    source?.materialId || source?.inputs?.materialId || "",
    source?.laminateMaterialId || source?.inputs?.laminateMaterialId || source?.defaults?.laminateMaterialId || "",
    materials
  );
}

export default function QuoteEditPage() {
  const { id } = useParams();
  const history = useHistory();

  const [loadingErr, setLoadingErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [quote, setQuote] = useState(null);

  const [clients, setClients] = useState([]);
  const [clientTypes, setClientTypes] = useState([]);
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [rateCard, setRateCard] = useState(null);

  const [approvalRequests, setApprovalRequests] = useState([]);
  const [approvalResponses, setApprovalResponses] = useState([]);

  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  const [liOpen, setLiOpen] = useState(false);
  const [liEditingId, setLiEditingId] = useState(null);

  const [liProductId, setLiProductId] = useState("");
  const [liQty, setLiQty] = useState(1);

  const [liUnitPrice, setLiUnitPrice] = useState(0);

  const [liMaterialId, setLiMaterialId] = useState("");
  const [liLaminateMaterialId, setLiLaminateMaterialId] = useState("");
  const [liMaterialSelection, setLiMaterialSelection] = useState(normalizeMaterialSelection());
  const [liWidthMm, setLiWidthMm] = useState(600);
  const [liHeightMm, setLiHeightMm] = useState(900);
  const [liSides, setLiSides] = useState(1);
  const [liMinutesTrimPerUnit, setLiMinutesTrimPerUnit] = useState(5);

  const [liUnitsPerSheet, setLiUnitsPerSheet] = useState(4);
  const [liMinSheetEquiv, setLiMinSheetEquiv] = useState(0.5);
  const [liSheetStep, setLiSheetStep] = useState(0.5);
  const [liInkPerM2Override, setLiInkPerM2Override] = useState(0);
  const [liLabourPerSheet, setLiLabourPerSheet] = useState(0);

  const [liMinMetres, setLiMinMetres] = useState(1);
  const [liMetreStep, setLiMetreStep] = useState(0.1);
  const [liInkPerMetre, setLiInkPerMetre] = useState(0);
  const [liLabourPerMetre, setLiLabourPerMetre] = useState(0);

  const [sendOpen, setSendOpen] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendMessage, setSendMessage] = useState("");

  const selectedProduct = useMemo(() => products.find((p) => p.id === liProductId) || null, [products, liProductId]);
  const selectedMaterial = useMemo(() => materials.find((m) => m.id === liMaterialId) || null, [materials, liMaterialId]);
  const selectedLaminate = useMemo(() => materials.find((m) => m.id === liLaminateMaterialId) || null, [materials, liLaminateMaterialId]);
  const selectedMaterialCompat = useMemo(
    () =>
      selectedProduct?.calculatorType === "roll_print_by_metre"
        ? getLegacyCompatibleMaterial(selectedMaterial, "roll")
        : getLegacyCompatibleMaterial(selectedMaterial, "sheet"),
    [selectedMaterial, selectedProduct]
  );
  const selectedLaminateCompat = useMemo(
    () =>
      selectedProduct?.calculatorType === "roll_print_by_metre"
        ? getLegacyCompatibleMaterial(selectedLaminate, "roll")
        : getLegacyCompatibleMaterial(selectedLaminate, "sheet"),
    [selectedLaminate, selectedProduct]
  );

  const pricedLineExtras = useMemo(
    () =>
      priceMaterialExtras(liMaterialSelection?.extras || [], materials, {
        lineQty: Math.max(1, Math.floor(num(liQty, 1))),
        discountPct: combinedDiscountPct,
      }),
    [liMaterialSelection, materials, liQty, combinedDiscountPct]
  );

  const sheetBaseMaterials = useMemo(() => getSheetBaseMaterials(materials), [materials]);
  const rollBaseMaterials = useMemo(() => getRollBaseMaterials(materials), [materials]);

  const sheetLaminateOptions = useMemo(
    () => getLaminateOptions(materials, selectedMaterial || "sheet_media"),
    [materials, selectedMaterial]
  );
  const rollLaminateOptions = useMemo(
    () => getLaminateOptions(materials, selectedMaterial || "roll_media"),
    [materials, selectedMaterial]
  );

  const clientTypeMap = useMemo(() => {
    const m = {};
    for (const t of clientTypes) m[t.id] = t;
    return m;
  }, [clientTypes]);

  const quoteLines = useMemo(() => quote?.lineItems || [], [quote]);

  const clientDiscountPct = useMemo(() => {
    const snap = quote?.clientSnapshot;
    if (!snap) return 0;
    return num(snap.clientDiscountPct, 0);
  }, [quote]);

  useEffect(() => {
    const unsubQ = onSnapshot(
      doc(db, "quotes", id),
      (snap) => {
        if (!snap.exists()) {
          setLoadingErr(`Quote not found: ${id}`);
          setQuote(null);
          return;
        }
        setLoadingErr("");
        setQuote({ id: snap.id, ...snap.data() });
      },
      (err) => {
        console.error(err);
        setLoadingErr(err?.message || "Failed to load quote");
      }
    );

    const unsubC = onSnapshot(query(collection(db, "clients"), orderBy("companyName", "asc")), (snap) => setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.error(e));
    const unsubCT = onSnapshot(query(collection(db, "clientTypes"), orderBy("sortOrder", "asc")), (snap) => setClientTypes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.error(e));
    const unsubP = onSnapshot(query(collection(db, "products"), orderBy("name", "asc")), (snap) => setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.error(e));
    const unsubM = onSnapshot(query(collection(db, "materials"), orderBy("name", "asc")), (snap) => setMaterials(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.error(e));
    const unsubReq = onSnapshot(query(collection(db, "quotes", id, "approvalRequests"), orderBy("sentAt", "desc")), (snap) => setApprovalRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.error(e));
    const unsubResp = onSnapshot(query(collection(db, "quotes", id, "approvalResponses"), orderBy("respondedAt", "desc")), (snap) => setApprovalResponses(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.error(e));

    (async () => {
      try {
        const snap = await getDoc(doc(db, "rateCards", "default"));
        setRateCard(snap.exists() ? snap.data() : null);
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      unsubQ();
      unsubC();
      unsubCT();
      unsubP();
      unsubM();
      unsubReq();
      unsubResp();
    };
  }, [id]);

  const totals = useMemo(() => {
    const costTotal = quoteLines.reduce((a, li) => a + num(li?.calc?.breakdown?.costTotal, 0), 0);
    const sellTotal = quoteLines.reduce((a, li) => a + num(li?.calc?.breakdown?.sellTotal, 0), 0);
    const margin = sellTotal - costTotal;
    return { costTotal, sellTotal, margin };
  }, [quoteLines]);

  const updateQuoteField = async (patch) => {
    setBusy(true);
    try {
      await updateDoc(doc(db, "quotes", id), { ...patch, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Update failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const setClient = async (clientId) => {
    const c = clients.find((x) => x.id === clientId) || null;
    const typeId = c?.clientTypeId || "";
    const t = typeId ? clientTypeMap[typeId] : null;

    await updateQuoteField({
      clientId: clientId || "",
      clientSnapshot: c
        ? {
            companyName: c.companyName || "",
            contactName: c.contactName || "",
            email: c.email || "",
            phone: c.phone || "",
            address: c.address || "",
            clientTypeId: typeId || "",
            clientTypeName: t?.name || c.clientTypeName || "",
            clientDiscountPct: num(t?.discountPct, 0),
          }
        : null,
    });
  };

  const openAddLine = () => {
    if (!products.length) {
      setSnack({ open: true, msg: "Create at least one Product first.", severity: "warning" });
      return;
    }

    const first =
      products.find((p) => getMaterialStatus({ active: p.active, status: p.status }) === "active") ||
      products[0];
    const d = first?.defaults || {};

    setLiEditingId(null);
    setLiProductId(first?.id || "");
    setLiQty(1);

    setLiWidthMm(num(d.widthMm, 600));
    setLiHeightMm(num(d.heightMm, 900));
    setLiSides(num(d.sides, 1));
    setLiMinutesTrimPerUnit(num(d.minutesTrimPerUnit, 5));

    const initialSelection = buildLineMaterialSelection(first, materials);
    setLiMaterialSelection(initialSelection);
    setLiLaminateMaterialId(initialSelection.laminateMaterialId || first?.laminateMaterialId || d.laminateMaterialId || "");

    if ((first?.calculatorType || "manual_item") === "manual_item") {
      setLiUnitPrice(num(first.unitPrice, 0));
      setLiMaterialId("");
      setLiLaminateMaterialId("");
      setLiMaterialSelection(normalizeMaterialSelection());
    } else if (first?.calculatorType === "roll_print_by_metre") {
      setLiMaterialId(initialSelection.primaryMaterialId || first?.materialId || rollBaseMaterials[0]?.id || "");
      setLiMinMetres(num(d.minMetres, 1));
      setLiMetreStep(num(d.metreStep, 0.1));
      setLiInkPerMetre(num(d.inkPerMetre, 0));
      setLiLabourPerMetre(num(d.labourPerMetre, 0));
    } else {
      setLiMaterialId(initialSelection.primaryMaterialId || first?.materialId || sheetBaseMaterials[0]?.id || "");
      setLiUnitsPerSheet(num(d.unitsPerSheet, 4));
      setLiMinSheetEquiv(num(d.minSheetEquiv, 0.5));
      setLiSheetStep(num(d.sheetStep, 0.5));
      setLiInkPerM2Override(num(d.inkPerM2Override, 0));
      setLiLabourPerSheet(num(d.labourPerSheet, 0));
    }

    setLiOpen(true);
  };

  const openEditLine = (li) => {
    const inputs = li.inputs || {};
    const currentProduct = products.find((p) => p.id === li.productId) || null;
    setLiEditingId(li.id);
    setLiProductId(li.productId || "");
    setLiQty(num(li.qty, 1));

    const initialSelection = buildLineMaterialSelection({
      materialSelection: inputs.materialSelection || li.materialSelection || currentProduct?.materialSelection,
      inputs,
      materialId: inputs.materialId || currentProduct?.materialId || li.productSnapshot?.materialId || "",
      laminateMaterialId: inputs.laminateMaterialId || currentProduct?.laminateMaterialId || li.productSnapshot?.laminateMaterialId || "",
    }, materials);

    setLiUnitPrice(num(inputs.unitPrice, num(currentProduct?.unitPrice, num(li.productSnapshot?.unitPrice, 0))));
    setLiMaterialSelection(initialSelection);
    setLiMaterialId(initialSelection.primaryMaterialId || inputs.materialId || "");
    setLiLaminateMaterialId(initialSelection.laminateMaterialId || inputs.laminateMaterialId || "");
    setLiWidthMm(num(inputs.widthMm, num(li.productSnapshot?.defaults?.widthMm, 600)));
    setLiHeightMm(num(inputs.heightMm, num(li.productSnapshot?.defaults?.heightMm, 900)));
    setLiSides(num(inputs.sides, num(li.productSnapshot?.defaults?.sides, 1)));
    setLiMinutesTrimPerUnit(num(inputs.minutesTrimPerUnit, num(li.productSnapshot?.defaults?.minutesTrimPerUnit, 5)));
    setLiUnitsPerSheet(num(inputs.unitsPerSheet, num(li.productSnapshot?.defaults?.unitsPerSheet, 4)));
    setLiMinSheetEquiv(num(inputs.minSheetEquiv, num(li.productSnapshot?.defaults?.minSheetEquiv, 0.5)));
    setLiSheetStep(num(inputs.sheetStep, num(li.productSnapshot?.defaults?.sheetStep, 0.5)));
    setLiInkPerM2Override(num(inputs.inkPerM2Override, num(li.productSnapshot?.defaults?.inkPerM2Override, 0)));
    setLiLabourPerSheet(num(inputs.labourPerSheet, num(li.productSnapshot?.defaults?.labourPerSheet, 0)));
    setLiMinMetres(num(inputs.minMetres, num(li.productSnapshot?.defaults?.minMetres, 1)));
    setLiMetreStep(num(inputs.metreStep, num(li.productSnapshot?.defaults?.metreStep, 0.1)));
    setLiInkPerMetre(num(inputs.inkPerMetre, num(li.productSnapshot?.defaults?.inkPerMetre, 0)));
    setLiLabourPerMetre(num(inputs.labourPerMetre, num(li.productSnapshot?.defaults?.labourPerMetre, 0)));

    setLiOpen(true);
  };

  const qtyDiscountPct = useMemo(() => {
    const q = Math.max(1, Math.floor(num(liQty, 1)));
    const tiers = selectedProduct?.qtyDiscounts || selectedProduct?.defaults?.qtyDiscounts || [];
    return getQtyDiscountPct(q, tiers);
  }, [liQty, selectedProduct]);

  const combinedDiscountPct = useMemo(() => combineDiscountsPct(clientDiscountPct, qtyDiscountPct), [clientDiscountPct, qtyDiscountPct]);

  useEffect(() => {
    if (!selectedProduct) return;
    const ct = selectedProduct.calculatorType || "manual_item";

    if (ct === "manual_item") {
      setLiMaterialId("");
      setLiLaminateMaterialId("");
      setLiMaterialSelection(normalizeMaterialSelection());
      const current = num(liUnitPrice, 0);
      if (!liUnitPrice || current === 0) {
        const p = num(selectedProduct.unitPrice, 0);
        if (p > 0) setLiUnitPrice(p);
      }
      return;
    }

    const nextSelection = buildLineMaterialSelection(selectedProduct, materials);
    if (!liMaterialSelection?.primaryMaterialId && (nextSelection.primaryMaterialId || nextSelection.laminateMaterialId)) {
      setLiMaterialSelection(nextSelection);
      setLiMaterialId(nextSelection.primaryMaterialId || "");
      setLiLaminateMaterialId(nextSelection.laminateMaterialId || "");
    }

    if (ct === "sheet_sign_manual_yield") {
      const bm = materials.find((m) => m.id === liMaterialId);
      if (!liMaterialId || !sheetBaseMaterials.some((m) => m.id === bm?.id)) {
        const fallbackId = nextSelection.primaryMaterialId || selectedProduct.materialId || sheetBaseMaterials[0]?.id || "";
        setLiMaterialId(fallbackId);
        setLiMaterialSelection((prev) => ({
          ...normalizeMaterialSelection(prev),
          primaryType: getMaterialById(materials, fallbackId)?.materialType || prev?.primaryType || "sheet_media",
          primaryMaterialId: fallbackId,
        }));
      }
      const lm = materials.find((m) => m.id === liLaminateMaterialId);
      if (liLaminateMaterialId && !supportsLaminateForBase(lm, bm || "sheet_media")) {
        setLiLaminateMaterialId("");
        setLiMaterialSelection((prev) => ({
          ...normalizeMaterialSelection(prev),
          laminateMaterialId: "",
        }));
      }
      return;
    }

    if (ct === "roll_print_by_metre") {
      const bm = materials.find((m) => m.id === liMaterialId);
      if (!liMaterialId || !rollBaseMaterials.some((m) => m.id === bm?.id)) {
        const fallbackId = nextSelection.primaryMaterialId || selectedProduct.materialId || rollBaseMaterials[0]?.id || "";
        setLiMaterialId(fallbackId);
        setLiMaterialSelection((prev) => ({
          ...normalizeMaterialSelection(prev),
          primaryType: getMaterialById(materials, fallbackId)?.materialType || prev?.primaryType || "roll_media",
          primaryMaterialId: fallbackId,
        }));
      }
      const lm = materials.find((m) => m.id === liLaminateMaterialId);
      if (liLaminateMaterialId && !supportsLaminateForBase(lm, bm || "roll_media")) {
        setLiLaminateMaterialId("");
        setLiMaterialSelection((prev) => ({
          ...normalizeMaterialSelection(prev),
          laminateMaterialId: "",
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liProductId, materials.length]);

  const linePreview = useMemo(() => {
    if (!rateCard || !selectedProduct) return null;
    const q = Math.max(1, Math.floor(num(liQty, 1)));
    const ct = selectedProduct.calculatorType || "manual_item";

    let basePreview = null;

    if (ct === "manual_item") {
      basePreview = calcManualItem({ qty: q, unitPrice: num(liUnitPrice, 0), discountPct: combinedDiscountPct, rateCard });
    } else if (ct === "sheet_sign_manual_yield") {
      const lam =
        selectedLaminateCompat && supportsLaminateForBase(selectedLaminate, selectedMaterial || "sheet_media")
          ? selectedLaminateCompat
          : null;
      basePreview = calcSheetSignManualYield({
        qty: q,
        widthMm: num(liWidthMm, 0),
        heightMm: num(liHeightMm, 0),
        sides: Math.max(1, Math.floor(num(liSides, 1))),
        unitsPerSheet: Math.max(1, Math.floor(num(liUnitsPerSheet, 1))),
        minutesTrimPerUnit: Math.max(0, num(liMinutesTrimPerUnit, 0)),
        minSheetEquiv: Math.max(0, num(liMinSheetEquiv, 0.5)),
        sheetStep: Math.max(0.000001, num(liSheetStep, 0.5)),
        inkPerM2Override: Math.max(0, num(liInkPerM2Override, 0)),
        labourPerSheet: Math.max(0, num(liLabourPerSheet, 0)),
        laminateMaterial: lam,
        discountPct: combinedDiscountPct,
        rateCard,
        material: selectedMaterialCompat,
      });
    } else {
      const lam =
        selectedLaminateCompat && supportsLaminateForBase(selectedLaminate, selectedMaterial || "roll_media")
          ? selectedLaminateCompat
          : null;
      basePreview = calcRollPrintByMetre({
        qty: q,
        widthMm: num(liWidthMm, 0),
        heightMm: num(liHeightMm, 0),
        sides: Math.max(1, Math.floor(num(liSides, 1))),
        minutesTrimPerUnit: Math.max(0, num(liMinutesTrimPerUnit, 0)),
        minMetres: Math.max(0, num(liMinMetres, 1)),
        metreStep: Math.max(0.000001, num(liMetreStep, 0.1)),
        inkPerMetre: Math.max(0, num(liInkPerMetre, 0)),
        labourPerMetre: Math.max(0, num(liLabourPerMetre, 0)),
        discountPct: combinedDiscountPct,
        rateCard,
        material: selectedMaterialCompat,
        laminateMaterial: lam,
      });
    }

    return applyExtrasToPreview(basePreview, pricedLineExtras, { lineQty: q });
  }, [
    rateCard, selectedProduct, selectedMaterial, selectedLaminate, liQty, liUnitPrice, liWidthMm, liHeightMm,
    liSides, liMinutesTrimPerUnit, liUnitsPerSheet, liMinSheetEquiv, liSheetStep, liInkPerM2Override,
    liLabourPerSheet, liMinMetres, liMetreStep, liInkPerMetre, liLabourPerMetre, combinedDiscountPct,
    pricedLineExtras,
  ]);

  const saveLineItem = async () => {
    if (!selectedProduct) {
      setSnack({ open: true, msg: "Select a product.", severity: "error" });
      return;
    }
    if (!rateCard) {
      setSnack({ open: true, msg: "Rate Card not found. Save Rate Card first.", severity: "error" });
      return;
    }
    if (!linePreview) {
      setSnack({ open: true, msg: "Cannot calculate preview.", severity: "error" });
      return;
    }

    const q = Math.max(1, Math.floor(num(liQty, 1)));
    const tiers = selectedProduct.qtyDiscounts || selectedProduct.defaults?.qtyDiscounts || [];
    const qtyDisc = getQtyDiscountPct(q, tiers);
    const ct = selectedProduct.calculatorType || "manual_item";

    const baseLine = {
      id: liEditingId || makeLineId(),
      productId: selectedProduct.id,
      productName: selectedProduct.name || "",
      calculatorType: ct,
      qty: q,
      productSnapshot: {
        name: selectedProduct.name || "",
        category: selectedProduct.category || "",
        calculatorType: ct,
        materialId: selectedProduct.materialId || "",
        laminateMaterialId: selectedProduct.laminateMaterialId || selectedProduct.defaults?.laminateMaterialId || "",
        materialSelection: selectedProduct.materialSelection || normalizeMaterialSelection(),
        materialExtras: selectedProduct.materialExtras || [],
        unitPrice: num(selectedProduct.unitPrice, 0),
        defaults: selectedProduct.defaults || {},
        qtyDiscounts: tiers || [],
      },
      discounts: {
        clientDiscountPct: num(clientDiscountPct, 0),
        qtyDiscountPct: num(qtyDisc, 0),
        combinedDiscountPct: num(combinedDiscountPct, 0),
        clientTypeName: quote?.clientSnapshot?.clientTypeName || "",
      },
      inputs: {},
      calc: linePreview,
      updatedAt: new Date().toISOString(),
    };

    if (ct === "manual_item") {
      baseLine.inputs = { unitPrice: num(liUnitPrice, 0) };
    } else {
      if (!selectedMaterial || !selectedMaterialCompat) {
        setSnack({ open: true, msg: "Select a base material.", severity: "error" });
        return;
      }

      const savedSelection = buildMaterialSelectionForSave(liMaterialSelection || {});
      const resolvedExtras = priceMaterialExtras(savedSelection.extras || [], materials, {
        lineQty: q,
        discountPct: combinedDiscountPct,
      });

      baseLine.inputs = {
        materialId: selectedMaterial.id,
        materialName: selectedMaterial.name || "",
        materialType: selectedMaterial.materialType || selectedMaterial.type || "",
        materialGroup: selectedMaterial.materialGroup || "",
        materialCostPerUnit:
          selectedMaterial?.pricing?.costPerUnit !== undefined &&
          selectedMaterial?.pricing?.costPerUnit !== null
            ? num(selectedMaterial.pricing.costPerUnit, 0)
            : 0,
        widthMm: Math.max(0, Math.floor(num(liWidthMm, 0))),
        heightMm: Math.max(0, Math.floor(num(liHeightMm, 0))),
        sides: Math.max(1, Math.floor(num(liSides, 1))),
        minutesTrimPerUnit: Math.max(0, num(liMinutesTrimPerUnit, 0)),
        laminateMaterialId: liLaminateMaterialId || "",
        laminateMaterialName: selectedLaminate?.name || "",
        laminateMaterialType: selectedLaminate?.materialType || selectedLaminate?.type || "",
        laminateMaterialCostPerUnit:
          selectedLaminate?.pricing?.costPerUnit !== undefined &&
          selectedLaminate?.pricing?.costPerUnit !== null
            ? num(selectedLaminate.pricing.costPerUnit, 0)
            : 0,
        materialSelection: savedSelection,
        materialExtras: resolvedExtras,
        materialExtrasSummary: {
          costTotal: resolvedExtras.reduce((acc, item) => acc + num(item?.costTotal, 0), 0),
          sellTotalBeforeDiscount: resolvedExtras.reduce((acc, item) => acc + num(item?.sellTotalBeforeDiscount, 0), 0),
          discountAmount: resolvedExtras.reduce((acc, item) => acc + num(item?.discountAmount, 0), 0),
          sellTotal: resolvedExtras.reduce((acc, item) => acc + num(item?.sellTotal, 0), 0),
        },
      };

      if (ct === "sheet_sign_manual_yield") {
        baseLine.inputs.unitsPerSheet = Math.max(1, Math.floor(num(liUnitsPerSheet, 1)));
        baseLine.inputs.minSheetEquiv = Math.max(0, num(liMinSheetEquiv, 0.5));
        baseLine.inputs.sheetStep = Math.max(0.000001, num(liSheetStep, 0.5));
        baseLine.inputs.inkPerM2Override = Math.max(0, num(liInkPerM2Override, 0));
        baseLine.inputs.labourPerSheet = Math.max(0, num(liLabourPerSheet, 0));
        baseLine.inputs.materialCostPerSheet = num(selectedMaterialCompat.costPerSheet, 0);
        baseLine.inputs.laminateCostPerSheet = num(selectedLaminateCompat?.costPerSheet, 0);
      }

      if (ct === "roll_print_by_metre") {
        baseLine.inputs.minMetres = Math.max(0, num(liMinMetres, 1));
        baseLine.inputs.metreStep = Math.max(0.000001, num(liMetreStep, 0.1));
        baseLine.inputs.inkPerMetre = Math.max(0, num(liInkPerMetre, 0));
        baseLine.inputs.labourPerMetre = Math.max(0, num(liLabourPerMetre, 0));
        baseLine.inputs.materialCostPerMetre = num(selectedMaterialCompat.costPerMetre, 0);
        baseLine.inputs.rollWidthMm = num(selectedMaterialCompat.rollWidthMm, 0);
        baseLine.inputs.laminateCostPerMetre = num(selectedLaminateCompat?.costPerMetre, 0);
        baseLine.inputs.laminateRollWidthMm = num(selectedLaminateCompat?.rollWidthMm, 0);
      }
    }

    const next = quoteLines.slice();
    const idx = next.findIndex((x) => x.id === baseLine.id);
    if (idx >= 0) next[idx] = baseLine;
    else next.push(baseLine);

    const newTotals = {
      costTotal: next.reduce((a, li) => a + num(li?.calc?.breakdown?.costTotal, 0), 0),
      sellTotal: next.reduce((a, li) => a + num(li?.calc?.breakdown?.sellTotal, 0), 0),
      itemCount: next.length,
    };

    setBusy(true);
    try {
      await updateDoc(doc(db, "quotes", id), { lineItems: next, totals: newTotals, updatedAt: serverTimestamp() });
      setSnack({ open: true, msg: liEditingId ? "Line updated." : "Line added.", severity: "success" });
      setLiOpen(false);
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Save line failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const convertToOrder = async () => {
    if (!quote) return;
    if (quote.orderId) {
      history.push(`/orders/${quote.orderId}`);
      return;
    }

    const lineItems = quote.lineItems || [];
    const computedTotals = {
      costTotal: lineItems.reduce((a, li) => a + num(li?.calc?.breakdown?.costTotal, 0), 0),
      sellTotal: lineItems.reduce((a, li) => a + num(li?.calc?.breakdown?.sellTotal, 0), 0),
      itemCount: lineItems.length,
    };

    setBusy(true);
    try {
      const orderNumber = makeDocNumber("WO");
      const payload = {
        orderNumber,
        status: "open",
        sourceQuoteId: quote.id,
        quoteNumber: quote.quoteNumber || "",
        clientId: quote.clientId || "",
        clientSnapshot: quote.clientSnapshot || null,
        lineItems,
        totals: quote.totals || computedTotals,
        notes: quote.notes || "",
        installJobId: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const ref = await addDoc(collection(db, "orders"), payload);

      await updateDoc(doc(db, "quotes", quote.id), {
        orderId: ref.id,
        orderNumber,
        convertedToOrderAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      history.push(`/orders/${ref.id}`);
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to create order", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const deleteLine = async (lineId) => {
    const next = quoteLines.filter((x) => x.id !== lineId);
    const newTotals = {
      costTotal: next.reduce((a, li) => a + num(li?.calc?.breakdown?.costTotal, 0), 0),
      sellTotal: next.reduce((a, li) => a + num(li?.calc?.breakdown?.sellTotal, 0), 0),
      itemCount: next.length,
    };

    setBusy(true);
    try {
      await updateDoc(doc(db, "quotes", id), { lineItems: next, totals: newTotals, updatedAt: serverTimestamp() });
      setSnack({ open: true, msg: "Line removed.", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Delete failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const openSendDialog = () => {
    setSendEmail(quote?.approvalRecipientEmail || quote?.clientSnapshot?.email || "");
    setSendMessage("");
    setSendOpen(true);
  };

  const sendQuoteForApproval = async () => {
    const url = buildSendQuoteUrl();
    if (!url) {
      setSnack({ open: true, msg: "Quote send URL is not configured. Add VITE_SEND_QUOTE_APPROVAL_EMAIL_URL or check Firebase config.", severity: "error" });
      return;
    }

    if (!quote?.clientSnapshot?.email && !sendEmail.trim()) {
      setSnack({ open: true, msg: "Add a client email before sending.", severity: "error" });
      return;
    }

    setSendBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id, emailOverride: sendEmail.trim(), message: sendMessage.trim() }),
      });

      const contentType = res.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await res.json() : await res.text();

      if (!res.ok) {
        const errMsg = typeof payload === "string" ? payload : payload?.message || "Failed to send quote";
        throw new Error(errMsg);
      }

      setSnack({ open: true, msg: typeof payload === "object" && payload?.sentTo ? `Quote sent to ${payload.sentTo}.` : "Quote sent.", severity: "success" });
      setSendOpen(false);
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to send quote", severity: "error" });
    } finally {
      setSendBusy(false);
    }
  };

  if (loadingErr) {
    return <Box sx={{ maxWidth: 900, mx: "auto" }}><Alert severity="error">{loadingErr}</Alert></Box>;
  }

  if (!quote) {
    return <Box sx={{ maxWidth: 900, mx: "auto" }}><Typography sx={{ opacity: 0.8 }}>Loading…</Typography></Box>;
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <IconButton onClick={() => history.push("/quotes")} size="small" title="Back to Quotes">
          <ArrowBackRoundedIcon />
        </IconButton>

        <Typography variant="h4" sx={{ fontWeight: 900, flex: 1 }}>
          {quote.quoteNumber || "Quote"}
        </Typography>

        {statusChip(quote.status)}
        {approvalChip(quote.approvalStatus)}

        <Button variant="outlined" startIcon={<SendRoundedIcon />} onClick={openSendDialog} disabled={busy || sendBusy} sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}>
          Send Quote
        </Button>

        {quote.orderId ? (
          <Button variant="outlined" startIcon={<LaunchRoundedIcon />} onClick={() => history.push(`/orders/${quote.orderId}`)} sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}>
            Open Order
          </Button>
        ) : (
          <Button variant="contained" startIcon={<AssignmentTurnedInRoundedIcon />} onClick={convertToOrder} disabled={busy} sx={{ textTransform: "none", borderRadius: 2, fontWeight: 900 }}>
            Create Order
          </Button>
        )}
      </Stack>

      <Typography sx={{ opacity: 0.72, mb: 2 }}>
        Sent to: <strong>{quote.approvalRecipientEmail || quote.clientSnapshot?.email || "—"}</strong> • Sent at: <strong>{formatTs(quote.approvalRequestedAt)}</strong> • Responded at: <strong>{formatTs(quote.approvalRespondedAt)}</strong>
      </Typography>

      {!rateCard && <Alert severity="warning" sx={{ mb: 2 }}>Rate Card not found. Go to <strong>Rate Card</strong> and save defaults first.</Alert>}

      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel>Client</InputLabel>
              <Select label="Client" value={quote.clientId || ""} onChange={(e) => setClient(e.target.value)}>
                <MenuItem value=""><em>Select client…</em></MenuItem>
                {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.companyName}</MenuItem>)}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select label="Status" value={quote.status || "draft"} onChange={(e) => updateQuoteField({ status: e.target.value })}>
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="sent">Sent</MenuItem>
                <MenuItem value="accepted">Accepted</MenuItem>
                <MenuItem value="rejected">Rejected</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Typography sx={{ opacity: 0.85 }}>
            Client discount: <strong>{clientDiscountPct}%</strong> {quote.clientSnapshot?.clientTypeName ? `(${quote.clientSnapshot.clientTypeName})` : ""}
          </Typography>

          <TextField label="Notes" value={quote.notes || ""} onChange={(e) => updateQuoteField({ notes: e.target.value })} fullWidth multiline minRows={3} />
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <EmailRoundedIcon />
            <Typography variant="h6" sx={{ fontWeight: 900 }}>Send & Response Tracking</Typography>
          </Stack>

          <Button variant="outlined" startIcon={<SendRoundedIcon />} onClick={openSendDialog} disabled={busy || sendBusy} sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}>
            Send Again
          </Button>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
            <Typography sx={{ fontWeight: 900, mb: 1 }}>Latest delivery details</Typography>
            <Typography sx={{ opacity: 0.8 }}>Recipient: <strong>{quote.approvalRecipientEmail || quote.clientSnapshot?.email || "—"}</strong></Typography>
            <Typography sx={{ opacity: 0.8 }}>Approval status: <strong>{approvalActionLabel(quote.approvalStatus || "not sent")}</strong></Typography>
            <Typography sx={{ opacity: 0.8 }}>Sent at: <strong>{formatTs(quote.approvalRequestedAt)}</strong></Typography>
            <Typography sx={{ opacity: 0.8 }}>Responded at: <strong>{formatTs(quote.approvalRespondedAt)}</strong></Typography>
            {quote.approvalResponseMessage ? (
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, mt: 1.5 }}>
                <Typography sx={{ fontWeight: 800, mb: 0.5 }}>Latest client comment</Typography>
                <Typography sx={{ opacity: 0.85, whiteSpace: "pre-wrap" }}>{quote.approvalResponseMessage}</Typography>
              </Paper>
            ) : null}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <HistoryRoundedIcon fontSize="small" />
              <Typography sx={{ fontWeight: 900 }}>History</Typography>
            </Stack>

            <Stack spacing={1}>
              {approvalRequests.map((req) => (
                <Paper key={`req-${req.id}`} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                  <Typography sx={{ fontWeight: 800 }}>Quote sent</Typography>
                  <Typography sx={{ opacity: 0.78, fontSize: 13 }}>{req.recipientEmail || "—"} • {formatTs(req.sentAt)}</Typography>
                  {req.message ? <Typography sx={{ opacity: 0.85, mt: 0.75, whiteSpace: "pre-wrap" }}>{req.message}</Typography> : null}
                </Paper>
              ))}

              {approvalResponses.map((resp) => (
                <Paper key={`resp-${resp.id}`} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                  <Typography sx={{ fontWeight: 800 }}>{approvalActionLabel(resp.action)}</Typography>
                  <Typography sx={{ opacity: 0.78, fontSize: 13 }}>{formatTs(resp.respondedAt)}</Typography>
                  {resp.message ? <Typography sx={{ opacity: 0.85, mt: 0.75, whiteSpace: "pre-wrap" }}>{resp.message}</Typography> : null}
                </Paper>
              ))}

              {!approvalRequests.length && !approvalResponses.length ? <Typography sx={{ opacity: 0.7 }}>No send or response history yet.</Typography> : null}
            </Stack>
          </Paper>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>Line Items</Typography>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openAddLine} disabled={busy} sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}>
            Add Product
          </Button>
        </Stack>

        <Divider sx={{ mb: 1 }} />

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 900 }}>Item</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Qty</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Discount</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Unit</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Total</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Actions</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {(quote.lineItems || []).map((li) => (
              <TableRow key={li.id} hover>
                <TableCell sx={{ fontWeight: 900 }}>
                  {li.productName || ""}
                  <Typography sx={{ opacity: 0.75, fontSize: 12 }}>
                    {li.calculatorType === "manual_item" ? "Manual item" : li.calculatorType === "roll_print_by_metre" ? "Roll by metre" : "Sheet yield"}
                    {li?.inputs?.laminateMaterialName ? ` • Lam: ${li.inputs.laminateMaterialName}` : ""}
                    {li?.inputs?.materialExtras?.length ? ` • Extras: ${li.inputs.materialExtras.length}` : ""}
                    {num(li?.calc?.breakdown?.extrasSellTotal, 0) > 0 ? ` • Extras $${num(li.calc.breakdown.extrasSellTotal, 0).toFixed(2)}` : ""}
                  </Typography>
                </TableCell>
                <TableCell>{li.qty}</TableCell>
                <TableCell>{num(li?.calc?.breakdown?.discountPct, li?.discounts?.combinedDiscountPct || 0)}%</TableCell>
                <TableCell sx={{ fontWeight: 900 }}>{money(li?.calc?.unit?.sell || 0)}</TableCell>
                <TableCell sx={{ fontWeight: 900 }}>{money(li?.calc?.breakdown?.sellTotal || 0)}</TableCell>
                <TableCell>
                  <IconButton size="small" title="Edit" onClick={() => openEditLine(li)}><EditRoundedIcon fontSize="small" /></IconButton>
                  <IconButton size="small" title="Delete" onClick={() => deleteLine(li.id)}><DeleteRoundedIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}

            {(quote.lineItems || []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 4 }}>
                  <Typography sx={{ opacity: 0.7, textAlign: "center" }}>No line items yet. Click <strong>Add Product</strong>.</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Divider sx={{ my: 2 }} />

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} justifyContent="flex-end">
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, minWidth: 320 }}>
            <Typography sx={{ fontWeight: 900 }}>Totals</Typography>
            <Typography sx={{ opacity: 0.8 }}>Cost: <strong>{money(totals.costTotal)}</strong></Typography>
            <Typography sx={{ opacity: 0.8 }}>Sell: <strong>{money(totals.sellTotal)}</strong></Typography>
            <Typography sx={{ opacity: 0.8 }}>Margin: <strong>{money(totals.margin)}</strong></Typography>
          </Paper>
        </Stack>
      </Paper>

      <Dialog open={sendOpen} onClose={() => (sendBusy ? null : setSendOpen(false))} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 900 }}>Send Quote for Approval</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">This sends the client an approval email with Approve, Request Changes, and Reject actions.</Alert>
            <TextField label="Send to" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} fullWidth helperText="Leave as-is to use the quote client email." />
            <TextField label="Message" value={sendMessage} onChange={(e) => setSendMessage(e.target.value)} fullWidth multiline minRows={4} helperText="This message appears above the quote summary in the client email." />

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography sx={{ fontWeight: 900, mb: 1 }}>Preview</Typography>
              <Typography sx={{ opacity: 0.82 }}>Quote: <strong>{quote.quoteNumber || "—"}</strong></Typography>
              <Typography sx={{ opacity: 0.82 }}>Recipient: <strong>{sendEmail || quote.clientSnapshot?.email || "—"}</strong></Typography>
              <Typography sx={{ opacity: 0.82 }}>Items: <strong>{quote.totals?.itemCount || 0}</strong></Typography>
              <Typography sx={{ opacity: 0.82 }}>Total: <strong>{money(quote.totals?.sellTotal || 0)}</strong></Typography>
              {sendMessage ? <Typography sx={{ opacity: 0.85, mt: 1, whiteSpace: "pre-wrap" }}>{sendMessage}</Typography> : null}
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setSendOpen(false)} disabled={sendBusy} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button variant="contained" startIcon={<SendRoundedIcon />} onClick={sendQuoteForApproval} disabled={sendBusy} sx={{ textTransform: "none", fontWeight: 900, borderRadius: 2 }}>
            {sendBusy ? "Sending…" : "Send Quote"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={liOpen} onClose={() => (busy ? null : setLiOpen(false))} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 900 }}>{liEditingId ? "Edit Line Item" : "Add Line Item"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel>Product</InputLabel>
                <Select label="Product" value={liProductId} onChange={(e) => setLiProductId(e.target.value)}>
                  {products
                    .filter((p) => getMaterialStatus({ active: p.active, status: p.status }) === "active")
                    .map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField label="Qty" value={liQty} onChange={(e) => setLiQty(e.target.value)} sx={{ width: 180 }} />
            </Stack>

            <Typography sx={{ opacity: 0.85 }}>
              Discounts: Client <strong>{clientDiscountPct}%</strong> + Qty <strong>{qtyDiscountPct}%</strong> = Combined <strong>{combinedDiscountPct}%</strong>
            </Typography>

            {selectedProduct?.calculatorType === "manual_item" ? (
              <TextField label="Unit Price ($) (cost base)" value={liUnitPrice} onChange={(e) => setLiUnitPrice(e.target.value)} fullWidth />
            ) : (
              <>
                <MaterialSelectorSection
                  title="Line Materials"
                  materials={materials}
                  jobProfile={getProductMaterialProfileFromCalculator(selectedProduct?.calculatorType)}
                  value={liMaterialSelection}
                  onChange={(nextSelection) => {
                    setLiMaterialSelection(nextSelection);
                    setLiMaterialId(nextSelection.primaryMaterialId || "");
                    setLiLaminateMaterialId(nextSelection.laminateMaterialId || "");
                  }}
                />

                <Alert severity="info">
                  Optional extras now price into the preview and quote totals. Qty is treated as per finished item, so extras scale with the line quantity.
                </Alert>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField label="Width (mm)" value={liWidthMm} onChange={(e) => setLiWidthMm(e.target.value)} fullWidth />
                  <TextField label="Height (mm)" value={liHeightMm} onChange={(e) => setLiHeightMm(e.target.value)} fullWidth />
                </Stack>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField label="Sides" value={liSides} onChange={(e) => setLiSides(e.target.value)} fullWidth />
                  <TextField label="Trim minutes per unit" value={liMinutesTrimPerUnit} onChange={(e) => setLiMinutesTrimPerUnit(e.target.value)} fullWidth />
                </Stack>

                {selectedProduct?.calculatorType === "sheet_sign_manual_yield" ? (
                  <>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField label="Units per sheet" value={liUnitsPerSheet} onChange={(e) => setLiUnitsPerSheet(e.target.value)} fullWidth />
                      <TextField label="Min sheet equiv" value={liMinSheetEquiv} onChange={(e) => setLiMinSheetEquiv(e.target.value)} fullWidth />
                      <TextField label="Sheet step" value={liSheetStep} onChange={(e) => setLiSheetStep(e.target.value)} fullWidth />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField label="Ink override $/m² (optional)" value={liInkPerM2Override} onChange={(e) => setLiInkPerM2Override(e.target.value)} fullWidth />
                      <TextField label="Labour $/sheet (optional)" value={liLabourPerSheet} onChange={(e) => setLiLabourPerSheet(e.target.value)} fullWidth />
                    </Stack>
                  </>
                ) : null}

                {selectedProduct?.calculatorType === "roll_print_by_metre" ? (
                  <>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField label="Min metres" value={liMinMetres} onChange={(e) => setLiMinMetres(e.target.value)} fullWidth />
                      <TextField label="Metre step" value={liMetreStep} onChange={(e) => setLiMetreStep(e.target.value)} fullWidth />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField label="Ink $/m (per side)" value={liInkPerMetre} onChange={(e) => setLiInkPerMetre(e.target.value)} fullWidth />
                      <TextField label="Labour $/m" value={liLabourPerMetre} onChange={(e) => setLiLabourPerMetre(e.target.value)} fullWidth />
                    </Stack>
                  </>
                ) : null}
              </>
            )}

            <Divider />

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography sx={{ fontWeight: 900, mb: 0.5 }}>Preview</Typography>
              {!linePreview ? (
                <Typography sx={{ opacity: 0.7 }}>Select a product and make sure Rate Card exists.</Typography>
              ) : (
                <>
                  <Typography sx={{ opacity: 0.85 }}>
                    Unit sell: <strong>{money(linePreview.unit.sell)}</strong> • Total sell: <strong>{money(linePreview.breakdown.sellTotal)}</strong>
                  </Typography>
                  <Typography sx={{ opacity: 0.8, mt: 1 }}>
                    Before discount: {money(linePreview.breakdown.sellTotalBeforeDiscount)} • Discount: {money(linePreview.breakdown.discountAmount)} ({linePreview.breakdown.discountPct}%)
                  </Typography>
                  {linePreview.roll ? <Typography sx={{ opacity: 0.75, mt: 0.5 }}>Metres billed: {linePreview.roll.billedMetres.toFixed(2)}m (raw {linePreview.roll.rawMetres.toFixed(2)}m • across {linePreview.roll.unitsAcross})</Typography> : null}
                  {linePreview.sheets ? <Typography sx={{ opacity: 0.75, mt: 0.5 }}>Sheets billed: {linePreview.sheets.billedSheets.toFixed(2)} (raw {linePreview.sheets.rawSheets.toFixed(2)})</Typography> : null}
                  <Typography sx={{ opacity: 0.8, mt: 0.5 }}>
                    Stock: {money(linePreview.breakdown.stockTotal ?? linePreview.breakdown.materialTotal ?? 0)} • Lam: {money(linePreview.breakdown.laminateTotal ?? 0)} • Ink: {money(linePreview.breakdown.inkTotal ?? 0)} • Labour: {money(linePreview.breakdown.labourTotal ?? 0)} • Extras: {money(linePreview.breakdown.extrasSellTotal ?? 0)}
                  </Typography>
                </>
              )}
            </Paper>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setLiOpen(false)} disabled={busy} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button variant="contained" onClick={saveLineItem} disabled={busy} sx={{ textTransform: "none", fontWeight: 900, borderRadius: 2 }}>
            {liEditingId ? "Save Line" : "Add Line"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={2500} onClose={() => setSnack((p) => ({ ...p, open: false }))} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity={snack.severity} sx={{ width: "100%" }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
