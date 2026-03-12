import React, { useEffect, useMemo, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
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
  Divider,
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
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import LocalShippingRoundedIcon from "@mui/icons-material/LocalShippingRounded";
import MoveToInboxRoundedIcon from "@mui/icons-material/MoveToInboxRounded";
import InventoryRoundedIcon from "@mui/icons-material/InventoryRounded";
import LibraryAddRoundedIcon from "@mui/icons-material/LibraryAddRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import PrintRoundedIcon from "@mui/icons-material/PrintRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import { normalizePurchaseOrderRecord } from "../utils/purchaseOrders";
import { downloadPurchaseOrderPdf } from "../utils/purchaseOrderPdf";
import {
  buildPurchaseOrderEmailBody,
  buildPurchaseOrderEmailSubject,
  buildPurchaseOrderPrintLines,
  formatPurchaseOrderDate,
  getPurchaseOrderSupplierSummary,
} from "../utils/purchaseOrderOutput";

const STATUS_OPTIONS = [
  "draft",
  "sent",
  "ordered",
  "part_received",
  "received",
  "cancelled",
];

const MATERIAL_TYPE_OPTIONS = [
  { value: "sheet_media", label: "Sheet Media" },
  { value: "roll_media", label: "Roll Media" },
  { value: "roll_laminate", label: "Roll Laminate" },
  { value: "card_stock", label: "Card Stock" },
  { value: "paper_stock", label: "Paper Stock" },
  { value: "fixing", label: "Fixings" },
  { value: "item", label: "Item" },
  { value: "other", label: "Other" },
];

function currency(value) {
  const parsed = Number(value || 0);
  return `$${parsed.toFixed(2)}`;
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timestampText(value) {
  if (!value) return "—";

  const date = typeof value?.toDate === "function" ? value.toDate() : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString();
}

function statusChip(status) {
  const value = String(status || "draft").toLowerCase();
  const map = {
    draft: { label: "Draft", color: "default" },
    sent: { label: "Sent", color: "info" },
    ordered: { label: "Ordered", color: "primary" },
    part_received: { label: "Part Received", color: "warning" },
    received: { label: "Received", color: "success" },
    cancelled: { label: "Cancelled", color: "default" },
  };
  const config = map[value] || map.draft;
  return <Chip label={config.label} color={config.color} size="small" variant="outlined" />;
}

function createEmptyLine() {
  return {
    materialId: "",
    materialName: "",
    materialType: "",
    supplierSku: "",
    qty: "1",
    qtyReceived: "0",
    qtyReceivedPosted: "0",
    unit: "each",
    unitCost: "0",
    lineTotal: 0,
    requiredQty: "",
    requiredUnit: "",
    notes: "",
    linkedOrderIds: [],
    isAdHoc: true,
  };
}

function normalizeLine(line = {}) {
  const qty = line.qty !== null && line.qty !== undefined ? String(line.qty) : "1";
  const qtyReceived =
    line.qtyReceived !== null && line.qtyReceived !== undefined
      ? String(line.qtyReceived)
      : "0";
  const qtyReceivedPosted =
    line.qtyReceivedPosted !== null && line.qtyReceivedPosted !== undefined
      ? String(line.qtyReceivedPosted)
      : "0";
  const unitCost =
    line.unitCost !== null && line.unitCost !== undefined ? String(line.unitCost) : "0";

  return {
    ...createEmptyLine(),
    ...line,
    qty,
    qtyReceived,
    qtyReceivedPosted,
    unitCost,
    lineTotal: parseNumber(line.lineTotal, parseNumber(qty, 0) * parseNumber(unitCost, 0)),
    linkedOrderIds: Array.isArray(line.linkedOrderIds) ? line.linkedOrderIds : [],
  };
}

function getReceivedStatus(qty, qtyReceived) {
  const ordered = parseNumber(qty, 0);
  const received = parseNumber(qtyReceived, 0);

  if (ordered <= 0) return "none";
  if (received <= 0) return "none";
  if (received >= ordered) return "full";
  return "partial";
}

function getStockPostingStatus(qtyReceived, qtyReceivedPosted) {
  const received = parseNumber(qtyReceived, 0);
  const posted = parseNumber(qtyReceivedPosted, 0);

  if (received <= 0) return "none";
  if (posted <= 0) return "pending";
  if (posted >= received) return "posted";
  return "partial";
}

function unitCanPostToStock(lineUnit, material) {
  const normalizedLineUnit = String(lineUnit || "").trim().toLowerCase();
  const stockUnit = String(material?.stockUnit || "").trim().toLowerCase();
  const purchaseUnit = String(material?.purchaseUnit || "").trim().toLowerCase();

  if (!normalizedLineUnit) return true;
  if (!stockUnit) return true;
  if (normalizedLineUnit === stockUnit) return true;
  if (purchaseUnit && purchaseUnit === stockUnit && normalizedLineUnit === purchaseUnit) {
    return true;
  }

  return false;
}

function getMaterialGroupForType(type) {
  switch (String(type || "").trim().toLowerCase()) {
    case "sheet_media":
    case "roll_media":
      return "print_media";
    case "roll_laminate":
      return "laminate";
    case "paper_stock":
      return "paper";
    case "card_stock":
      return "card";
    case "fixing":
      return "fixing";
    case "item":
      return "display_product";
    default:
      return "other";
  }
}

function getApplicableToForType(type) {
  switch (String(type || "").trim().toLowerCase()) {
    case "roll_laminate":
      return ["sheet_media", "roll_media"];
    case "fixing":
      return ["sheet_media", "roll_media", "item", "paper_stock", "card_stock"];
    case "item":
      return ["item"];
    case "paper_stock":
      return ["paper_stock"];
    case "card_stock":
      return ["card_stock"];
    default:
      return [];
  }
}

function guessMaterialTypeFromLine(line) {
  const text = `${line?.materialName || ""} ${line?.notes || ""}`.toLowerCase();
  const unit = String(line?.unit || "").trim().toLowerCase();

  if (text.includes("laminate")) return "roll_laminate";
  if (
    text.includes("eyelet") ||
    text.includes("bracket") ||
    text.includes("screw") ||
    text.includes("clip") ||
    text.includes("fixing")
  ) {
    return "fixing";
  }
  if (text.includes("paper")) return "paper_stock";
  if (text.includes("card")) return "card_stock";
  if (text.includes("vinyl") || text.includes("banner") || text.includes("roll")) {
    return "roll_media";
  }
  if (unit === "sheet") return "sheet_media";
  if (unit === "roll" || unit === "lm") return "roll_media";
  if (["each", "set", "pair", "box", "pack"].includes(unit)) return "item";
  return "other";
}

function createMaterialDraftFromLine(line, supplierId = "", supplierName = "") {
  const guessedType = guessMaterialTypeFromLine(line);
  const qty = Math.max(1, parseNumber(line?.qty, 1));

  return {
    name: String(line?.materialName || "").trim(),
    materialType: guessedType,
    supplierId: supplierId || "",
    supplierName: supplierName || "",
    supplierSku: String(line?.supplierSku || "").trim(),
    stockUnit: String(line?.unit || "each").trim() || "each",
    purchaseUnit: String(line?.unit || "each").trim() || "each",
    costPerUnit: String(parseNumber(line?.unitCost, 0)),
    preferredOrderQty: String(qty),
    minimumOrderQty: "1",
    notes: String(line?.notes || "").trim(),
  };
}

export default function PurchaseOrderDetailPage() {
  const history = useHistory();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingMaterial, setCreatingMaterial] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [purchaseOrder, setPurchaseOrder] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [materialLineIndex, setMaterialLineIndex] = useState(-1);
  const [materialDraft, setMaterialDraft] = useState(
    createMaterialDraftFromLine(createEmptyLine())
  );
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [form, setForm] = useState({
    supplierName: "",
    poNumber: "",
    status: "draft",
    notes: "",
    receivedNotes: "",
    lines: [],
  });

  useEffect(() => {
    if (!id) return undefined;

    const ref = doc(db, "purchaseOrders", id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setError("Purchase order not found.");
          setPurchaseOrder(null);
          setLoading(false);
          return;
        }

        const normalized = normalizePurchaseOrderRecord(snap.id, snap.data());
        setPurchaseOrder(normalized);
        setForm({
          supplierName: normalized.supplierName || "",
          poNumber: normalized.poNumber || "",
          status: normalized.status || "draft",
          notes: normalized.notes || "",
          receivedNotes: normalized.receivedNotes || "",
          lines: Array.isArray(normalized.lines)
            ? normalized.lines.map((line) => normalizeLine(line))
            : [],
        });
        setError("");
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load purchase order:", err);
        setError(err?.message || "Failed to load purchase order.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [id]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const snapshot = await getDocs(collection(db, "suppliers"));
        const rows = snapshot.docs
          .map((snap) => ({ id: snap.id, ...(snap.data() || {}) }))
          .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

        if (isMounted) {
          setSuppliers(rows);
        }
      } catch (err) {
        console.error("Failed to load suppliers:", err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const resolvedSupplier = useMemo(() => {
    const byId = suppliers.find((supplier) => supplier.id === purchaseOrder?.supplierId) || null;
    if (byId) return byId;

    const handlePrint = () => {
    window.print();
  };

  const handleOpenEmailDialog = () => {
    const subject = buildPurchaseOrderEmailSubject({
      purchaseOrder,
      poNumber: form.poNumber,
      supplierName: supplierSummary.name,
    });
    const body = buildPurchaseOrderEmailBody({
      purchaseOrder,
      supplier: resolvedSupplier,
      supplierName: supplierSummary.name,
      poNumber: form.poNumber,
      notes: form.notes,
      lines: form.lines,
      total: totals.total,
    });

    setEmailSubject(subject);
    setEmailBody(body);
    setEmailDialogOpen(true);
  };
  const handleExportPdf = () => {
  try {
    downloadPurchaseOrderPdf({
      purchaseOrder,
      supplier: resolvedSupplier,
      supplierName: supplierSummary.name,
      poNumber: form.poNumber,
      notes: form.notes,
      lines: form.lines,
      total: totals.total,
    });
    setSuccess("Purchase order PDF downloaded.");
  } catch (err) {
    console.error("Failed to export purchase order PDF:", err);
    setError(err?.message || "Failed to export purchase order PDF.");
  }
};

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${emailSubject}

${emailBody}`);
      setSuccess("Purchase order email copied to clipboard.");
    } catch (err) {
      console.error("Failed to copy email text:", err);
      setError("Failed to copy email text.");
    }
  };

  const handleOpenEmailDraft = () => {
    const emailTo = supplierSummary.email || "";
    const mailto = `mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(
      emailSubject
    )}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailto;
  };

  return (
      suppliers.find(
        (supplier) =>
          String(supplier.name || "").trim().toLowerCase() ===
          String(form.supplierName || purchaseOrder?.supplierName || "")
            .trim()
            .toLowerCase()
      ) || null
    );
  }, [suppliers, purchaseOrder?.supplierId, purchaseOrder?.supplierName, form.supplierName]);

  const printLines = useMemo(() => buildPurchaseOrderPrintLines(form.lines), [form.lines]);

  const supplierSummary = useMemo(
    () =>
      getPurchaseOrderSupplierSummary({
        purchaseOrder,
        supplier: resolvedSupplier,
        supplierName: form.supplierName,
      }),
    [purchaseOrder, resolvedSupplier, form.supplierName]
  );

  const totals = useMemo(() => {
    const subtotal = form.lines.reduce((sum, line) => {
      const lineTotal = parseNumber(line.qty, 0) * parseNumber(line.unitCost, 0);
      return sum + lineTotal;
    }, 0);

    const orderedQty = form.lines.reduce((sum, line) => sum + parseNumber(line.qty, 0), 0);
    const receivedQty = form.lines.reduce((sum, line) => sum + parseNumber(line.qtyReceived, 0), 0);
    const postedQty = form.lines.reduce(
      (sum, line) => sum + parseNumber(line.qtyReceivedPosted, 0),
      0
    );
    const remainingQty = Math.max(0, orderedQty - receivedQty);
    const pendingStockQty = Math.max(0, receivedQty - postedQty);

    return {
      subtotal,
      tax: 0,
      total: subtotal,
      orderedQty,
      receivedQty,
      postedQty,
      remainingQty,
      pendingStockQty,
    };
  }, [form.lines]);

  const receivingSummary = useMemo(() => {
    const fullyReceived = form.lines.filter(
      (line) => getReceivedStatus(line.qty, line.qtyReceived) === "full"
    ).length;
    const partiallyReceived = form.lines.filter(
      (line) => getReceivedStatus(line.qty, line.qtyReceived) === "partial"
    ).length;
    const notReceived = form.lines.filter(
      (line) => getReceivedStatus(line.qty, line.qtyReceived) === "none"
    ).length;

    const stockPosted = form.lines.filter(
      (line) => getStockPostingStatus(line.qtyReceived, line.qtyReceivedPosted) === "posted"
    ).length;
    const stockPending = form.lines.filter(
      (line) => getStockPostingStatus(line.qtyReceived, line.qtyReceivedPosted) === "pending"
    ).length;
    const stockPartial = form.lines.filter(
      (line) => getStockPostingStatus(line.qtyReceived, line.qtyReceivedPosted) === "partial"
    ).length;

    return {
      fullyReceived,
      partiallyReceived,
      notReceived,
      stockPosted,
      stockPending,
      stockPartial,
    };
  }, [form.lines]);

  const handleFieldChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleLineChange = (index, field, value) => {
    setForm((prev) => {
      const nextLines = prev.lines.map((line, lineIndex) => {
        if (lineIndex !== index) return line;

        const updated = {
          ...line,
          [field]: value,
        };

        if (field === "qtyReceived") {
          const ordered = parseNumber(updated.qty, 0);
          const nextReceived = parseNumber(value, 0);
          updated.qtyReceived = String(Math.max(0, nextReceived));
          if (nextReceived > ordered && ordered > 0) {
            updated.qtyReceived = String(ordered);
          }
        }

        updated.lineTotal =
          parseNumber(updated.qty, 0) * parseNumber(updated.unitCost, 0);

        return updated;
      });

      return {
        ...prev,
        lines: nextLines,
      };
    });
  };

  const handleAddLine = () => {
    setForm((prev) => ({
      ...prev,
      lines: [...prev.lines, createEmptyLine()],
    }));
  };

  const handleRemoveLine = (index) => {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
  };

  const buildCleanLines = (sourceLines = form.lines) => {
    return sourceLines
      .map((line) => ({
        ...line,
        materialName: String(line.materialName || "").trim(),
        materialType: String(line.materialType || "").trim(),
        supplierSku: String(line.supplierSku || "").trim(),
        unit: String(line.unit || "each").trim(),
        qty: parseNumber(line.qty, 0),
        qtyReceived: Math.max(0, parseNumber(line.qtyReceived, 0)),
        qtyReceivedPosted: Math.max(0, parseNumber(line.qtyReceivedPosted, 0)),
        unitCost: parseNumber(line.unitCost, 0),
        lineTotal: parseNumber(line.qty, 0) * parseNumber(line.unitCost, 0),
        requiredQty:
          line.requiredQty === "" || line.requiredQty === null || line.requiredQty === undefined
            ? null
            : parseNumber(line.requiredQty, 0),
        requiredUnit: String(line.requiredUnit || "").trim(),
        notes: String(line.notes || "").trim(),
        linkedOrderIds: Array.isArray(line.linkedOrderIds)
          ? line.linkedOrderIds.filter(Boolean)
          : [],
        isAdHoc: !!line.isAdHoc,
      }))
      .filter((line) => line.materialName);
  };

  const persistPurchaseOrderLines = async (nextLines, nextSuccessMessage = "Purchase order updated.") => {
    if (!id) return;

    const cleanLines = buildCleanLines(nextLines);
    const subtotal = cleanLines.reduce((sum, line) => sum + parseNumber(line.lineTotal, 0), 0);

    await updateDoc(doc(db, "purchaseOrders", id), {
      supplierName: String(form.supplierName || "").trim(),
      poNumber: String(form.poNumber || "").trim(),
      status: String(form.status || "draft").trim(),
      notes: String(form.notes || "").trim(),
      receivedNotes: String(form.receivedNotes || "").trim(),
      lines: cleanLines,
      subtotal,
      tax: 0,
      total: subtotal,
      updatedAt: serverTimestamp(),
    });

    setSuccess(nextSuccessMessage);
  };

  const handleSave = async () => {
    if (!id) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await persistPurchaseOrderLines(form.lines, "Purchase order updated.");
    } catch (err) {
      console.error("Failed to save purchase order:", err);
      setError(err?.message || "Failed to save purchase order.");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusAction = async (nextStatus) => {
    if (!id) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const cleanLines = buildCleanLines();
      const subtotal = cleanLines.reduce((sum, line) => sum + parseNumber(line.lineTotal, 0), 0);
      const payload = {
        supplierName: String(form.supplierName || "").trim(),
        poNumber: String(form.poNumber || "").trim(),
        status: nextStatus,
        notes: String(form.notes || "").trim(),
        receivedNotes: String(form.receivedNotes || "").trim(),
        lines: cleanLines,
        subtotal,
        tax: 0,
        total: subtotal,
        updatedAt: serverTimestamp(),
      };

      if (nextStatus === "sent") {
        payload.sentAt = serverTimestamp();
      }

      if (nextStatus === "part_received") {
        payload.partReceivedAt = serverTimestamp();
      }

      if (nextStatus === "received") {
        payload.receivedAt = serverTimestamp();
      }

      await updateDoc(doc(db, "purchaseOrders", id), payload);
      setForm((prev) => ({ ...prev, status: nextStatus }));
      setSuccess(
        nextStatus === "sent"
          ? "Purchase order marked as sent."
          : nextStatus === "part_received"
          ? "Purchase order marked as part received."
          : "Purchase order marked as received."
      );
    } catch (err) {
      console.error("Failed to update purchase order status:", err);
      setError(err?.message || "Failed to update purchase order status.");
    } finally {
      setSaving(false);
    }
  };

  const handleReceiveAll = () => {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line) => ({
        ...line,
        qtyReceived: String(parseNumber(line.qty, 0)),
      })),
      status: "received",
    }));
  };

  const handlePostReceivedStock = async () => {
    if (!id) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const cleanLines = buildCleanLines();
      const poRef = doc(db, "purchaseOrders", id);
      const batch = writeBatch(db);

      const postedMessages = [];
      const skippedMessages = [];
      const nextLines = [];

      for (const line of cleanLines) {
        const receivedQty = Math.max(0, parseNumber(line.qtyReceived, 0));
        const alreadyPostedQty = Math.max(0, parseNumber(line.qtyReceivedPosted, 0));
        const deltaToPost = Math.max(0, receivedQty - alreadyPostedQty);

        const nextLine = { ...line };

        if (deltaToPost <= 0) {
          nextLines.push(nextLine);
          continue;
        }

        if (!line.materialId) {
          skippedMessages.push(`${line.materialName || "Unnamed line"}: no linked material.`);
          nextLines.push(nextLine);
          continue;
        }

        const materialRef = doc(db, "materials", line.materialId);
        const materialSnap = await getDoc(materialRef);

        if (!materialSnap.exists()) {
          skippedMessages.push(`${line.materialName || "Unnamed line"}: linked material not found.`);
          nextLines.push(nextLine);
          continue;
        }

        const material = materialSnap.data() || {};

        if (!unitCanPostToStock(line.unit, material)) {
          skippedMessages.push(
            `${line.materialName || "Unnamed line"}: unit mismatch (${line.unit || "—"} → ${material.stockUnit || "—"}).`
          );
          nextLines.push(nextLine);
          continue;
        }

        const currentOnHand = parseNumber(material?.stock?.onHand, 0);
        const nextOnHand = currentOnHand + deltaToPost;
        const nextStock = {
          ...(material.stock || {}),
          onHand: nextOnHand,
        };

        batch.update(materialRef, {
          stock: nextStock,
          lastCost:
            parseNumber(line.unitCost, 0) > 0
              ? parseNumber(line.unitCost, 0)
              : parseNumber(material.lastCost, 0),
          updatedAt: serverTimestamp(),
          lastReceivedAt: serverTimestamp(),
        });

        nextLine.qtyReceivedPosted = receivedQty;
        postedMessages.push(
          `${line.materialName || "Unnamed line"}: +${deltaToPost} ${line.unit || material.stockUnit || "unit"}`
        );
        nextLines.push(nextLine);
      }

      const subtotal = nextLines.reduce((sum, line) => sum + parseNumber(line.lineTotal, 0), 0);

      batch.update(poRef, {
        supplierName: String(form.supplierName || "").trim(),
        poNumber: String(form.poNumber || "").trim(),
        status: String(form.status || "draft").trim(),
        notes: String(form.notes || "").trim(),
        receivedNotes: String(form.receivedNotes || "").trim(),
        lines: nextLines,
        subtotal,
        tax: 0,
        total: subtotal,
        stockReceiptPostedAt: serverTimestamp(),
        stockReceiptPostedCount: postedMessages.length,
        stockReceiptSkippedCount: skippedMessages.length,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      if (!postedMessages.length && skippedMessages.length) {
        setError(`No stock was posted. ${skippedMessages.join(" ")}`);
      } else if (postedMessages.length && skippedMessages.length) {
        setSuccess(
          `Stock posted for ${postedMessages.length} line(s). Some lines were skipped: ${skippedMessages.join(" ")}`
        );
      } else if (postedMessages.length) {
        setSuccess(`Stock posted for ${postedMessages.length} line(s).`);
      } else {
        setSuccess("No new received stock to post.");
      }
    } catch (err) {
      console.error("Failed to post received stock:", err);
      setError(err?.message || "Failed to post received stock.");
    } finally {
      setSaving(false);
    }
  };

  const openSaveAsMaterialDialog = (index) => {
    const line = form.lines[index] || createEmptyLine();
    const matchedSupplier =
      suppliers.find((supplier) => supplier.id === purchaseOrder?.supplierId) ||
      suppliers.find(
        (supplier) =>
          String(supplier.name || "").trim().toLowerCase() ===
          String(form.supplierName || purchaseOrder?.supplierName || "")
            .trim()
            .toLowerCase()
      ) ||
      null;

    setMaterialLineIndex(index);
    setMaterialDraft(
      createMaterialDraftFromLine(
        line,
        matchedSupplier?.id || purchaseOrder?.supplierId || "",
        matchedSupplier?.name || form.supplierName || purchaseOrder?.supplierName || ""
      )
    );
    setMaterialDialogOpen(true);
  };

  const closeMaterialDialog = () => {
    if (creatingMaterial) return;
    setMaterialDialogOpen(false);
    setMaterialLineIndex(-1);
    setMaterialDraft(createMaterialDraftFromLine(createEmptyLine()));
  };

  const handleMaterialDraftChange = (field) => (event) => {
    const value = event.target.value;
    setMaterialDraft((prev) => {
      const next = {
        ...prev,
        [field]: value,
      };

      if (field === "supplierId") {
        const supplier = suppliers.find((item) => item.id === value) || null;
        next.supplierName = supplier?.name || "";
      }

      return next;
    });
  };

  const handleCreateMaterialFromLine = async () => {
    if (materialLineIndex < 0 || !form.lines[materialLineIndex]) return;

    const name = String(materialDraft.name || "").trim();
    const materialType = String(materialDraft.materialType || "other").trim();
    const stockUnit = String(materialDraft.stockUnit || "each").trim();
    const purchaseUnit = String(materialDraft.purchaseUnit || stockUnit || "each").trim();

    if (!name) {
      setError("Material name is required.");
      return;
    }

    setCreatingMaterial(true);
    setError("");
    setSuccess("");

    try {
      const sourceLine = form.lines[materialLineIndex];
      const selectedSupplier =
        suppliers.find((supplier) => supplier.id === materialDraft.supplierId) || null;
      const supplierId = selectedSupplier?.id || "";
      const supplierName =
        selectedSupplier?.name ||
        String(materialDraft.supplierName || form.supplierName || purchaseOrder?.supplierName || "").trim();
      const costPerUnit = parseNumber(materialDraft.costPerUnit, parseNumber(sourceLine.unitCost, 0));
      const preferredOrderQty = Math.max(
        1,
        parseNumber(materialDraft.preferredOrderQty, parseNumber(sourceLine.qty, 1))
      );
      const minimumOrderQty = Math.max(1, parseNumber(materialDraft.minimumOrderQty, 1));

      const materialPayload = {
        name,
        materialType,
        materialGroup: getMaterialGroupForType(materialType),
        customTypeLabel: "",
        applicableTo: getApplicableToForType(materialType),
        supplier: supplierName,
        supplierId,
        supplierName,
        supplierSku: String(materialDraft.supplierSku || sourceLine.supplierSku || "").trim(),
        supplierCode: selectedSupplier?.code || "",
        supplierEmail: selectedSupplier?.email || "",
        supplierPhone: selectedSupplier?.phone || "",
        supplierWebsite: selectedSupplier?.website || "",
        supplierAddress: selectedSupplier?.address || "",
        preferredOrderQty,
        minimumOrderQty,
        brand: "",
        sku: String(materialDraft.supplierSku || sourceLine.supplierSku || "").trim(),
        stockUnit,
        purchaseUnit,
        dimensions: {
          widthMm: null,
          lengthM: null,
          sheetWidthMm: null,
          sheetHeightMm: null,
          gsm: null,
          thicknessMicron: null,
        },
        pricing: {
          costPerUnit,
          sellPerUnit: null,
          wastagePercent: null,
        },
        stock: {
          onHand: 0,
          reorderLevel: 0,
        },
        lastCost: costPerUnit,
        status: "active",
        notes: String(materialDraft.notes || sourceLine.notes || "").trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const materialRef = await addDoc(collection(db, "materials"), materialPayload);

      const nextLines = form.lines.map((line, index) => {
        if (index !== materialLineIndex) return line;

        return {
          ...line,
          materialId: materialRef.id,
          materialName: name,
          materialType,
          supplierSku: String(materialDraft.supplierSku || line.supplierSku || "").trim(),
          unit: stockUnit,
          unitCost: String(costPerUnit),
          isAdHoc: false,
        };
      });

      setForm((prev) => ({
        ...prev,
        lines: nextLines,
      }));

      await persistPurchaseOrderLines(nextLines, "Material created and linked to this PO line.");
      closeMaterialDialog();
    } catch (err) {
      console.error("Failed to create material from PO line:", err);
      setError(err?.message || "Failed to create material from PO line.");
    } finally {
      setCreatingMaterial(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleOpenEmailDialog = () => {
    const subject = buildPurchaseOrderEmailSubject({
      purchaseOrder,
      poNumber: form.poNumber,
      supplierName: supplierSummary.name,
    });
    const body = buildPurchaseOrderEmailBody({
      purchaseOrder,
      supplier: resolvedSupplier,
      supplierName: supplierSummary.name,
      poNumber: form.poNumber,
      notes: form.notes,
      lines: form.lines,
      total: totals.total,
    });

    setEmailSubject(subject);
    setEmailBody(body);
    setEmailDialogOpen(true);
  };

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${emailSubject}

${emailBody}`);
      setSuccess("Purchase order email copied to clipboard.");
    } catch (err) {
      console.error("Failed to copy email text:", err);
      setError("Failed to copy email text.");
    }
  };

  const handleOpenEmailDraft = () => {
    const emailTo = supplierSummary.email || "";
    const mailto = `mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(
      emailSubject
    )}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailto;
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Box sx={{ displayPrint: "none" }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={<ArrowBackRoundedIcon />}
            onClick={() => history.push("/purchase-orders")}
          >
            Back to Purchase Orders
          </Button>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button
              variant="outlined"
              startIcon={<EmailRoundedIcon />}
              onClick={handleOpenEmailDialog}
              disabled={loading}
            >
              Email Output
            </Button>
            <Button
              variant="outlined"
              startIcon={<PrintRoundedIcon />}
              onClick={handlePrint}
              disabled={loading}
            >
              Print PO
            </Button>
            <Button
  variant="outlined"
  startIcon={<PictureAsPdfRoundedIcon />}
  onClick={handleExportPdf}
  disabled={loading}
>
  Export PDF
</Button>
            <Button
              variant="contained"
              startIcon={<SaveRoundedIcon />}
              onClick={handleSave}
              disabled={loading || saving}
            >
              {saving ? "Saving..." : "Save Purchase Order"}
            </Button>
          </Stack>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {success ? <Alert severity="success">{success}</Alert> : null}
        </Box>

        <Box sx={{ display: "none", displayPrint: "block" }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h4" fontWeight={700}>
                Purchase Order
              </Typography>
              <Typography>
                {form.poNumber || purchaseOrder?.poNumber || purchaseOrder?.id || "Draft Purchase Order"}
              </Typography>
            </Box>

            <Stack direction="row" spacing={4}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">Supplier</Typography>
                <Typography fontWeight={600}>{supplierSummary.name || "—"}</Typography>
                {supplierSummary.contactName ? <Typography>{supplierSummary.contactName}</Typography> : null}
                {supplierSummary.email ? <Typography>{supplierSummary.email}</Typography> : null}
                {supplierSummary.phone ? <Typography>{supplierSummary.phone}</Typography> : null}
                {supplierSummary.address ? <Typography sx={{ whiteSpace: "pre-line" }}>{supplierSummary.address}</Typography> : null}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">Order Details</Typography>
                <Typography>Status: {form.status || "draft"}</Typography>
                <Typography>Created: {formatPurchaseOrderDate(purchaseOrder?.createdAt)}</Typography>
                <Typography>Updated: {formatPurchaseOrderDate(purchaseOrder?.updatedAt)}</Typography>
                <Typography>Total: {currency(totals.total)}</Typography>
              </Box>
            </Stack>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Description</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell>Unit</TableCell>
                    <TableCell align="right">Unit Cost</TableCell>
                    <TableCell align="right">Line Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {printLines.map((line, index) => (
                    <TableRow key={`print-line-${index}`}>
                      <TableCell>
                        <Typography fontWeight={600}>{line.materialName || "—"}</Typography>
                        {line.notes ? (
                          <Typography variant="body2" color="text.secondary">
                            {line.notes}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>{line.supplierSku || "—"}</TableCell>
                      <TableCell align="right">{line.qty}</TableCell>
                      <TableCell>{line.unit || "—"}</TableCell>
                      <TableCell align="right">{currency(line.unitCost)}</TableCell>
                      <TableCell align="right">{currency(line.lineTotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Box sx={{ ml: "auto", minWidth: 260 }}>
              <Stack spacing={0.5}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography>Subtotal</Typography>
                  <Typography>{currency(totals.subtotal)}</Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography>Tax</Typography>
                  <Typography>{currency(totals.tax)}</Typography>
                </Stack>
                <Divider />
                <Stack direction="row" justifyContent="space-between">
                  <Typography fontWeight={700}>Total</Typography>
                  <Typography fontWeight={700}>{currency(totals.total)}</Typography>
                </Stack>
              </Stack>
            </Box>

            {form.notes ? (
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Notes</Typography>
                <Typography sx={{ whiteSpace: "pre-line" }}>{form.notes}</Typography>
              </Box>
            ) : null}
          </Stack>
        </Box>

        <Paper
          elevation={0}
          sx={{
            displayPrint: "none",
            p: 3,
            borderRadius: 3,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          {loading ? (
            <Box sx={{ py: 8, display: "flex", justifyContent: "center" }}>
              <CircularProgress />
            </Box>
          ) : (
            <Stack spacing={3}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="h5" fontWeight={700}>
                    {form.poNumber || purchaseOrder?.poNumber || "Purchase Order"}
                  </Typography>
                  {statusChip(form.status)}
                  {purchaseOrder?.sourceOrderIds?.length ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Linked orders: ${purchaseOrder.sourceOrderIds.length}`}
                    />
                  ) : null}
                  {purchaseOrder?.stockReceiptPostedAt ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      color="success"
                      label={`Stock posted ${timestampText(purchaseOrder.stockReceiptPostedAt)}`}
                    />
                  ) : null}
                </Stack>

                <Typography color="text.secondary">
                  Supplier: {form.supplierName || purchaseOrder?.supplierName || "—"}
                </Typography>
              </Stack>

              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <TextField
                  label="PO Number"
                  value={form.poNumber}
                  onChange={handleFieldChange("poNumber")}
                  fullWidth
                />

                <TextField
                  label="Supplier Name"
                  value={form.supplierName}
                  onChange={handleFieldChange("supplierName")}
                  fullWidth
                />

                <FormControl fullWidth>
                  <InputLabel id="po-status-label">Status</InputLabel>
                  <Select
                    labelId="po-status-label"
                    value={form.status}
                    label="Status"
                    onChange={handleFieldChange("status")}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <MenuItem key={status} value={status}>
                        {status}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Created
                  </Typography>
                  <Typography>{timestampText(purchaseOrder?.createdAt)}</Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Last Updated
                  </Typography>
                  <Typography>{timestampText(purchaseOrder?.updatedAt)}</Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Created By
                  </Typography>
                  <Typography>{purchaseOrder?.createdBy?.name || "—"}</Typography>
                </Paper>
              </Stack>

              <Divider />

              <Stack spacing={2}>
                <Stack
                  direction={{ xs: "column", lg: "row" }}
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", lg: "center" }}
                  spacing={2}
                >
                  <Box>
                    <Typography variant="h6" fontWeight={700}>
                      Receiving Workflow
                    </Typography>
                    <Typography color="text.secondary">
                      Track whether the PO has been sent, part received, or fully received.
                    </Typography>
                  </Box>

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                    <Button
                      variant="outlined"
                      startIcon={<LocalShippingRoundedIcon />}
                      onClick={() => handleStatusAction("sent")}
                      disabled={saving || form.status === "sent"}
                    >
                      Mark as Sent
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<MoveToInboxRoundedIcon />}
                      onClick={() => handleStatusAction("part_received")}
                      disabled={saving || form.status === "part_received"}
                    >
                      Mark Part Received
                    </Button>
                    <Button
                      variant="contained"
                      startIcon={<InventoryRoundedIcon />}
                      onClick={() => handleStatusAction("received")}
                      disabled={saving || form.status === "received"}
                    >
                      Mark Received
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<InventoryRoundedIcon />}
                      onClick={handlePostReceivedStock}
                      disabled={saving || totals.pendingStockQty <= 0}
                    >
                      Post Received Stock
                    </Button>
                  </Stack>
                </Stack>

                <Alert severity="info">
                  Posting stock only updates linked materials where the PO line unit matches the material stock unit. Any mismatched units are skipped so stock is not over-counted.
                </Alert>

                <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Sent At
                    </Typography>
                    <Typography>{timestampText(purchaseOrder?.sentAt)}</Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Part Received At
                    </Typography>
                    <Typography>{timestampText(purchaseOrder?.partReceivedAt)}</Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Received At
                    </Typography>
                    <Typography>{timestampText(purchaseOrder?.receivedAt)}</Typography>
                  </Paper>
                </Stack>

                <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Fully Received Lines
                    </Typography>
                    <Typography>{receivingSummary.fullyReceived}</Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Part Received Lines
                    </Typography>
                    <Typography>{receivingSummary.partiallyReceived}</Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Not Received Lines
                    </Typography>
                    <Typography>{receivingSummary.notReceived}</Typography>
                  </Paper>
                </Stack>

                <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Stock Posted Lines
                    </Typography>
                    <Typography>{receivingSummary.stockPosted}</Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Stock Pending Lines
                    </Typography>
                    <Typography>{receivingSummary.stockPending}</Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Partially Posted Lines
                    </Typography>
                    <Typography>{receivingSummary.stockPartial}</Typography>
                  </Paper>
                </Stack>

                <TextField
                  label="Receiving Notes"
                  value={form.receivedNotes}
                  onChange={handleFieldChange("receivedNotes")}
                  fullWidth
                  multiline
                  minRows={3}
                />
              </Stack>

              <Divider />

              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                spacing={2}
                alignItems={{ xs: "flex-start", sm: "center" }}
              >
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    Lines
                  </Typography>
                  <Typography color="text.secondary">
                    Edit linked material lines, add ad hoc supplier items, and record received quantities.
                  </Typography>
                </Box>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <Button variant="outlined" onClick={handleReceiveAll}>
                    Receive All Lines
                  </Button>
                  <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={handleAddLine}>
                    Add Line
                  </Button>
                </Stack>
              </Stack>

              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Material</TableCell>
                      <TableCell>Supplier SKU</TableCell>
                      <TableCell>Ordered</TableCell>
                      <TableCell>Received</TableCell>
                      <TableCell>Posted</TableCell>
                      <TableCell>Remaining</TableCell>
                      <TableCell>Unit</TableCell>
                      <TableCell>Unit Cost</TableCell>
                      <TableCell>Line Total</TableCell>
                      <TableCell>Notes</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {form.lines.map((line, index) => {
                      const orderedQty = parseNumber(line.qty, 0);
                      const receivedQty = parseNumber(line.qtyReceived, 0);
                      const postedQty = parseNumber(line.qtyReceivedPosted, 0);
                      const remainingQty = Math.max(0, orderedQty - receivedQty);
                      const receivedState = getReceivedStatus(line.qty, line.qtyReceived);
                      const postingState = getStockPostingStatus(line.qtyReceived, line.qtyReceivedPosted);

                      const handlePrint = () => {
    window.print();
  };

  const handleOpenEmailDialog = () => {
    const subject = buildPurchaseOrderEmailSubject({
      purchaseOrder,
      poNumber: form.poNumber,
      supplierName: supplierSummary.name,
    });
    const body = buildPurchaseOrderEmailBody({
      purchaseOrder,
      supplier: resolvedSupplier,
      supplierName: supplierSummary.name,
      poNumber: form.poNumber,
      notes: form.notes,
      lines: form.lines,
      total: totals.total,
    });

    setEmailSubject(subject);
    setEmailBody(body);
    setEmailDialogOpen(true);
  };

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${emailSubject}

${emailBody}`);
      setSuccess("Purchase order email copied to clipboard.");
    } catch (err) {
      console.error("Failed to copy email text:", err);
      setError("Failed to copy email text.");
    }
  };

  const handleOpenEmailDraft = () => {
    const emailTo = supplierSummary.email || "";
    const mailto = `mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(
      emailSubject
    )}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailto;
  };

  return (
                        <TableRow key={`line-${index}`}>
                          <TableCell sx={{ minWidth: 240 }}>
                            <Stack spacing={1}>
                              <TextField
                                label="Material / Item"
                                value={line.materialName}
                                onChange={(event) =>
                                  handleLineChange(index, "materialName", event.target.value)
                                }
                                fullWidth
                                size="small"
                              />
                              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                {receivedState === "full" ? (
                                  <Chip size="small" label="Received" color="success" variant="outlined" />
                                ) : receivedState === "partial" ? (
                                  <Chip size="small" label="Part Received" color="warning" variant="outlined" />
                                ) : (
                                  <Chip size="small" label="Not Received" variant="outlined" />
                                )}
                                {postingState === "posted" ? (
                                  <Chip size="small" label="Stock Posted" color="success" variant="outlined" />
                                ) : postingState === "partial" ? (
                                  <Chip size="small" label="Stock Partial" color="warning" variant="outlined" />
                                ) : postingState === "pending" ? (
                                  <Chip size="small" label="Stock Pending" color="info" variant="outlined" />
                                ) : null}
                                {line.materialId ? (
                                  <Chip
                                    size="small"
                                    icon={<LinkRoundedIcon />}
                                    label={line.materialType || "Linked Material"}
                                    color="success"
                                    variant="outlined"
                                  />
                                ) : (
                                  <Chip size="small" label="Ad Hoc" variant="outlined" />
                                )}
                                {line.linkedOrderIds?.length ? (
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label={`Linked orders: ${line.linkedOrderIds.length}`}
                                  />
                                ) : null}
                              </Stack>
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ minWidth: 140 }}>
                            <TextField
                              label="SKU"
                              value={line.supplierSku}
                              onChange={(event) =>
                                handleLineChange(index, "supplierSku", event.target.value)
                              }
                              fullWidth
                              size="small"
                            />
                          </TableCell>
                          <TableCell sx={{ minWidth: 110 }}>
                            <TextField
                              label="Qty"
                              type="number"
                              value={line.qty}
                              onChange={(event) =>
                                handleLineChange(index, "qty", event.target.value)
                              }
                              fullWidth
                              size="small"
                            />
                          </TableCell>
                          <TableCell sx={{ minWidth: 120 }}>
                            <TextField
                              label="Qty Received"
                              type="number"
                              value={line.qtyReceived}
                              onChange={(event) =>
                                handleLineChange(index, "qtyReceived", event.target.value)
                              }
                              fullWidth
                              size="small"
                            />
                          </TableCell>
                          <TableCell>{postedQty}</TableCell>
                          <TableCell>{remainingQty}</TableCell>
                          <TableCell sx={{ minWidth: 100 }}>
                            <TextField
                              label="Unit"
                              value={line.unit}
                              onChange={(event) =>
                                handleLineChange(index, "unit", event.target.value)
                              }
                              fullWidth
                              size="small"
                            />
                          </TableCell>
                          <TableCell sx={{ minWidth: 120 }}>
                            <TextField
                              label="Unit Cost"
                              type="number"
                              value={line.unitCost}
                              onChange={(event) =>
                                handleLineChange(index, "unitCost", event.target.value)
                              }
                              fullWidth
                              size="small"
                            />
                          </TableCell>
                          <TableCell>{currency(parseNumber(line.qty, 0) * parseNumber(line.unitCost, 0))}</TableCell>
                          <TableCell sx={{ minWidth: 220 }}>
                            <TextField
                              label="Notes"
                              value={line.notes}
                              onChange={(event) =>
                                handleLineChange(index, "notes", event.target.value)
                              }
                              fullWidth
                              size="small"
                              multiline
                              minRows={2}
                            />
                          </TableCell>
                          <TableCell align="right" sx={{ minWidth: 180 }}>
                            <Stack spacing={1} alignItems="flex-end">
                              {!line.materialId ? (
                                <Button
                                  variant="outlined"
                                  size="small"
                                  startIcon={<LibraryAddRoundedIcon />}
                                  onClick={() => openSaveAsMaterialDialog(index)}
                                >
                                  Save as Material
                                </Button>
                              ) : null}
                              <Button
                                color="error"
                                startIcon={<DeleteRoundedIcon />}
                                onClick={() => handleRemoveLine(index)}
                              >
                                Remove
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {!form.lines.length && (
                      <TableRow>
                        <TableCell colSpan={11}>
                          <Box sx={{ py: 5, textAlign: "center" }}>
                            <Typography color="text.secondary">
                              No lines yet. Add a line to start the purchase order.
                            </Typography>
                          </Box>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <TextField
                  label="PO Notes"
                  value={form.notes}
                  onChange={handleFieldChange("notes")}
                  fullWidth
                  multiline
                  minRows={4}
                />

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minWidth: { md: 320 } }}>
                  <Stack spacing={1}>
                    <Typography variant="h6" fontWeight={700}>
                      Totals
                    </Typography>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Subtotal</Typography>
                      <Typography>{currency(totals.subtotal)}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Tax</Typography>
                      <Typography>{currency(totals.tax)}</Typography>
                    </Stack>
                    <Divider />
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Ordered Qty</Typography>
                      <Typography>{totals.orderedQty}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Received Qty</Typography>
                      <Typography>{totals.receivedQty}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Posted to Stock</Typography>
                      <Typography>{totals.postedQty}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Pending Stock Post</Typography>
                      <Typography>{totals.pendingStockQty}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Remaining Qty</Typography>
                      <Typography>{totals.remainingQty}</Typography>
                    </Stack>
                    <Divider />
                    <Stack direction="row" justifyContent="space-between">
                      <Typography fontWeight={700}>Total</Typography>
                      <Typography fontWeight={700}>{currency(totals.total)}</Typography>
                    </Stack>
                  </Stack>
                </Paper>
              </Stack>
            </Stack>
          )}
        </Paper>
      </Stack>

      <Dialog open={emailDialogOpen} onClose={() => setEmailDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Email Purchase Order</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              This creates a clean supplier-ready email body from the current purchase order. Use <strong>Open Email Draft</strong> to open your email app or <strong>Copy Email</strong> to paste it anywhere.
            </Alert>

            <TextField
              label="To"
              value={supplierSummary.email || ""}
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField
              label="Subject"
              value={emailSubject}
              onChange={(event) => setEmailSubject(event.target.value)}
              fullWidth
            />
            <TextField
              label="Email Body"
              value={emailBody}
              onChange={(event) => setEmailBody(event.target.value)}
              fullWidth
              multiline
              minRows={16}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEmailDialogOpen(false)}>Close</Button>
          <Button startIcon={<ContentCopyRoundedIcon />} onClick={handleCopyEmail}>
            Copy Email
          </Button>
          <Button variant="contained" startIcon={<EmailRoundedIcon />} onClick={handleOpenEmailDraft}>
            Open Email Draft
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={materialDialogOpen} onClose={closeMaterialDialog} fullWidth maxWidth="sm">
        <DialogTitle>Save PO Line as Material</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              This creates a new material in your library, links it back to this PO line, and uses the current PO supplier details where possible.
            </Alert>

            <TextField
              label="Material Name"
              value={materialDraft.name}
              onChange={handleMaterialDraftChange("name")}
              fullWidth
              required
            />

            <FormControl fullWidth>
              <InputLabel id="po-material-type-label">Material Type</InputLabel>
              <Select
                labelId="po-material-type-label"
                value={materialDraft.materialType}
                label="Material Type"
                onChange={handleMaterialDraftChange("materialType")}
              >
                {MATERIAL_TYPE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="po-material-supplier-label">Supplier</InputLabel>
              <Select
                labelId="po-material-supplier-label"
                value={materialDraft.supplierId}
                label="Supplier"
                onChange={handleMaterialDraftChange("supplierId")}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {suppliers.map((supplier) => (
                  <MenuItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {!materialDraft.supplierId ? (
              <TextField
                label="Supplier Name"
                value={materialDraft.supplierName}
                onChange={handleMaterialDraftChange("supplierName")}
                fullWidth
              />
            ) : null}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Supplier SKU"
                value={materialDraft.supplierSku}
                onChange={handleMaterialDraftChange("supplierSku")}
                fullWidth
              />
              <TextField
                label="Cost Per Unit"
                type="number"
                value={materialDraft.costPerUnit}
                onChange={handleMaterialDraftChange("costPerUnit")}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Stock Unit"
                value={materialDraft.stockUnit}
                onChange={handleMaterialDraftChange("stockUnit")}
                fullWidth
              />
              <TextField
                label="Purchase Unit"
                value={materialDraft.purchaseUnit}
                onChange={handleMaterialDraftChange("purchaseUnit")}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Preferred Order Qty"
                type="number"
                value={materialDraft.preferredOrderQty}
                onChange={handleMaterialDraftChange("preferredOrderQty")}
                fullWidth
              />
              <TextField
                label="Minimum Order Qty"
                type="number"
                value={materialDraft.minimumOrderQty}
                onChange={handleMaterialDraftChange("minimumOrderQty")}
                fullWidth
              />
            </Stack>

            <TextField
              label="Notes"
              value={materialDraft.notes}
              onChange={handleMaterialDraftChange("notes")}
              fullWidth
              multiline
              minRows={3}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeMaterialDialog} disabled={creatingMaterial}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<LibraryAddRoundedIcon />}
            onClick={handleCreateMaterialFromLine}
            disabled={creatingMaterial}
          >
            {creatingMaterial ? "Creating..." : "Create Material"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
