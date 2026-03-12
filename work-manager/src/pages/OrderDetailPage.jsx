import React, { useEffect, useMemo, useRef, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
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
  Accordion,
  AccordionDetails,
  AccordionSummary,
} from "@mui/material";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import ApprovalRoundedIcon from "@mui/icons-material/ApprovalRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import ChecklistRoundedIcon from "@mui/icons-material/ChecklistRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import ShoppingCartRoundedIcon from "@mui/icons-material/ShoppingCartRounded";

import OrderTasksPanel from "../components/OrderTasksPanel";

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
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { useAuth } from "../contexts/AuthContext";
import { normalizeMaterialType, isSheetFamilyType } from "../utils/materialCompat";
import { normalizeMaterialRecord } from "../utils/materials";
import { normalizeSupplierRecord, getSupplierDisplayName } from "../utils/suppliers";
import { buildDraftPurchaseOrderPayload, groupOrderMaterialsBySupplier } from "../utils/purchaseOrders";

const INSTALL_APP_BASE_URL = "https://install-scheduler.web.app";
const FUNCTION_REGION = "australia-southeast1";

const num = (x, fallback = 0) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
};

function money(x) {
  return `$${num(x, 0).toFixed(2)}`;
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

function summaryFromLineItems(lineItems) {
  const arr = Array.isArray(lineItems) ? lineItems : [];
  if (!arr.length) return "";
  return arr.map((li) => `${li.productName || "Item"} x ${num(li.qty, 0)}`).join(" • ");
}

function normalizeTitle(s) {
  return (s || "").toString().trim().toLowerCase();
}

function makeMaterialKey(name, role, materialType, unit) {
  return [normalizeTitle(name), normalizeTitle(role), normalizeTitle(materialType), normalizeTitle(unit)].join("__");
}

function qtyLabel(qty, unit) {
  const n = num(qty, 0);
  if (unit === "m" || unit === "lm") return `${n.toFixed(2)}m`;
  if (unit === "sheets" || unit === "sheet") return `${n.toFixed(2)} sheets`;
  if (unit === "items" || unit === "each") return `${n.toFixed(0)} item${n === 1 ? "" : "s"}`;
  if (unit === "pack") return `${n.toFixed(2)} packs`;
  if (unit === "box") return `${n.toFixed(2)} boxes`;
  return `${n.toFixed(2)} ${unit || ""}`.trim();
}

function normalizeSavedMaterialsRequired(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  return arr
    .map((row, index) => {
      const role = row?.role || row?.type || "material";
      const materialType = normalizeMaterialType(row?.materialType || row?.type || "");
      return {
        key:
          row?.key ||
          makeMaterialKey(row?.name || `material-${index}`, role, materialType, row?.unit || "items"),
        id: row?.materialId || "",
        name: row?.name || "",
        type: row?.type || role,
        role,
        materialType,
        unit: row?.unit || "items",
        qty: num(row?.qty, 0),
        lineItemIds: Array.isArray(row?.lineItemIds) ? row.lineItemIds : [],
        sourceProducts: Array.isArray(row?.sourceProducts) ? row.sourceProducts : [],
        costPerUnit: num(row?.costPerUnit, 0),
        sellPerUnit: num(row?.sellPerUnit, 0),
        costTotal: num(row?.costTotal, 0),
        sellTotal: num(row?.sellTotal, 0),
      };
    })
    .filter((row) => row.name)
    .sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      return a.name.localeCompare(b.name);
    });
}

function getLinePrimaryMaterial(li) {
  const inputs = li?.inputs || {};
  return {
    id: inputs.materialId || inputs.primaryMaterialId || inputs.materialSelection?.primaryMaterialId || "",
    name: inputs.materialName || inputs.primaryMaterialName || "",
    materialType: normalizeMaterialType(
      inputs.materialType || inputs.primaryType || inputs.materialSelection?.primaryType || ""
    ),
  };
}

function getLineLaminateMaterial(li) {
  const inputs = li?.inputs || {};
  return {
    id: inputs.laminateMaterialId || "",
    name: inputs.laminateMaterialName || "",
    materialType: normalizeMaterialType(inputs.laminateMaterialType || "roll_laminate"),
  };
}

function getLineExtraMaterials(li) {
  const inputs = li?.inputs || {};
  const extras =
    inputs.extraMaterials ||
    inputs.extras ||
    inputs.materialExtras ||
    inputs.materialSelection?.extras ||
    [];

  return (Array.isArray(extras) ? extras : []).map((item, index) => ({
    key: item?.key || `${li?.id || "line"}-extra-${index}`,
    id: item?.materialId || item?.id || "",
    name: item?.materialName || item?.name || item?.label || "",
    materialType: normalizeMaterialType(item?.materialType || item?.type || item?.category || "item"),
    unit: item?.unit || item?.stockUnit || "items",
    qty: num(item?.totalQty ?? item?.quantity ?? item?.qty, 1),
    perUnit: item?.perUnit === true,
    notes: item?.notes || "",
    costPerUnit: num(item?.costPerUnit, 0),
    sellPerUnit: num(item?.sellPerUnit, 0),
    costTotal: num(item?.costTotal, 0),
    sellTotal: num(item?.sellTotal, 0),
  }));
}

function inferMaterialUsage(li, materialType, role = "primary") {
  const calc = li?.calc || {};
  const sheets = num(calc?.sheets?.billedSheets, 0);
  const metres = num(calc?.roll?.billedMetres, 0);
  const lineQty = Math.max(1, num(li?.qty, 1));

  if (role === "laminate") {
    if (metres > 0) return { unit: "m", qty: metres };
    if (sheets > 0) return { unit: "sheets", qty: sheets };
  }

  if (materialType === "roll_media" || materialType === "roll_laminate") {
    if (metres > 0) return { unit: "m", qty: metres };
    if (sheets > 0) return { unit: "sheets", qty: sheets };
    return { unit: "items", qty: lineQty };
  }

  if (isSheetFamilyType(materialType)) {
    if (sheets > 0) return { unit: "sheets", qty: sheets };
    if (metres > 0) return { unit: "m", qty: metres };
    return { unit: "items", qty: lineQty };
  }

  return { unit: "items", qty: lineQty };
}

