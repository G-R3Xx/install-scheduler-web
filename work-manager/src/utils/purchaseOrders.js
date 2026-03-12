function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDateForNumber(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUnitToken(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  const map = {
    sheets: "sheet",
    sheet: "sheet",
    items: "each",
    item: "each",
    each: "each",
    ea: "each",
    lm: "lm",
    m: "lm",
    metre: "lm",
    metres: "lm",
    meter: "lm",
    meters: "lm",
    packs: "pack",
    pack: "pack",
    boxes: "box",
    box: "box",
    rolls: "roll",
    roll: "roll",
    reams: "ream",
    ream: "ream",
    pairs: "pair",
    pair: "pair",
    sets: "set",
    set: "set",
    cartons: "carton",
    carton: "carton",
    pallets: "pallet",
    pallet: "pallet",
  };
  return map[raw] || raw;
}

function qtyLabel(qty, unit) {
  const n = parseNumber(qty, 0);
  const token = normalizeUnitToken(unit) || unit || "";
  if (token === "lm") return `${n.toFixed(2)} lm`;
  if (token === "sheet") return `${n.toFixed(2)} sheets`;
  if (token === "each") return `${n.toFixed(0)} items`;
  if (token === "roll") return `${n.toFixed(2)} rolls`;
  if (token === "pack") return `${n.toFixed(2)} packs`;
  if (token === "box") return `${n.toFixed(2)} boxes`;
  return `${n.toFixed(2)} ${unit || ""}`.trim();
}

function chooseMaterialCost(material, options = {}) {
  return parseNumber(
    options.unitCost ?? material?.lastCost ?? material?.pricing?.costPerUnit ?? material?.unitCost,
    0
  );
}

export function generateDraftPurchaseOrderNumber(date = new Date()) {
  return `PO-${formatDateForNumber(date)}-${String(date.getTime()).slice(-5)}`;
}

export function buildPurchaseOrderLineFromMaterial(material, options = {}) {
  const quantity = parseNumber(options.quantity || material?.preferredOrderQty || 1, 1);
  const unitCost = chooseMaterialCost(material, options);

  return {
    materialId: material?.id || "",
    materialName: material?.name || "",
    materialType: material?.materialType || "",
    supplierSku: material?.supplierSku || "",
    qty: quantity,
    unit: material?.purchaseUnit || material?.stockUnit || "each",
    unitCost,
    lineTotal: quantity * unitCost,
    notes: String(options.notes || "").trim(),
    linkedOrderIds: Array.isArray(options.linkedOrderIds)
      ? options.linkedOrderIds.filter(Boolean)
      : [],
    isAdHoc: false,
  };
}

function findMaterialMatch(materials = [], requirement = {}) {
  const requirementId = String(requirement?.id || requirement?.materialId || "").trim();
  const requirementName = normalizeText(requirement?.name);
  const requirementType = normalizeText(requirement?.materialType || requirement?.type || "");

  if (requirementId) {
    const byId = materials.find((item) => String(item?.id || "").trim() === requirementId);
    if (byId) return byId;
  }

  if (requirementName) {
    const byNameAndType = materials.find((item) => {
      const itemName = normalizeText(item?.name);
      const itemType = normalizeText(item?.materialType || item?.type || "");
      return itemName === requirementName && (!requirementType || !itemType || itemType === requirementType);
    });
    if (byNameAndType) return byNameAndType;

    const byName = materials.find((item) => normalizeText(item?.name) === requirementName);
    if (byName) return byName;
  }

  return null;
}

function getSuggestedPurchaseQuantity(material, requirement = {}) {
  const requiredQty = Math.max(0, parseNumber(requirement?.qty, 0));
  const onHandQty = Math.max(0, parseNumber(material?.stock?.onHand, 0));
  const minimumOrderQty = Math.max(0, parseNumber(material?.minimumOrderQty, 0));
  const preferredOrderQty = Math.max(0, parseNumber(material?.preferredOrderQty, 0));

  const requirementUnit = normalizeUnitToken(requirement?.unit);
  const stockUnit = normalizeUnitToken(material?.stockUnit);
  const purchaseUnit = normalizeUnitToken(material?.purchaseUnit || material?.stockUnit || requirement?.unit || "each");

  const sameStockUnit = !!requirementUnit && !!stockUnit && requirementUnit == stockUnit
  const samePurchaseUnit = !!requirementUnit && !!purchaseUnit && requirementUnit == purchaseUnit

  if (samePurchaseUnit || sameStockUnit) {
    const shortage = Math.max(0, requiredQty - onHandQty);
    const baseQty = shortage > 0 ? shortage : requiredQty;
    return Math.max(baseQty, minimumOrderQty, preferredOrderQty, baseQty > 0 ? 0 : 1);
  }

  if (["roll", "box", "pack", "ream", "set", "pair", "carton", "pallet"].includes(purchaseUnit)) {
    return Math.max(minimumOrderQty, preferredOrderQty, 1);
  }

  return Math.max(requiredQty, minimumOrderQty, preferredOrderQty, 1);
}

function getRequirementNote(material, requirement = {}) {
  const requiredQty = parseNumber(requirement?.qty, 0);
  const requirementUnit = requirement?.unit || material?.stockUnit || "each";
  const purchaseUnit = normalizeUnitToken(material?.purchaseUnit || material?.stockUnit || requirementUnit || "each");
  const stockUnit = normalizeUnitToken(material?.stockUnit || requirementUnit || "each");
  const requirementToken = normalizeUnitToken(requirementUnit);

  const notes = [];
  notes.push(`Required for order: ${qtyLabel(requiredQty, requirementUnit)}`);

  if (parseNumber(material?.stock?.onHand, 0) > 0) {
    notes.push(`Stock on hand: ${qtyLabel(material.stock.onHand, material?.stockUnit || requirementUnit)}`);
  }

  if (requirementToken && purchaseUnit && requirementToken !== purchaseUnit && requirementToken !== stockUnit) {
    notes.push(`Review purchase conversion from ${requirementUnit} to ${material?.purchaseUnit || material?.stockUnit || "purchase unit"}`);
  }

  return notes.join(" • ");
}

export function buildPurchaseOrderLineFromMaterialRequirement(material, requirement, options = {}) {
  const quantity = parseNumber(options.quantity, NaN);
  const finalQty = Number.isFinite(quantity)
    ? quantity
    : getSuggestedPurchaseQuantity(material, requirement);
  const unitCost = chooseMaterialCost(material, options);

  return {
    materialId: material?.id || requirement?.id || "",
    materialName: material?.name || requirement?.name || "",
    materialType: material?.materialType || requirement?.materialType || "",
    supplierSku: material?.supplierSku || "",
    qty: finalQty,
    unit: material?.purchaseUnit || material?.stockUnit || requirement?.unit || "each",
    unitCost,
    lineTotal: finalQty * unitCost,
    requiredQty: parseNumber(requirement?.qty, 0),
    requiredUnit: requirement?.unit || material?.stockUnit || "each",
    notes: String(options.notes || getRequirementNote(material, requirement)).trim(),
    linkedOrderIds: Array.isArray(options.linkedOrderIds)
      ? options.linkedOrderIds.filter(Boolean)
      : [],
    isAdHoc: false,
  };
}

export function buildDraftPurchaseOrderPayload({
  supplier,
  lines = [],
  currentUser = null,
  sourceOrderIds = [],
  notes = "",
} = {}) {
  const cleanLines = lines.filter((line) => line && line.materialName);
  const subtotal = cleanLines.reduce(
    (sum, line) => sum + parseNumber(line.lineTotal, 0),
    0
  );

  return {
    supplierId: supplier?.id || "",
    supplierName: supplier?.name || "",
    poNumber: generateDraftPurchaseOrderNumber(),
    status: "draft",
    sourceOrderIds: Array.isArray(sourceOrderIds) ? sourceOrderIds.filter(Boolean) : [],
    notes: String(notes || "").trim(),
    subtotal,
    tax: 0,
    total: subtotal,
    createdBy: {
      uid: currentUser?.uid || "",
      name: currentUser?.displayName || currentUser?.email || "",
    },
    lines: cleanLines,
  };
}

export function groupOrderMaterialsBySupplier({
  materialsRequired = [],
  materials = [],
  suppliers = [],
  orderId = "",
} = {}) {
  const groups = {};
  const unlinkedMaterials = [];

  (Array.isArray(materialsRequired) ? materialsRequired : []).forEach((requirement) => {
    const matchedMaterial = findMaterialMatch(materials, requirement);

    if (!matchedMaterial) {
      unlinkedMaterials.push({
        ...requirement,
        issue: "Material record not found in library.",
      });
      return;
    }

    const supplierId = String(matchedMaterial?.supplierId || "").trim();
    const supplierName = String(matchedMaterial?.supplierName || matchedMaterial?.supplier || "").trim();

    const supplier =
      suppliers.find((item) => String(item?.id || "").trim() === supplierId) ||
      suppliers.find((item) => normalizeText(item?.name) === normalizeText(supplierName)) ||
      null;

    if (!supplier && !supplierName) {
      unlinkedMaterials.push({
        ...requirement,
        materialId: matchedMaterial.id,
        issue: "No supplier linked to material.",
      });
      return;
    }

    const supplierKey = supplier?.id || `name:${normalizeText(supplierName)}`;
    if (!groups[supplierKey]) {
      groups[supplierKey] = {
        key: supplierKey,
        supplier: supplier || {
          id: supplierId,
          name: supplierName,
          code: "",
          email: "",
          phone: "",
          status: "active",
        },
        lines: [],
        materialRows: [],
        warnings: [],
      };
    }

    const line = buildPurchaseOrderLineFromMaterialRequirement(matchedMaterial, requirement, {
      linkedOrderIds: orderId ? [orderId] : [],
    });

    groups[supplierKey].lines.push(line);
    groups[supplierKey].materialRows.push({
      ...requirement,
      materialId: matchedMaterial.id,
      supplierId: supplier?.id || supplierId,
      supplierName: supplier?.name || supplierName,
      suggestedPurchaseQty: line.qty,
      purchaseUnit: line.unit,
      supplierSku: line.supplierSku,
      linkedMaterial: matchedMaterial,
    });

    if (line.notes && line.notes.toLowerCase().includes("review purchase conversion")) {
      groups[supplierKey].warnings.push(`${line.materialName}: review purchase conversion.`);
    }
  });

  return {
    groups: Object.values(groups)
      .map((group) => ({
        ...group,
        subtotal: group.lines.reduce((sum, line) => sum + parseNumber(line.lineTotal, 0), 0),
      }))
      .sort((a, b) => String(a.supplier?.name || "").localeCompare(String(b.supplier?.name || ""))),
    unlinkedMaterials,
  };
}

export function normalizePurchaseOrderRecord(id, data = {}) {
  return {
    id,
    supplierId: data.supplierId || "",
    supplierName: data.supplierName || "",
    poNumber: data.poNumber || "",
    status: data.status || "draft",
    sourceOrderIds: Array.isArray(data.sourceOrderIds) ? data.sourceOrderIds : [],
    notes: data.notes || "",
    subtotal: parseNumber(data.subtotal, 0),
    tax: parseNumber(data.tax, 0),
    total: parseNumber(data.total, 0),
    createdBy: data.createdBy || { uid: "", name: "" },
    lines: Array.isArray(data.lines) ? data.lines : [],
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}