function aggregateMaterials(lineItems) {
  const rows = Array.isArray(lineItems) ? lineItems : [];
  const map = {};

  const addMaterial = ({
    id = "",
    name,
    role,
    materialType,
    unit,
    qty,
    lineItemId,
    sourceProductName,
    costPerUnit = 0,
    sellPerUnit = 0,
    costTotal = 0,
    sellTotal = 0,
  }) => {
    const cleanName = (name || "").toString().trim();
    if (!cleanName) return;

    const normalizedRole = role || "material";
    const normalizedType = normalizeMaterialType(materialType || "");
    const normalizedUnit = unit || "items";
    const key = makeMaterialKey(cleanName, normalizedRole, normalizedType, normalizedUnit);

    if (!map[key]) {
      map[key] = {
        key,
        id: id || "",
        name: cleanName,
        type: normalizedRole,
        role: normalizedRole,
        materialType: normalizedType,
        unit: normalizedUnit,
        qty: 0,
        lineItemIds: [],
        sourceProducts: [],
        costPerUnit: 0,
        sellPerUnit: 0,
        costTotal: 0,
        sellTotal: 0,
      };
    }

    map[key].qty += num(qty, 0);
    map[key].costTotal += num(costTotal, 0);
    map[key].sellTotal += num(sellTotal, 0);
    if (num(costPerUnit, 0) > 0) map[key].costPerUnit = num(costPerUnit, 0);
    if (num(sellPerUnit, 0) > 0) map[key].sellPerUnit = num(sellPerUnit, 0);

    if (lineItemId && !map[key].lineItemIds.includes(lineItemId)) {
      map[key].lineItemIds.push(lineItemId);
    }

    if (sourceProductName && !map[key].sourceProducts.includes(sourceProductName)) {
      map[key].sourceProducts.push(sourceProductName);
    }
  };

  rows.forEach((li) => {
    const primaryMaterial = getLinePrimaryMaterial(li);
    const laminateMaterial = getLineLaminateMaterial(li);
    const extras = getLineExtraMaterials(li);

    if (primaryMaterial.name) {
      const usage = inferMaterialUsage(li, primaryMaterial.materialType, "primary");
      addMaterial({
        id: primaryMaterial.id,
        name: primaryMaterial.name,
        role:
          primaryMaterial.materialType === "item"
            ? "item"
            : primaryMaterial.materialType === "fixing"
            ? "fixing"
            : "primary",
        materialType: primaryMaterial.materialType,
        unit: usage.unit,
        qty: usage.qty,
        lineItemId: li.id,
        sourceProductName: li.productName,
      });
    } else if (normalizeTitle(li?.calculatorType) === "manual_item") {
      addMaterial({
        id: li?.productId || "",
        name: li?.productName || "Manual item",
        role: "item",
        materialType: normalizeMaterialType(li?.productSnapshot?.materialType || "item"),
        unit: "items",
        qty: Math.max(1, num(li?.qty, 1)),
        lineItemId: li.id,
        sourceProductName: li.productName,
      });
    }

    if (laminateMaterial.name) {
      const usage = inferMaterialUsage(li, laminateMaterial.materialType || "roll_laminate", "laminate");
      addMaterial({
        id: laminateMaterial.id,
        name: laminateMaterial.name,
        role: "laminate",
        materialType: laminateMaterial.materialType || "roll_laminate",
        unit: usage.unit,
        qty: usage.qty,
        lineItemId: li.id,
        sourceProductName: li.productName,
      });
    }

    extras.forEach((extra) => {
      addMaterial({
        id: extra.id,
        name: extra.name,
        role: extra.materialType === "fixing" ? "fixing" : extra.materialType === "item" ? "item" : "extra",
        materialType: extra.materialType,
        unit: extra.unit || "items",
        qty: extra.perUnit ? num(extra.qty, 1) * Math.max(1, num(li?.qty, 1)) : num(extra.qty, 1),
        lineItemId: li.id,
        sourceProductName: li.productName,
        costPerUnit: extra.costPerUnit,
        sellPerUnit: extra.sellPerUnit,
        costTotal: extra.costTotal,
        sellTotal: extra.sellTotal,
      });
    });
  });

  const roleOrder = {
    primary: 1,
    laminate: 2,
    fixing: 3,
    item: 4,
    extra: 5,
    material: 6,
  };

  return Object.values(map).sort((a, b) => {
    const roleDiff = (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
    if (roleDiff !== 0) return roleDiff;
    return a.name.localeCompare(b.name);
  });
}

function hasWord(text, words) {
  const s = normalizeTitle(text);
  return words.some((w) => s.includes(normalizeTitle(w)));
}

function buildSuggestedTasks(order, materialsRequired) {
  const lineItems = Array.isArray(order?.lineItems) ? order.lineItems : [];
  const tasks = [];

  const addTask = (title, note = "") => {
    const key = normalizeTitle(title);
    if (!tasks.find((t) => normalizeTitle(t.title) === key)) {
      tasks.push({ title, note });
    }
  };

  const anyLaminate = materialsRequired.some(
    (m) => normalizeTitle(m.role) === "laminate" || normalizeMaterialType(m.materialType) === "roll_laminate"
  );
  const anyBaseMaterial = materialsRequired.some(
    (m) => !["laminate"].includes(normalizeTitle(m.role || m.type))
  );
  const anyFixings = materialsRequired.some((m) => normalizeMaterialType(m.materialType) === "fixing");
  const anyItems = materialsRequired.some((m) => normalizeMaterialType(m.materialType) === "item");
  const anyPaperOrCard = materialsRequired.some((m) =>
    ["paper_stock", "card_stock"].includes(normalizeMaterialType(m.materialType))
  );

  const anyPrint =
    lineItems.some((li) =>
      ["roll_print_by_metre", "sheet_sign_manual_yield"].includes(li?.calculatorType)
    ) ||
    materialsRequired.some((m) =>
      ["sheet_media", "roll_media", "paper_stock", "card_stock"].includes(
        normalizeMaterialType(m.materialType)
      )
    );

  const anyTrim = lineItems.some((li) => num(li?.inputs?.minutesTrimPerUnit, 0) > 0);

  const anyDesign = lineItems.some((li) =>
    hasWord(`${li?.productName || ""} ${li?.productSnapshot?.category || ""}`, ["design", "artwork", "proof"])
  );

  const anyInstall = lineItems.some((li) =>
    hasWord(`${li?.productName || ""} ${li?.productSnapshot?.category || ""}`, ["install", "installation"])
  );

  const anyAssembly =
    anyFixings ||
    anyItems ||
    lineItems.some((li) =>
      hasWord(`${li?.productName || ""} ${li?.productSnapshot?.category || ""}`, [
        "assemble",
        "assembly",
        "frame",
        "stand",
        "a-frame",
        "aframe",
        "fabrication",
        "finish",
        "pull up",
        "pull-up",
      ])
    );

  if (anyDesign) addTask("Artwork / Design", "Complete artwork and internal design changes if required.");
  addTask("Artwork approved", "Confirm the final artwork / proof is approved before production.");

  if (anyBaseMaterial) {
    addTask(
      "Pick materials",
      materialsRequired.length
        ? materialsRequired.map((m) => `${m.name} — ${qtyLabel(m.qty, m.unit)}`).join("\n")
        : "Pick the required stock for this order."
    );
  }

  if (anyPrint) {
    addTask(
      anyPaperOrCard ? "Print / Produce" : "Print",
      anyPaperOrCard
        ? "Print or produce the required paper/card items from the approved artwork."
        : "Print the required items from the approved artwork."
    );
  }

  if (anyLaminate) addTask("Laminate", "Laminate any printed items that require laminate.");
  if (anyTrim) addTask("Trim / Cut", "Trim, cut, or route items to finished size.");
  if (anyAssembly) addTask("Finish / Assemble", "Complete assembly / finishing for the order.");
  if (anyFixings) addTask("Pick fixings / hardware", "Gather the required fixings, eyelets, brackets, or hardware.");

  addTask("QA check", "Check quantity, finish quality, spelling, and dimensions.");
  addTask("Pack / Dispatch", "Pack completed items and prepare for pickup / delivery.");

  if (anyInstall || !order?.installJobId) {
    addTask("Book install", "Arrange installation / handover if required.");
  }

  return tasks;
}

function materialTypeChip(material) {
  const role = normalizeTitle(material?.role || material?.type);
  const materialType = normalizeMaterialType(material?.materialType || material?.type || "");

  if (role === "laminate" || materialType === "roll_laminate") {
    return <Chip size="small" label="Laminate" color="secondary" variant="outlined" />;
  }
  if (materialType === "sheet_media") {
    return <Chip size="small" label="Sheet Media" color="primary" variant="outlined" />;
  }
  if (materialType === "roll_media") {
    return <Chip size="small" label="Roll Media" color="primary" variant="outlined" />;
  }
  if (materialType === "paper_stock") {
    return <Chip size="small" label="Paper" color="info" variant="outlined" />;
  }
  if (materialType === "card_stock") {
    return <Chip size="small" label="Card" color="info" variant="outlined" />;
  }
  if (materialType === "fixing" || role === "fixing") {
    return <Chip size="small" label="Fixing" color="warning" variant="outlined" />;
  }
  if (materialType === "item" || role === "item") {
    return <Chip size="small" label="Item" color="success" variant="outlined" />;
  }
  if (role === "primary") {
    return <Chip size="small" label="Material" color="primary" variant="outlined" />;
  }
  return <Chip size="small" label={materialType || role || "Material"} variant="outlined" />;
}

function hasQuotedValue(material) {
  return num(material?.costTotal, 0) > 0 || num(material?.sellTotal, 0) > 0;
}

function summarizeQuotedExtras(materialsRequired) {
  return (Array.isArray(materialsRequired) ? materialsRequired : []).reduce(
    (acc, material) => {
      if (!hasQuotedValue(material)) return acc;
      acc.count += 1;
      acc.costTotal += num(material?.costTotal, 0);
      acc.sellTotal += num(material?.sellTotal, 0);
      return acc;
    },
    {
      count: 0,
      costTotal: 0,
      sellTotal: 0,
    }
  );
}

function getMaterialSectionKey(material) {
  const role = normalizeTitle(material?.role || material?.type);
  const materialType = normalizeMaterialType(material?.materialType || material?.type || "");

  if (role === "laminate" || materialType === "roll_laminate") return "laminates";
  if (materialType === "fixing" || role === "fixing") return "fixings";
  if (materialType === "item" || role === "item" || role === "extra") return "items_extras";
  if (["sheet_media", "roll_media", "paper_stock", "card_stock"].includes(materialType) || role === "primary") {
    return "primary_media";
  }
  return "other";
}

function getMaterialSectionMeta(sectionKey) {
  switch (sectionKey) {
    case "primary_media":
      return {
        label: "Primary Media",
        description: "Base stocks used to produce the job.",
      };
    case "laminates":
      return {
        label: "Laminates",
        description: "Protective or finishing laminate materials.",
      };
    case "fixings":
      return {
        label: "Fixings",
        description: "Hardware, eyelets, brackets, and other fixings.",
      };
    case "items_extras":
      return {
        label: "Items / Extras",
        description: "Bought-in items and chargeable extras.",
      };
    default:
      return {
        label: "Other Materials",
        description: "Additional derived materials for this order.",
      };
  }
}

function groupMaterialsForDisplay(materialsRequired) {
  const groups = {};
  (Array.isArray(materialsRequired) ? materialsRequired : []).forEach((material) => {
    const sectionKey = getMaterialSectionKey(material);
    if (!groups[sectionKey]) {
      groups[sectionKey] = {
        key: sectionKey,
        ...getMaterialSectionMeta(sectionKey),
        items: [],
      };
    }
    groups[sectionKey].items.push(material);
  });

  const order = {
    primary_media: 1,
    laminates: 2,
    fixings: 3,
    items_extras: 4,
    other: 5,
  };

  return Object.values(groups)
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => (order[a.key] || 99) - (order[b.key] || 99));
}

function fileTypeChip(category) {
  const s = normalizeTitle(category);
  if (s === "proof") return <Chip size="small" label="Proof" color="secondary" variant="outlined" />;
  if (s === "artwork") return <Chip size="small" label="Artwork" color="primary" variant="outlined" />;
  if (s === "email") return <Chip size="small" label="Email" variant="outlined" />;
  if (s === "photo") return <Chip size="small" label="Photo" color="success" variant="outlined" />;
  return <Chip size="small" label={category || "File"} variant="outlined" />;
}

function proofStatusChip(status) {
  const s = normalizeTitle(status);
  if (s === "approved") return <Chip size="small" label="Approved" color="success" />;
  if (s === "changes_requested") return <Chip size="small" label="Changes Requested" color="warning" />;
  if (s === "sent") return <Chip size="small" label="Sent" color="info" />;
  return <Chip size="small" label={status || "Unknown"} />;
}

function getFunctionUrl(dbInstance, name) {
  const projectId = dbInstance?.app?.options?.projectId;
  if (!projectId) throw new Error("Missing Firebase projectId.");
  return `https://${FUNCTION_REGION}-${projectId}.cloudfunctions.net/${name}`;
}

async function readErrorText(res) {
  try {
    const text = await res.text();
    return text || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
const REVISION_TASK_TITLE = "Revise artwork from client feedback";

function isProductionTaskBlocked(taskTitle) {
  const t = normalizeTitle(taskTitle);
  const blocked = [
    "pick materials",
    "print",
    "laminate",
    "trim / cut",
    "finish / assemble",
    "qa check",
    "pack / dispatch",
    "book install",
  ];
  return blocked.includes(t);
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const history = useHistory();
  const { profile, currentUser } = useAuth();

  const [order, setOrder] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [files, setFiles] = useState([]);
  const [proofs, setProofs] = useState([]);
  const [loadingErr, setLoadingErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  const [taskOpen, setTaskOpen] = useState(false);
  const [taskEditing, setTaskEditing] = useState(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskNote, setTaskNote] = useState("");

  const [fileCategory, setFileCategory] = useState("artwork");
  const fileInputRef = useRef(null);

  const [proofOpen, setProofOpen] = useState(false);
  const [proofEmail, setProofEmail] = useState("");
  const [proofMessage, setProofMessage] = useState("");
  const [lastProofPortalUrl, setLastProofPortalUrl] = useState("");
  const [selectedProofFileIds, setSelectedProofFileIds] = useState([]);
  const [highlightProofId, setHighlightProofId] = useState("");
  const [highlightTaskTitle, setHighlightTaskTitle] = useState("");

  const [purchaseOrderDialogOpen, setPurchaseOrderDialogOpen] = useState(false);
  const [purchaseOrderLoading, setPurchaseOrderLoading] = useState(false);
  const [purchaseOrderCreating, setPurchaseOrderCreating] = useState(false);
  const [purchaseOrderSupplierGroups, setPurchaseOrderSupplierGroups] = useState([]);
  const [purchaseOrderSelectedSuppliers, setPurchaseOrderSelectedSuppliers] = useState({});
  const [purchaseOrderUnlinkedMaterials, setPurchaseOrderUnlinkedMaterials] = useState([]);
  const [purchaseOrderNote, setPurchaseOrderNote] = useState("");

  const proofHistoryRef = useRef(null);
  const tasksPanelRef = useRef(null);

  const actorName =
    profile?.shortName ||
    profile?.displayName ||
    profile?.email ||
    currentUser?.email ||
    "User";
  const actorUid = currentUser?.uid || profile?.uid || "";

  useEffect(() => {
    const unsubOrder = onSnapshot(
      doc(db, "orders", id),
      (snap) => {
        if (!snap.exists()) {
          setLoadingErr(`Order not found: ${id}`);
          setOrder(null);
          return;
        }
        setLoadingErr("");
        setOrder({ id: snap.id, ...snap.data() });
      },
      (err) => {
        console.error(err);
        setLoadingErr(err?.message || "Failed to load order");
      }
    );

    const unsubTasks = onSnapshot(
      query(collection(db, "orders", id, "tasks"), orderBy("createdAt", "asc")),
      (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error(err)
    );

    const unsubFiles = onSnapshot(
      query(collection(db, "orders", id, "files"), orderBy("uploadedAt", "desc")),
      (snap) => setFiles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error(err)
    );

    const unsubProofs = onSnapshot(
      query(collection(db, "orders", id, "proofs"), orderBy("sentAt", "desc")),
      (snap) => setProofs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error(err)
    );

    return () => {
      unsubOrder();
      unsubTasks();
      unsubFiles();
      unsubProofs();
    };
  }, [id]);

  useEffect(() => {
  if (normalizeTitle(order?.artworkApprovalStatus) === "changes_requested") {
    setHighlightTaskTitle(REVISION_TASK_TITLE);
  } else {
    setHighlightTaskTitle("");
  }
}, [order?.artworkApprovalStatus]);

useEffect(() => {
  if (normalizeTitle(order?.artworkApprovalStatus) === "changes_requested") {
    setTimeout(() => {
      scrollToRef(tasksPanelRef);
    }, 150);
  }
}, [order?.artworkApprovalStatus]);

  const materialsRequired = useMemo(() => {
    const derived = aggregateMaterials(order?.lineItems || []);
    if (derived.length) return derived;
    return normalizeSavedMaterialsRequired(order?.materialsRequired || []);
  }, [order]);

  const suggestedTasks = useMemo(
    () => buildSuggestedTasks(order, materialsRequired),
    [order, materialsRequired]
  );

  const quotedExtrasSummary = useMemo(
    () => summarizeQuotedExtras(materialsRequired),
    [materialsRequired]
  );

  const quotedExtrasRows = useMemo(
    () => materialsRequired.filter((m) => hasQuotedValue(m)),
    [materialsRequired]
  );

  const materialGroups = useMemo(
    () => groupMaterialsForDisplay(materialsRequired),
    [materialsRequired]
  );

  const proofFiles = useMemo(
    () => files.filter((f) => normalizeTitle(f.category) === "proof"),
    [files]
  );

  const selectedPurchaseOrderGroups = useMemo(
    () =>
      purchaseOrderSupplierGroups.filter(
        (group) => purchaseOrderSelectedSuppliers[group.key] !== false
      ),
    [purchaseOrderSelectedSuppliers, purchaseOrderSupplierGroups]
  );

  const openPurchaseOrderDialog = async () => {
    if (!materialsRequired.length) {
      setSnack({ open: true, msg: "No materials available to build supplier purchase orders.", severity: "warning" });
      return;
    }

    setPurchaseOrderDialogOpen(true);
    setPurchaseOrderLoading(true);
    setPurchaseOrderNote(
      `Created from order ${order?.orderNumber || order?.quoteNumber || order?.id || id}`
    );

    try {
      const [materialsSnap, suppliersSnap] = await Promise.all([
        getDocs(collection(db, "materials")),
        getDocs(collection(db, "suppliers")),
      ]);

      const materials = materialsSnap.docs.map((snap) =>
        normalizeMaterialRecord(snap.id, snap.data())
      );
      const suppliers = suppliersSnap.docs.map((snap) =>
        normalizeSupplierRecord(snap.id, snap.data())
      );

      const grouped = groupOrderMaterialsBySupplier({
        materialsRequired,
        materials,
        suppliers,
        orderId: order?.id || id,
      });

      setPurchaseOrderSupplierGroups(grouped.groups);
      setPurchaseOrderUnlinkedMaterials(grouped.unlinkedMaterials);
      setPurchaseOrderSelectedSuppliers(
        grouped.groups.reduce((acc, group) => {
          acc[group.key] = true;
          return acc;
        }, {})
      );

      if (!grouped.groups.length) {
        setSnack({
          open: true,
          msg: grouped.unlinkedMaterials.length
            ? "No supplier-linked materials found. Link suppliers to materials first."
            : "No supplier purchase orders could be created from this order.",
          severity: "warning",
        });
      }
    } catch (error) {
      console.error(error);
      setSnack({ open: true, msg: error?.message || "Failed to prepare supplier purchase orders.", severity: "error" });
    } finally {
      setPurchaseOrderLoading(false);
    }
  };

  const closePurchaseOrderDialog = () => {
    if (purchaseOrderCreating) return;
    setPurchaseOrderDialogOpen(false);
    setPurchaseOrderSupplierGroups([]);
    setPurchaseOrderSelectedSuppliers({});
    setPurchaseOrderUnlinkedMaterials([]);
    setPurchaseOrderLoading(false);
    setPurchaseOrderCreating(false);
    setPurchaseOrderNote("");
  };

  const togglePurchaseOrderSupplier = (groupKey) => {
    setPurchaseOrderSelectedSuppliers((prev) => ({
      ...prev,
      [groupKey]: prev[groupKey] === false,
    }));
  };

  const createSupplierPurchaseOrders = async () => {
    const groupsToCreate = selectedPurchaseOrderGroups;
    if (!groupsToCreate.length) {
      setSnack({ open: true, msg: "Select at least one supplier group to create purchase orders.", severity: "warning" });
      return;
    }

    setPurchaseOrderCreating(true);
    try {
      const createdIds = [];

      for (const group of groupsToCreate) {
        const payload = buildDraftPurchaseOrderPayload({
          supplier: group.supplier,
          lines: group.lines,
          currentUser,
          sourceOrderIds: [order?.id || id],
          notes: purchaseOrderNote,
        });

        const docRef = await addDoc(collection(db, "purchaseOrders"), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        createdIds.push(docRef.id);
      }

      const mergedPurchaseOrderIds = Array.from(
        new Set([
          ...(Array.isArray(order?.purchaseOrderIds) ? order.purchaseOrderIds : []),
          ...createdIds,
        ])
      );

      await updateDoc(doc(db, "orders", id), {
        purchaseOrderIds: mergedPurchaseOrderIds,
        purchaseOrderCount: mergedPurchaseOrderIds.length,
        purchaseOrdersLastCreatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSnack({
        open: true,
        msg: `Created ${createdIds.length} draft purchase order${createdIds.length === 1 ? "" : "s"}.`,
        severity: "success",
      });
      closePurchaseOrderDialog();
    } catch (error) {
      console.error(error);
      setSnack({ open: true, msg: error?.message || "Failed to create purchase orders.", severity: "error" });
    } finally {
      setPurchaseOrderCreating(false);
    }
  };

  const taskStats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.isDone === true).length;
    return { total, done, pending: Math.max(0, total - done) };
  }, [tasks]);

  const allTasksDone = useMemo(
    () => tasks.length > 0 && tasks.every((t) => t.isDone === true),
    [tasks]
  );

  const proofRequired = order?.proofRequired === true;
  const artworkApproved = normalizeTitle(order?.artworkApprovalStatus) === "approved";
  const proofGateBlocked = proofRequired && !artworkApproved;

  const scrollToRef = (ref) => {
    try {
      ref?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      ref?.current?.scrollIntoView();
    }
  };

  const openAddTask = () => {
    setTaskEditing(null);
    setTaskTitle("");
    setTaskNote("");
    setTaskOpen(true);
  };

  const openEditTask = (task) => {
    setTaskEditing(task);
    setTaskTitle(task?.title || "");
    setTaskNote(task?.note || "");
    setTaskOpen(true);
  };

  const saveTask = async () => {
    const title = (taskTitle || "").trim();
    if (!title) {
      setSnack({ open: true, msg: "Task title is required.", severity: "error" });
      return;
    }

    setBusy(true);
    try {
      if (taskEditing?.id) {
        await updateDoc(doc(db, "orders", id, "tasks", taskEditing.id), {
          title,
          note: (taskNote || "").trim(),
          updatedAt: serverTimestamp(),
        });
        setSnack({ open: true, msg: "Task updated.", severity: "success" });
      } else {
        await addDoc(collection(db, "orders", id, "tasks"), {
          title,
          note: (taskNote || "").trim(),
          isDone: false,
          createdByName: actorName,
          createdByUid: actorUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          doneAt: null,
          doneByName: "",
          doneByUid: "",
        });
        setSnack({ open: true, msg: "Task added.", severity: "success" });
      }
      setTaskOpen(false);
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to save task", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const updateProofRequired = async (value) => {
    setBusy(true);
    try {
      await updateDoc(doc(db, "orders", id), {
        proofRequired: value === true,
        updatedAt: serverTimestamp(),
      });
      setSnack({
        open: true,
        msg: value
          ? "Proof approval is now required for this order."
          : "Proof approval is no longer required for this order.",
        severity: "success",
      });
    } catch (e) {
      console.error(e);
      setSnack({
        open: true,
        msg: e?.message || "Failed to update proof requirement",
        severity: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const toggleTaskDone = async (task) => {
    if (!task?.id) return;

    if (!task.isDone && proofGateBlocked && isProductionTaskBlocked(task.title)) {
      setSnack({
        open: true,
        msg: "This production step is locked until artwork proof is approved.",
        severity: "warning",
      });
      return;
    }

    setBusy(true);
    try {
      if (task.isDone) {
        await updateDoc(doc(db, "orders", id, "tasks", task.id), {
          isDone: false,
          doneAt: null,
          doneByName: "",
          doneByUid: "",
          updatedAt: serverTimestamp(),
        });
        setSnack({ open: true, msg: "Task reopened.", severity: "success" });
      } else {
        await updateDoc(doc(db, "orders", id, "tasks", task.id), {
          isDone: true,
          doneAt: serverTimestamp(),
          doneByName: actorName,
          doneByUid: actorUid,
          updatedAt: serverTimestamp(),
        });
        setSnack({ open: true, msg: "Task checked off.", severity: "success" });
      }
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to update task", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const removeTask = async (task) => {
    if (!task?.id) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "orders", id, "tasks", task.id));
      setSnack({ open: true, msg: "Task removed.", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to remove task", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const addSuggestedTasks = async () => {
    setBusy(true);
    try {
      const existingTitles = new Set(
        tasks.map((t) => normalizeTitle(t.title)).filter(Boolean)
      );

      const toCreate = suggestedTasks.filter(
        (t) => !existingTitles.has(normalizeTitle(t.title))
      );

      if (!toCreate.length) {
        setSnack({ open: true, msg: "Suggested tasks already exist.", severity: "info" });
        return;
      }

      await Promise.all(
        toCreate.map((t) =>
          addDoc(collection(db, "orders", id, "tasks"), {
            title: t.title,
            note: t.note || "",
            isDone: false,
            createdByName: actorName,
            createdByUid: actorUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            doneAt: null,
            doneByName: "",
            doneByUid: "",
          })
        )
      );

      setSnack({ open: true, msg: "Tasks generated from order.", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to generate tasks", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const saveMaterialsSnapshot = async () => {
    setBusy(true);
    try {
      await updateDoc(doc(db, "orders", id), {
        materialsRequired: materialsRequired.map((m) => ({
          materialId: m.id || "",
          name: m.name,
          type: m.type,
          role: m.role || m.type || "material",
          materialType: m.materialType || "",
          unit: m.unit,
          qty: Number(num(m.qty, 0).toFixed(2)),
          sourceProducts: m.sourceProducts || [],
          costPerUnit: Number(num(m.costPerUnit, 0).toFixed(4)),
          sellPerUnit: Number(num(m.sellPerUnit, 0).toFixed(4)),
          costTotal: Number(num(m.costTotal, 0).toFixed(2)),
          sellTotal: Number(num(m.sellTotal, 0).toFixed(2)),
        })),
        materialsUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSnack({ open: true, msg: "Materials snapshot saved to order.", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({
        open: true,
        msg: e?.message || "Failed to save materials snapshot",
        severity: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (fileList) => {
    if (!storage) {
      setSnack({ open: true, msg: "Storage is not configured.", severity: "error" });
      return;
    }
    if (!order) return;

    const arr = Array.from(fileList || []);
    if (!arr.length) return;

    setBusy(true);
    try {
      for (const f of arr) {
        const safeName = (f.name || "file").replace(/[^\w.\-()\s]/g, "_");
        const path = `orders/${order.id}/${fileCategory}/${Date.now()}_${safeName}`;
        const storageRef = ref(storage, path);

        await uploadBytes(storageRef, f);
        const url = await getDownloadURL(storageRef);

        await addDoc(collection(db, "orders", order.id, "files"), {
          category: fileCategory,
          name: f.name || safeName,
          path,
          url,
          size: num(f.size, 0),
          contentType: f.type || "",
          uploadedAt: serverTimestamp(),
          uploadedByName: actorName,
          uploadedByUid: actorUid,
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

      await deleteDoc(doc(db, "orders", id, "files", fileDoc.id));
      setSelectedProofFileIds((prev) => prev.filter((x) => x !== fileDoc.id));
      setSnack({ open: true, msg: "File removed.", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Delete failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const openProofDialog = () => {
    setProofEmail(order?.clientSnapshot?.email || "");
    setProofMessage("");
    setLastProofPortalUrl("");
    setSelectedProofFileIds(proofFiles.map((f) => f.id));
    setProofOpen(true);
  };

  const openRevisedProofDialog = () => {
  setProofEmail(order?.clientSnapshot?.email || order?.artworkApprovalRecipientEmail || "");
  setProofMessage("");
  setLastProofPortalUrl("");
  setSelectedProofFileIds(proofFiles.map((f) => f.id));
  setProofOpen(true);
};

const sendProofEmail = async () => {
  if (!order) return;

  if (!proofEmail || !proofEmail.includes("@")) {
    setSnack({ open: true, msg: "Enter a valid client email.", severity: "error" });
    return;
  }

  if (!proofFiles.length) {
    setSnack({
      open: true,
      msg: 'Upload at least one attachment with type "Proof" first.',
      severity: "warning",
    });
    return;
  }

  if (!selectedProofFileIds.length) {
    setSnack({
      open: true,
      msg: "Select at least one proof file to send.",
      severity: "warning",
    });
    return;
  }

  setBusy(true);
  try {
    const res = await fetch(getFunctionUrl(db, "sendOrderProofEmail"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: order.id,
        emailOverride: proofEmail,
        message: proofMessage,
        senderName: actorName,
        proofFileIds: selectedProofFileIds,
      }),
    });

    if (!res.ok) throw new Error(await readErrorText(res));
    const data = await res.json();

    setLastProofPortalUrl(data?.portalUrl || "");
    setHighlightProofId(data?.proofId || "");
    setHighlightTaskTitle("");

    setOrder((prev) =>
      prev
        ? {
            ...prev,
            proofRequired: true,
            artworkApprovalStatus: "sent",
            artworkApprovalRecipientEmail: data?.sentTo || proofEmail,
            artworkApprovalRequestedAt: { toDate: () => new Date() },
            artworkApprovalRespondedAt: null,
            artworkApprovalResponseMessage: "",
            lastProofRequestId: data?.proofId || prev.lastProofRequestId || "",
          }
        : prev
    );

    setProofOpen(false);

    setSnack({
      open: true,
      msg: `Proof emailed to ${data?.sentTo || proofEmail}.`,
      severity: "success",
    });

    setTimeout(() => {
      scrollToRef(proofHistoryRef);
    }, 150);
  } catch (e) {
    console.error(e);
    setSnack({
      open: true,
      msg: e?.message || "Failed to send proof",
      severity: "error",
    });
  } finally {
    setBusy(false);
  }
};

  const sendToInstalls = async () => {
    if (!order) return;

    if (proofGateBlocked) {
      setSnack({
        open: true,
        msg: "This order requires artwork approval before it can be sent to Installs.",
        severity: "warning",
      });
      return;
    }

    if (!allTasksDone) {
      setSnack({
        open: true,
        msg: "Finish all production tasks before sending to Installs.",
        severity: "warning",
      });
      return;
    }

    if (order.installJobId) {
      window.open(
        `${INSTALL_APP_BASE_URL}/jobs/${order.installJobId}`,
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }

    setBusy(true);
    try {
      const client = order.clientSnapshot || {};
      const payload = {
        sourceOrderId: order.id,
        sourceQuoteId: order.sourceQuoteId || "",
        orderNumber: order.orderNumber || "",
        quoteNumber: order.quoteNumber || "",

        clientName: client.contactName || client.companyName || order.orderNumber || "Install Job",
        company: client.companyName || "",
        contactName: client.contactName || "",
        contact: client.contactName || "",
        address: client.address || "",
        phone: client.phone || "",
        email: client.email || "",

        description: order.notes || summaryFromLineItems(order.lineItems),
        status: "pending",

        assignedTo: [],
        hoursTotal: 0,
        referencePhotos: [],
        completed: false,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const refDoc = await addDoc(collection(db, "jobs"), payload);

      await updateDoc(doc(db, "orders", order.id), {
        installJobId: refDoc.id,
        sentToInstallsAt: serverTimestamp(),
        sentToInstallsByName: actorName,
        updatedAt: serverTimestamp(),
      });

      setSnack({ open: true, msg: "Order sent to Installs.", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to send to Installs", severity: "error" });
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

  if (!order) {
    return (
      <Box sx={{ maxWidth: 900, mx: "auto" }}>
        <Typography sx={{ opacity: 0.8 }}>Loading…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton onClick={() => history.push("/orders")} size="small" title="Back to Orders">
          <ArrowBackRoundedIcon />
        </IconButton>

        <Typography variant="h4" sx={{ fontWeight: 900, flex: 1 }}>
          {order.orderNumber || "Order"}
        </Typography>

        {order.quoteNumber ? (
          <Chip label={`Quote ${order.quoteNumber}`} size="small" variant="outlined" />
        ) : null}

        {proofRequired ? (
          artworkApproved ? (
            <Chip size="small" color="success" label="Proof Required • Approved" />
          ) : (
            <Chip size="small" color="warning" label="Proof Required • Waiting" />
          )
        ) : (
          <Chip size="small" variant="outlined" label="Proof Not Required" />
        )}

        {order.installJobId ? (
          <Button
            variant="outlined"
            startIcon={<LaunchRoundedIcon />}
            onClick={() =>
              window.open(
                `${INSTALL_APP_BASE_URL}/jobs/${order.installJobId}`,
                "_blank",
                "noopener,noreferrer"
              )
            }
            sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
          >
            Open Install Job
          </Button>
        ) : (
          <Button
            variant="contained"
            startIcon={proofGateBlocked ? <LockRoundedIcon /> : <SendRoundedIcon />}
            onClick={sendToInstalls}
            disabled={busy}
            sx={{ textTransform: "none", borderRadius: 2, fontWeight: 900 }}
          >
            Send to Installs
          </Button>
        )}
      </Stack>

      {proofGateBlocked ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This order is set to <strong>Proof Required</strong>. Production tasks like Print,
          Laminate, Trim, QA, Pack, and Book Install are locked until the artwork proof is approved.
        </Alert>
      ) : null}

      {normalizeTitle(order?.artworkApprovalStatus) === "changes_requested" ? (
        <Paper
          variant="outlined"
          sx={{
            mb: 2,
            p: 2,
            borderRadius: 3,
            borderColor: "warning.main",
            backgroundColor: "rgba(245, 158, 11, 0.08)",
          }}
        >
          <Stack spacing={1.5}>
            <Box>
              <Typography sx={{ fontWeight: 900, color: "warning.dark" }}>
                Client requested artwork changes
              </Typography>
              <Typography sx={{ opacity: 0.9, mt: 0.5, whiteSpace: "pre-wrap" }}>
                {order?.artworkApprovalResponseMessage ||
                  "The client has requested changes to the proof."}
              </Typography>
            </Box>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <Button
                variant="contained"
                color="warning"
                startIcon={<ApprovalRoundedIcon />}
                onClick={openRevisedProofDialog}
                disabled={busy || proofFiles.length === 0}
                sx={{ textTransform: "none", borderRadius: 2, fontWeight: 900 }}
              >
                Send Revised Proof
              </Button>

              <Button
                variant="outlined"
                onClick={() => scrollToRef(proofHistoryRef)}
                sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
              >
                View Proof History
              </Button>

              <Button
                variant="outlined"
                onClick={() => scrollToRef(tasksPanelRef)}
                sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
              >
                View Tasks
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            Client / Job Summary
          </Typography>
          <Divider />
          <Typography><strong>Company:</strong> {order.clientSnapshot?.companyName || "—"}</Typography>
          <Typography><strong>Contact:</strong> {order.clientSnapshot?.contactName || "—"}</Typography>
          <Typography><strong>Email:</strong> {order.clientSnapshot?.email || "—"}</Typography>
          <Typography><strong>Phone:</strong> {order.clientSnapshot?.phone || "—"}</Typography>
          <Typography><strong>Address:</strong> {order.clientSnapshot?.address || "—"}</Typography>
          <Typography><strong>Status:</strong> {order.status || "open"}</Typography>

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems={{ sm: "center" }}
          >
            <Typography component="div">
              <strong>Artwork Approval:</strong>{" "}
              {order.artworkApprovalStatus ? (
                proofStatusChip(order.artworkApprovalStatus)
              ) : (
                <Chip size="small" label="Not sent" variant="outlined" />
              )}
            </Typography>

            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Proof Requirement</InputLabel>
              <Select
                label="Proof Requirement"
                value={proofRequired ? "required" : "not_required"}
                onChange={(e) => updateProofRequired(e.target.value === "required")}
              >
                <MenuItem value="not_required">Proof Not Required</MenuItem>
                <MenuItem value="required">Proof Required</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {order.notes ? (
            <Typography sx={{ whiteSpace: "pre-wrap" }}>
              <strong>Notes:</strong> {order.notes}
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 900, mb: 1 }}>
          Line Items
        </Typography>
        <Divider sx={{ mb: 1 }} />
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 900 }}>Item</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Qty</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Sell</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(order.lineItems || []).map((li) => (
              <TableRow key={li.id}>
                <TableCell sx={{ fontWeight: 800 }}>
                  {li.productName || "Item"}
                  <Typography sx={{ opacity: 0.7, fontSize: 12 }}>
                    {li.calculatorType === "manual_item"
                      ? "Manual item"
                      : li.calculatorType === "roll_print_by_metre"
                      ? "Roll by metre"
                      : "Sheet yield"}
                    {li?.inputs?.materialName ? ` • Mat: ${li.inputs.materialName}` : ""}
                    {li?.inputs?.laminateMaterialName ? ` • Lam: ${li.inputs.laminateMaterialName}` : ""}
                    {li?.inputs?.materialExtras?.length ? ` • Extras: ${li.inputs.materialExtras.length}` : ""}
                    {num(li?.inputs?.materialExtrasSummary?.sellTotal, 0) > 0
                      ? ` • Extras Sell: $${num(li.inputs.materialExtrasSummary.sellTotal, 0).toFixed(2)}`
                      : num(li?.calc?.breakdown?.extrasSellTotal, 0) > 0
                      ? ` • Extras Sell: $${num(li.calc.breakdown.extrasSellTotal, 0).toFixed(2)}`
                      : ""}
                  </Typography>
                </TableCell>
                <TableCell>{li.qty}</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>
                  {money(li?.calc?.breakdown?.sellTotal || 0)}
                </TableCell>
              </TableRow>
            ))}
            {(order.lineItems || []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} sx={{ py: 3, textAlign: "center", opacity: 0.7 }}>
                  No line items on this order.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <Divider sx={{ my: 2 }} />

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} justifyContent="flex-end">
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, minWidth: 320 }}>
            <Typography sx={{ fontWeight: 900 }}>Totals</Typography>
            <Typography sx={{ opacity: 0.8 }}>
              Cost: <strong>{money(order?.totals?.costTotal || 0)}</strong>
            </Typography>
            <Typography sx={{ opacity: 0.8 }}>
              Sell: <strong>{money(order?.totals?.sellTotal || 0)}</strong>
            </Typography>
            <Typography sx={{ opacity: 0.8 }}>
              Items: <strong>{num(order?.totals?.itemCount, 0)}</strong>
            </Typography>
          </Paper>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems={{ md: "center" }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 1 }}
        >
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Inventory2RoundedIcon />
              <Typography variant="h6" sx={{ fontWeight: 900 }}>
                Materials Required
              </Typography>
            </Stack>
            <Typography sx={{ opacity: 0.8 }}>
              Auto-built from the materials used in the quote products.
            </Typography>
          </Box>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
            <Button
              variant="outlined"
              startIcon={<ShoppingCartRoundedIcon />}
              onClick={openPurchaseOrderDialog}
              disabled={busy || materialsRequired.length === 0}
              sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
            >
              Create Supplier POs
            </Button>
            <Button
              variant="outlined"
              onClick={saveMaterialsSnapshot}
              disabled={busy || materialsRequired.length === 0}
              sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
            >
              Save Materials Snapshot
            </Button>
          </Stack>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 2 }}>
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, minWidth: { md: 260 } }}>
            <Typography sx={{ fontWeight: 900 }}>Materials Summary</Typography>
            <Typography sx={{ opacity: 0.8 }}>
              Rows: <strong>{materialsRequired.length}</strong>
            </Typography>
            <Typography sx={{ opacity: 0.8 }}>
              Groups: <strong>{materialGroups.length}</strong>
            </Typography>
            <Typography sx={{ opacity: 0.8 }}>
              Distinct quoted extras: <strong>{quotedExtrasSummary.count}</strong>
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, minWidth: { md: 320 } }}>
            <Typography sx={{ fontWeight: 900 }}>Quoted Extras Value</Typography>
            <Typography sx={{ opacity: 0.8 }}>
              Cost: <strong>{money(quotedExtrasSummary.costTotal)}</strong>
            </Typography>
            <Typography sx={{ opacity: 0.8 }}>
              Sell: <strong>{money(quotedExtrasSummary.sellTotal)}</strong>
            </Typography>
            <Typography sx={{ opacity: 0.8 }}>
              Margin: <strong>{money(quotedExtrasSummary.sellTotal - quotedExtrasSummary.costTotal)}</strong>
            </Typography>
          </Paper>
        </Stack>

        {quotedExtrasRows.length ? (
          <Accordion sx={{ mb: 2, borderRadius: 2 }}>
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography sx={{ fontWeight: 900 }}>Quoted Extras Breakdown</Typography>
                <Chip
                  size="small"
                  label={`${quotedExtrasRows.length} row${quotedExtrasRows.length === 1 ? "" : "s"}`}
                  variant="outlined"
                />
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 900 }}>Material</TableCell>
                    <TableCell sx={{ fontWeight: 900 }}>Qty</TableCell>
                    <TableCell sx={{ fontWeight: 900 }}>Unit Sell</TableCell>
                    <TableCell sx={{ fontWeight: 900 }}>Cost</TableCell>
                    <TableCell sx={{ fontWeight: 900 }}>Sell</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {quotedExtrasRows.map((m) => (
                    <TableRow key={`quoted-${m.key}`}>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                          <Typography sx={{ fontWeight: 800 }}>{m.name}</Typography>
                          {materialTypeChip(m)}
                        </Stack>
                      </TableCell>
                      <TableCell>{qtyLabel(m.qty, m.unit)}</TableCell>
                      <TableCell>{money(m.sellPerUnit || 0)}</TableCell>
                      <TableCell>{money(m.costTotal || 0)}</TableCell>
                      <TableCell>{money(m.sellTotal || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionDetails>
          </Accordion>
        ) : null}

        <Stack spacing={2}>
          {materialGroups.map((group) => (
            <Paper key={group.key} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack spacing={1.25}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 900 }}>{group.label}</Typography>
                    <Chip
                      size="small"
                      label={`${group.items.length} row${group.items.length === 1 ? "" : "s"}`}
                      variant="outlined"
                    />
                  </Stack>
                  <Typography sx={{ opacity: 0.72, fontSize: 13 }}>
                    {group.description}
                  </Typography>
                </Box>

                <Stack spacing={1.25}>
                  {group.items.map((m) => (
                    <Paper key={m.key} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
                        <Box sx={{ flex: 1 }}>
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            sx={{ mb: 0.5, flexWrap: "wrap" }}
                          >
                            <Typography sx={{ fontWeight: 900 }}>{m.name}</Typography>
                            {materialTypeChip(m)}
                          </Stack>
                          <Typography sx={{ opacity: 0.82 }}>
                            Required: <strong>{qtyLabel(m.qty, m.unit)}</strong>
                          </Typography>
                          {hasQuotedValue(m) ? (
                            <Typography sx={{ opacity: 0.78, mt: 0.25 }}>
                              Quoted: <strong>{money(m.sellTotal || 0)}</strong>
                              {num(m.costTotal, 0) > 0 ? <> • Cost: <strong>{money(m.costTotal || 0)}</strong></> : null}
                              {num(m.sellPerUnit, 0) > 0 ? <> • Unit sell: <strong>{money(m.sellPerUnit || 0)}</strong></> : null}
                            </Typography>
                          ) : null}
                          {m.sourceProducts?.length ? (
                            <Typography sx={{ opacity: 0.65, fontSize: 12, mt: 0.5 }}>
                              Used by: {m.sourceProducts.join(" • ")}
                            </Typography>
                          ) : null}
                        </Box>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </Stack>
            </Paper>
          ))}

          {materialsRequired.length === 0 ? (
            <Typography sx={{ opacity: 0.7, textAlign: "center", py: 4 }}>
              No materials could be derived from this order yet.
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems={{ md: "center" }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 1 }}
        >
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <ApprovalRoundedIcon />
              <Typography variant="h6" sx={{ fontWeight: 900 }}>
                Artwork Proof Approval
              </Typography>
            </Stack>
            <Typography sx={{ opacity: 0.8 }}>
              Keep proof approval separate from production materials and attachments.
            </Typography>
          </Box>

          <Button
            variant="contained"
            startIcon={<ApprovalRoundedIcon />}
            onClick={openProofDialog}
            disabled={busy || !proofRequired || proofFiles.length === 0}
            sx={{ textTransform: "none", borderRadius: 2, fontWeight: 900 }}
          >
            Send Proof to Client
          </Button>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        {proofRequired ? (
          <Paper
            variant="outlined"
            sx={{ p: 1.5, borderRadius: 2, backgroundColor: "rgba(25, 118, 210, 0.03)" }}
          >
            <Stack spacing={1.25}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                alignItems={{ sm: "center" }}
                justifyContent="space-between"
              >
                <Box>
                  <Typography sx={{ fontWeight: 900 }}>Artwork Proof Approval</Typography>
                  <Typography sx={{ opacity: 0.75, fontSize: 13 }}>
                    Upload files as <strong>Proof</strong>, then send them to the client for approval.
                  </Typography>
                </Box>
              </Stack>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                alignItems={{ sm: "center" }}
                flexWrap="wrap"
              >
                <Typography component="div">
                  <strong>Status:</strong>{" "}
                  {order.artworkApprovalStatus ? (
                    proofStatusChip(order.artworkApprovalStatus)
                  ) : (
                    <Chip size="small" label="Not sent" variant="outlined" />
                  )}
                </Typography>
                <Typography sx={{ opacity: 0.8, fontSize: 13 }}>
                  Recipient: <strong>{order.artworkApprovalRecipientEmail || order.clientSnapshot?.email || "—"}</strong>
                </Typography>
                <Typography sx={{ opacity: 0.8, fontSize: 13 }}>
                  Proof files: <strong>{proofFiles.length}</strong>
                </Typography>
              </Stack>

              {proofFiles.length ? (
                <Stack spacing={1}>
                  {proofFiles.map((f) => (
                    <Paper key={f.id} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        justifyContent="space-between"
                        alignItems={{ sm: "center" }}
                        spacing={1.5}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            sx={{
                              fontWeight: 800,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {f.name || "Proof file"}
                          </Typography>
                          <Typography sx={{ opacity: 0.7, fontSize: 12 }}>
                            {f.contentType || "File"}{" "}
                            {f.size ? `• ${(Number(f.size) / 1024).toFixed(0)} KB` : ""}
                          </Typography>
                        </Box>

                        {f.url ? (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<LaunchRoundedIcon />}
                            onClick={() => window.open(f.url, "_blank", "noopener,noreferrer")}
                            sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800, flexShrink: 0 }}
                          >
                            Open
                          </Button>
                        ) : null}
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <Alert severity="warning">
                  No proof files uploaded yet. Upload one or more attachments with type <strong>Proof</strong> first.
                </Alert>
              )}
            </Stack>
          </Paper>
        ) : (
          <Alert severity="info">
            Proof approval is not required for this order.
          </Alert>
        )}
      </Paper>

      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems={{ md: "center" }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 1 }}
        >
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <UploadFileRoundedIcon />
              <Typography variant="h6" sx={{ fontWeight: 900 }}>
                Order Attachments
              </Typography>
            </Stack>
            <Typography sx={{ opacity: 0.8 }}>
              Upload artwork, proofs, emails, photos, and other order files.
            </Typography>
          </Box>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>Type</InputLabel>
              <Select
                label="Type"
                value={fileCategory}
                onChange={(e) => setFileCategory(e.target.value)}
              >
                <MenuItem value="artwork">Artwork</MenuItem>
                <MenuItem value="proof">Proof</MenuItem>
                <MenuItem value="email">Email</MenuItem>
                <MenuItem value="photo">Photo</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              startIcon={<ApprovalRoundedIcon />}
              onClick={openProofDialog}
              disabled={busy || !proofRequired || proofFiles.length === 0}
              sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
            >
              Send Proof
            </Button>

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
              sx={{ textTransform: "none", borderRadius: 2, fontWeight: 900 }}
            >
              Upload
            </Button>
          </Stack>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack spacing={1.25}>
  {files.map((f) => (
    <Paper key={f.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mb: 0.5, flexWrap: "wrap" }}
          >
            <Typography
              sx={{
                fontWeight: 900,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {f.name || "File"}
            </Typography>
            {fileTypeChip(f.category)}
          </Stack>
          <Typography sx={{ opacity: 0.7, fontSize: 12 }}>
            {f.contentType || ""}{" "}
            {f.size ? `• ${(Number(f.size) / 1024).toFixed(0)} KB` : ""}
          </Typography>
          <Typography sx={{ opacity: 0.65, fontSize: 12 }}>
            Uploaded by {f.uploadedByName || "—"} • {formatTs(f.uploadedAt)}
          </Typography>
        </Box>

        <Stack direction="row" spacing={0.5}>
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
          <IconButton title="Delete file" onClick={() => deleteFile(f)} disabled={busy}>
            <DeleteRoundedIcon />
          </IconButton>
        </Stack>
      </Stack>
    </Paper>
  ))}

  {files.length === 0 ? (
    <Typography sx={{ opacity: 0.7, textAlign: "center", py: 4 }}>
      No attachments yet.
    </Typography>
  ) : null}
</Stack>
      </Paper>

      {proofRequired ? (
        <Paper ref={proofHistoryRef} sx={{ p: 2, borderRadius: 3, mb: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <ChecklistRoundedIcon />
            <Typography variant="h6" sx={{ fontWeight: 900 }}>
              Proof History
            </Typography>
          </Stack>

          <Typography sx={{ opacity: 0.8, mb: 2 }}>
            Shows each proof request sent to the client, including the files that were included.
          </Typography>

          <Divider sx={{ mb: 2 }} />

          <Stack spacing={1.5}>
  {proofs.map((p, index) => {
    const isLatest = index === 0;
    const isHighlighted = highlightProofId === p.id;

    const summaryContent = (
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        alignItems={{ sm: "center" }}
        justifyContent="space-between"
        sx={{ width: "100%", pr: 1 }}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
          {proofStatusChip(p.status)}
          {isHighlighted ? <Chip size="small" color="success" label="Latest Sent" /> : null}
          {isLatest && !isHighlighted ? <Chip size="small" variant="outlined" label="Most Recent" /> : null}
          <Typography sx={{ fontWeight: 800 }}>
            Sent {formatTs(p.sentAt)}
          </Typography>
        </Stack>

        <Typography sx={{ opacity: 0.75, fontSize: 13 }}>
          To: <strong>{p.recipientEmail || "—"}</strong>
        </Typography>
      </Stack>
    );

    const detailContent = (
      <Stack spacing={1.25}>
        {p.message ? (
          <Paper
            variant="outlined"
            sx={{ p: 1.25, borderRadius: 2, backgroundColor: "rgba(0,0,0,0.015)" }}
          >
            <Typography sx={{ fontWeight: 800, mb: 0.5 }}>Sent message</Typography>
            <Typography sx={{ whiteSpace: "pre-wrap", opacity: 0.85 }}>
              {p.message}
            </Typography>
          </Paper>
        ) : null}

        {p.clientResponseMessage ? (
          <Paper
            variant="outlined"
            sx={{ p: 1.25, borderRadius: 2, backgroundColor: "rgba(25, 118, 210, 0.04)" }}
          >
            <Typography sx={{ fontWeight: 800, mb: 0.5 }}>Client response</Typography>
            <Typography sx={{ whiteSpace: "pre-wrap", opacity: 0.85 }}>
              {p.clientResponseMessage}
            </Typography>
            <Typography sx={{ opacity: 0.65, fontSize: 12, mt: 0.75 }}>
              Responded: {formatTs(p.respondedAt)}
            </Typography>
          </Paper>
        ) : null}

        <Box>
          <Typography sx={{ fontWeight: 800, mb: 0.75 }}>
            Files included
          </Typography>

          {Array.isArray(p.files) && p.files.length ? (
            <Stack spacing={1}>
              {p.files.map((f, idx) => (
                <Paper key={`${p.id}-${f.id || idx}`} variant="outlined" sx={{ p: 1.1, borderRadius: 2 }}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    alignItems={{ sm: "center" }}
                    spacing={1}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontWeight: 800,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {f.name || "Proof file"}
                      </Typography>
                      <Typography sx={{ opacity: 0.7, fontSize: 12 }}>
                        {f.contentType || "File"}
                      </Typography>
                    </Box>

                    {f.url ? (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<LaunchRoundedIcon />}
                        onClick={() => window.open(f.url, "_blank", "noopener,noreferrer")}
                        sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
                      >
                        Open
                      </Button>
                    ) : null}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          ) : (
            <Typography sx={{ opacity: 0.7 }}>No files recorded.</Typography>
          )}
        </Box>

        {p.approvalUrl ? (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "stretch", sm: "center" }}
          >
            <TextField
              size="small"
              fullWidth
              label="Portal link"
              value={p.approvalUrl}
              InputProps={{ readOnly: true }}
            />
            <Button
              variant="outlined"
              startIcon={<ContentCopyRoundedIcon />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(p.approvalUrl);
                  setSnack({ open: true, msg: "Portal link copied.", severity: "success" });
                } catch {
                  setSnack({ open: true, msg: "Copy failed.", severity: "error" });
                }
              }}
              sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
            >
              Copy
            </Button>
          </Stack>
        ) : null}
      </Stack>
    );

    if (isLatest || isHighlighted) {
      return (
        <Paper
          key={p.id}
          variant="outlined"
          sx={{
            p: 1.5,
            borderRadius: 2,
            borderColor: isHighlighted ? "success.main" : undefined,
            backgroundColor: isHighlighted ? "rgba(46, 125, 50, 0.08)" : undefined,
            boxShadow: isHighlighted ? "0 0 0 2px rgba(46, 125, 50, 0.12)" : undefined,
            transition: "all 0.25s ease",
          }}
        >
          <Stack spacing={1.25}>
            {summaryContent}
            {detailContent}
          </Stack>
        </Paper>
      );
    }

    return (
      <Accordion
        key={p.id}
        disableGutters
        sx={{
          borderRadius: 2,
          "&:before": { display: "none" },
          boxShadow: "none",
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
          {summaryContent}
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          {detailContent}
        </AccordionDetails>
      </Accordion>
    );
  })}

  {proofs.length === 0 ? (
    <Typography sx={{ opacity: 0.7, textAlign: "center", py: 3 }}>
      No proof requests sent yet.
    </Typography>
  ) : null}
</Stack>
        </Paper>
      ) : null}

      <Box ref={tasksPanelRef}>
  <OrderTasksPanel
    orderId={id}
    order={order}
    highlightTaskTitle={highlightTaskTitle}
  />
</Box>

      <Dialog
        open={taskOpen}
        onClose={() => (busy ? null : setTaskOpen(false))}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontWeight: 900 }}>
          {taskEditing ? "Edit Task" : "Add Task"}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Task title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              fullWidth
              autoFocus
            />
            <TextField
              label="Task notes (optional)"
              value={taskNote}
              onChange={(e) => setTaskNote(e.target.value)}
              fullWidth
              multiline
              minRows={4}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setTaskOpen(false)} disabled={busy} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={saveTask}
            disabled={busy}
            sx={{ textTransform: "none", borderRadius: 2, fontWeight: 900 }}
          >
            {taskEditing ? "Save Task" : "Add Task"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={proofOpen}
        onClose={() => (busy ? null : setProofOpen(false))}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ fontWeight: 900 }}>
          {normalizeTitle(order?.artworkApprovalStatus) === "changes_requested"
            ? "Send Revised Artwork Proof"
            : "Send Artwork Proof"}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              This emails the client a secure proof approval link. Choose which files marked as <strong>Proof</strong> should be included in this email.
            </Alert>

            <TextField
              label="Send to email"
              value={proofEmail}
              onChange={(e) => setProofEmail(e.target.value)}
              fullWidth
            />

            <TextField
              label="Message to include (optional)"
              value={proofMessage}
              onChange={(e) => setProofMessage(e.target.value)}
              fullWidth
              multiline
              minRows={4}
            />

            <Stack spacing={1}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                alignItems={{ sm: "center" }}
                justifyContent="space-between"
                spacing={1}
              >
                <Typography sx={{ fontWeight: 800 }}>
                  Proof files to send ({selectedProofFileIds.length} selected)
                </Typography>

                {proofFiles.length ? (
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setSelectedProofFileIds(proofFiles.map((f) => f.id))}
                      sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
                    >
                      Select All
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setSelectedProofFileIds([])}
                      sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
                    >
                      Clear
                    </Button>
                  </Stack>
                ) : null}
              </Stack>

              {proofFiles.length ? (
                proofFiles.map((f) => {
                  const checked = selectedProofFileIds.includes(f.id);

                  return (
                    <Paper key={f.id} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        justifyContent="space-between"
                        alignItems={{ sm: "center" }}
                        spacing={1.5}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedProofFileIds((prev) =>
                                      prev.includes(f.id) ? prev : [...prev, f.id]
                                    );
                                  } else {
                                    setSelectedProofFileIds((prev) =>
                                      prev.filter((x) => x !== f.id)
                                    );
                                  }
                                }}
                              />
                            }
                            label={
                              <Box sx={{ minWidth: 0 }}>
                                <Typography
                                  sx={{
                                    fontWeight: 800,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {f.name || "Proof file"}
                                </Typography>
                                <Typography sx={{ opacity: 0.7, fontSize: 12 }}>
                                  {f.contentType || "File"}{" "}
                                  {f.size ? `• ${(Number(f.size) / 1024).toFixed(0)} KB` : ""}
                                </Typography>
                              </Box>
                            }
                            sx={{ m: 0, alignItems: "flex-start" }}
                          />
                        </Box>

                        <Stack direction="row" spacing={1}>
                          {f.url ? (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<LaunchRoundedIcon />}
                              onClick={() => window.open(f.url, "_blank", "noopener,noreferrer")}
                              sx={{
                                textTransform: "none",
                                borderRadius: 2,
                                fontWeight: 800,
                                flexShrink: 0,
                              }}
                            >
                              Open
                            </Button>
                          ) : null}

                          <IconButton
                            color="error"
                            title="Delete proof file"
                            onClick={() => deleteFile(f)}
                            disabled={busy}
                          >
                            <DeleteRoundedIcon />
                          </IconButton>
                        </Stack>
                      </Stack>
                    </Paper>
                  );
                })
              ) : (
                <Alert severity="warning">No proof files uploaded yet.</Alert>
              )}
            </Stack>

            {lastProofPortalUrl ? (
              <>
                <Divider />
                <TextField
                  label="Latest proof portal link"
                  value={lastProofPortalUrl}
                  fullWidth
                  multiline
                  minRows={3}
                />
                <Button
                  variant="outlined"
                  startIcon={<ContentCopyRoundedIcon />}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(lastProofPortalUrl);
                      setSnack({ open: true, msg: "Portal link copied.", severity: "success" });
                    } catch {
                      setSnack({ open: true, msg: "Copy failed.", severity: "error" });
                    }
                  }}
                  sx={{ alignSelf: "flex-start", textTransform: "none", borderRadius: 2, fontWeight: 800 }}
                >
                  Copy Link
                </Button>
              </>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setProofOpen(false)} disabled={busy} sx={{ textTransform: "none" }}>
            Close
          </Button>
          <Button
            variant="contained"
            startIcon={<SendRoundedIcon />}
            onClick={sendProofEmail}
            disabled={busy}
            sx={{ textTransform: "none", borderRadius: 2, fontWeight: 900 }}
          >
            Send Proof
          </Button>
        </DialogActions>
      </Dialog>


      <Dialog
        open={purchaseOrderDialogOpen}
        onClose={closePurchaseOrderDialog}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Create Supplier Purchase Orders</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              One draft purchase order will be created for each selected supplier using the linked materials on this order.
            </Alert>

            <TextField
              label="PO Note"
              value={purchaseOrderNote}
              onChange={(event) => setPurchaseOrderNote(event.target.value)}
              fullWidth
              multiline
              minRows={2}
              disabled={purchaseOrderLoading || purchaseOrderCreating}
            />

            {purchaseOrderLoading ? (
              <Box sx={{ py: 4, display: "flex", justifyContent: "center" }}>
                <CircularProgress />
              </Box>
            ) : (
              <Stack spacing={2}>
                {purchaseOrderSupplierGroups.map((group) => {
                  const selected = purchaseOrderSelectedSuppliers[group.key] !== false;
                  return (
                    <Paper key={group.key} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                      <Stack spacing={1.25}>
                        <Stack
                          direction={{ xs: "column", md: "row" }}
                          spacing={1.5}
                          justifyContent="space-between"
                          alignItems={{ xs: "flex-start", md: "center" }}
                        >
                          <Box>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    checked={selected}
                                    onChange={() => togglePurchaseOrderSupplier(group.key)}
                                    disabled={purchaseOrderCreating}
                                  />
                                }
                                label={<Typography sx={{ fontWeight: 900 }}>{getSupplierDisplayName(group.supplier)}</Typography>}
                                sx={{ mr: 0 }}
                              />
                              <Chip size="small" label={`${group.lines.length} line${group.lines.length === 1 ? "" : "s"}`} variant="outlined" />
                            </Stack>
                            <Typography sx={{ opacity: 0.75, fontSize: 13 }}>
                              {group.supplier?.email || "No supplier email"}
                              {group.supplier?.phone ? ` • ${group.supplier.phone}` : ""}
                            </Typography>
                          </Box>

                          <Typography sx={{ fontWeight: 800 }}>
                            Draft total: {money(group.subtotal || 0)}
                          </Typography>
                        </Stack>

                        {group.warnings?.length ? (
                          <Alert severity="warning">
                            {group.warnings.join(" ")}
                          </Alert>
                        ) : null}

                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 900 }}>Material</TableCell>
                              <TableCell sx={{ fontWeight: 900 }}>Required</TableCell>
                              <TableCell sx={{ fontWeight: 900 }}>Order Qty</TableCell>
                              <TableCell sx={{ fontWeight: 900 }}>Unit Cost</TableCell>
                              <TableCell sx={{ fontWeight: 900 }}>Line Total</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {group.lines.map((line, index) => (
                              <TableRow key={`${group.key}-${index}`}>
                                <TableCell>
                                  <Typography sx={{ fontWeight: 800 }}>{line.materialName}</Typography>
                                  <Typography sx={{ opacity: 0.72, fontSize: 12 }}>
                                    {line.supplierSku ? `${line.supplierSku} • ` : ""}{line.notes || ""}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  {line.requiredQty ? `${Number(line.requiredQty).toFixed(2)} ${line.requiredUnit || ""}` : "—"}
                                </TableCell>
                                <TableCell>{`${Number(line.qty || 0).toFixed(2)} ${line.unit || ""}`}</TableCell>
                                <TableCell>{money(line.unitCost || 0)}</TableCell>
                                <TableCell>{money(line.lineTotal || 0)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Stack>
                    </Paper>
                  );
                })}

                {!purchaseOrderSupplierGroups.length ? (
                  <Alert severity="warning">
                    No supplier-linked materials were found on this order. Link suppliers on the Materials page first.
                  </Alert>
                ) : null}

                {purchaseOrderUnlinkedMaterials.length ? (
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Stack spacing={1}>
                      <Typography sx={{ fontWeight: 900 }}>Unlinked Materials</Typography>
                      <Typography sx={{ opacity: 0.75, fontSize: 13 }}>
                        These materials could not be assigned to a supplier PO yet.
                      </Typography>
                      {purchaseOrderUnlinkedMaterials.map((item, index) => (
                        <Typography key={`${item.key || item.name}-${index}`} sx={{ opacity: 0.85 }}>
                          • {item.name || "Unnamed material"} — {item.issue || "No supplier linked."}
                        </Typography>
                      ))}
                    </Stack>
                  </Paper>
                ) : null}
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closePurchaseOrderDialog} disabled={purchaseOrderCreating}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<ShoppingCartRoundedIcon />}
            onClick={createSupplierPurchaseOrders}
            disabled={purchaseOrderLoading || purchaseOrderCreating || !selectedPurchaseOrderGroups.length}
          >
            {purchaseOrderCreating ? "Creating..." : `Create ${selectedPurchaseOrderGroups.length || ""} Draft PO${selectedPurchaseOrderGroups.length === 1 ? "" : "s"}`}
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