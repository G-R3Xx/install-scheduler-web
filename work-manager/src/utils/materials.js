import { getMaterialTypeMeta } from "../constants/materials";

function normalizeLegacyMaterialType(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return "other";
  if (raw === "sheet") return "sheet_media";
  if (raw === "roll") return "roll_media";
  if (raw === "laminate") return "roll_laminate";
  if (raw === "fixings") return "fixing";
  if (raw === "items") return "item";

  return raw;
}

function parseNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getDefaultMaterialForm() {
  return {
    name: "",
    materialType: "sheet_media",
    materialGroup: "print_media",
    customTypeLabel: "",
    applicableTo: [],
    supplierId: "",
    supplierName: "",
    supplierSku: "",
    supplier: "",
    brand: "",
    sku: "",
    stockUnit: "sheet",
    purchaseUnit: "sheet",
    preferredOrderQty: "",
    minimumOrderQty: "",
    lastCost: "",
    dimensions: {
      widthMm: "",
      lengthM: "",
      sheetWidthMm: "",
      sheetHeightMm: "",
      gsm: "",
      thicknessMicron: "",
    },
    pricing: {
      costPerUnit: "",
      sellPerUnit: "",
      wastagePercent: "",
    },
    stock: {
      onHand: "",
      reorderLevel: "",
    },
    status: "active",
    notes: "",
  };
}

export function normalizeMaterialRecord(id, data = {}) {
  const normalizedType = normalizeLegacyMaterialType(
    data.materialType || data.type || data.mediaType
  );

  const typeMeta = getMaterialTypeMeta(normalizedType);
  const supplierName = data.supplierName || data.supplier || "";

  return {
    id,
    name: data.name || "",
    materialType: normalizedType,
    materialGroup: data.materialGroup || typeMeta.group || "other",
    customTypeLabel: data.customTypeLabel || "",
    applicableTo: Array.isArray(data.applicableTo) ? data.applicableTo : [],
    supplierId: data.supplierId || "",
    supplierName,
    supplier: supplierName,
    supplierSku: data.supplierSku || "",
    brand: data.brand || "",
    sku: data.sku || "",
    stockUnit: data.stockUnit || "",
    purchaseUnit: data.purchaseUnit || "",
    preferredOrderQty:
      data.preferredOrderQty !== null &&
      data.preferredOrderQty !== undefined &&
      data.preferredOrderQty !== ""
        ? data.preferredOrderQty
        : "",
    minimumOrderQty:
      data.minimumOrderQty !== null &&
      data.minimumOrderQty !== undefined &&
      data.minimumOrderQty !== ""
        ? data.minimumOrderQty
        : "",
    lastCost:
      data.lastCost !== null &&
      data.lastCost !== undefined &&
      data.lastCost !== ""
        ? data.lastCost
        : "",
    dimensions: {
      widthMm: data.dimensions?.widthMm ?? "",
      lengthM: data.dimensions?.lengthM ?? "",
      sheetWidthMm: data.dimensions?.sheetWidthMm ?? "",
      sheetHeightMm: data.dimensions?.sheetHeightMm ?? "",
      gsm: data.dimensions?.gsm ?? "",
      thicknessMicron: data.dimensions?.thicknessMicron ?? "",
    },
    pricing: {
      costPerUnit: data.pricing?.costPerUnit ?? "",
      sellPerUnit: data.pricing?.sellPerUnit ?? "",
      wastagePercent: data.pricing?.wastagePercent ?? "",
    },
    stock: {
      onHand: data.stock?.onHand ?? "",
      reorderLevel: data.stock?.reorderLevel ?? "",
    },
    status: data.status || "active",
    notes: data.notes || "",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

export function getInitialMaterialForm(material = null) {
  if (!material) return getDefaultMaterialForm();

  return {
    name: material.name || "",
    materialType: material.materialType || "sheet_media",
    materialGroup: material.materialGroup || "other",
    customTypeLabel: material.customTypeLabel || "",
    applicableTo: Array.isArray(material.applicableTo)
      ? material.applicableTo
      : [],
    supplierId: material.supplierId || "",
    supplierName: material.supplierName || material.supplier || "",
    supplier: material.supplierName || material.supplier || "",
    supplierSku: material.supplierSku || "",
    brand: material.brand || "",
    sku: material.sku || "",
    stockUnit: material.stockUnit || "",
    purchaseUnit: material.purchaseUnit || "",
    preferredOrderQty:
      material.preferredOrderQty !== "" &&
      material.preferredOrderQty !== null &&
      material.preferredOrderQty !== undefined
        ? String(material.preferredOrderQty)
        : "",
    minimumOrderQty:
      material.minimumOrderQty !== "" &&
      material.minimumOrderQty !== null &&
      material.minimumOrderQty !== undefined
        ? String(material.minimumOrderQty)
        : "",
    lastCost:
      material.lastCost !== "" &&
      material.lastCost !== null &&
      material.lastCost !== undefined
        ? String(material.lastCost)
        : "",
    dimensions: {
      widthMm:
        material.dimensions?.widthMm !== "" &&
        material.dimensions?.widthMm !== null &&
        material.dimensions?.widthMm !== undefined
          ? String(material.dimensions.widthMm)
          : "",
      lengthM:
        material.dimensions?.lengthM !== "" &&
        material.dimensions?.lengthM !== null &&
        material.dimensions?.lengthM !== undefined
          ? String(material.dimensions.lengthM)
          : "",
      sheetWidthMm:
        material.dimensions?.sheetWidthMm !== "" &&
        material.dimensions?.sheetWidthMm !== null &&
        material.dimensions?.sheetWidthMm !== undefined
          ? String(material.dimensions.sheetWidthMm)
          : "",
      sheetHeightMm:
        material.dimensions?.sheetHeightMm !== "" &&
        material.dimensions?.sheetHeightMm !== null &&
        material.dimensions?.sheetHeightMm !== undefined
          ? String(material.dimensions.sheetHeightMm)
          : "",
      gsm:
        material.dimensions?.gsm !== "" &&
        material.dimensions?.gsm !== null &&
        material.dimensions?.gsm !== undefined
          ? String(material.dimensions.gsm)
          : "",
      thicknessMicron:
        material.dimensions?.thicknessMicron !== "" &&
        material.dimensions?.thicknessMicron !== null &&
        material.dimensions?.thicknessMicron !== undefined
          ? String(material.dimensions.thicknessMicron)
          : "",
    },
    pricing: {
      costPerUnit:
        material.pricing?.costPerUnit !== "" &&
        material.pricing?.costPerUnit !== null &&
        material.pricing?.costPerUnit !== undefined
          ? String(material.pricing.costPerUnit)
          : "",
      sellPerUnit:
        material.pricing?.sellPerUnit !== "" &&
        material.pricing?.sellPerUnit !== null &&
        material.pricing?.sellPerUnit !== undefined
          ? String(material.pricing.sellPerUnit)
          : "",
      wastagePercent:
        material.pricing?.wastagePercent !== "" &&
        material.pricing?.wastagePercent !== null &&
        material.pricing?.wastagePercent !== undefined
          ? String(material.pricing.wastagePercent)
          : "",
    },
    stock: {
      onHand:
        material.stock?.onHand !== "" &&
        material.stock?.onHand !== null &&
        material.stock?.onHand !== undefined
          ? String(material.stock.onHand)
          : "",
      reorderLevel:
        material.stock?.reorderLevel !== "" &&
        material.stock?.reorderLevel !== null &&
        material.stock?.reorderLevel !== undefined
          ? String(material.stock.reorderLevel)
          : "",
    },
    status: material.status || "active",
    notes: material.notes || "",
  };
}

export function buildMaterialPayload(form) {
  const normalizedType = normalizeLegacyMaterialType(form.materialType);
  const typeMeta = getMaterialTypeMeta(normalizedType);
  const supplierName = String(form.supplierName || form.supplier || "").trim();

  return {
    name: String(form.name || "").trim(),
    materialType: normalizedType,
    materialGroup: form.materialGroup || typeMeta.group || "other",
    customTypeLabel: String(form.customTypeLabel || "").trim(),
    applicableTo: Array.isArray(form.applicableTo)
      ? form.applicableTo.filter(Boolean)
      : [],
    supplierId: String(form.supplierId || "").trim(),
    supplierName,
    supplier: supplierName,
    supplierSku: String(form.supplierSku || "").trim(),
    brand: String(form.brand || "").trim(),
    sku: String(form.sku || "").trim(),
    stockUnit: String(form.stockUnit || "").trim(),
    purchaseUnit: String(form.purchaseUnit || "").trim(),
    preferredOrderQty:
      form.preferredOrderQty === "" ? null : parseNumber(form.preferredOrderQty, 0),
    minimumOrderQty:
      form.minimumOrderQty === "" ? null : parseNumber(form.minimumOrderQty, 0),
    lastCost: form.lastCost === "" ? null : parseNumber(form.lastCost, 0),
    dimensions: {
      widthMm:
        form.dimensions?.widthMm === "" ? null : parseNumber(form.dimensions?.widthMm, 0),
      lengthM:
        form.dimensions?.lengthM === "" ? null : parseNumber(form.dimensions?.lengthM, 0),
      sheetWidthMm:
        form.dimensions?.sheetWidthMm === ""
          ? null
          : parseNumber(form.dimensions?.sheetWidthMm, 0),
      sheetHeightMm:
        form.dimensions?.sheetHeightMm === ""
          ? null
          : parseNumber(form.dimensions?.sheetHeightMm, 0),
      gsm: form.dimensions?.gsm === "" ? null : parseNumber(form.dimensions?.gsm, 0),
      thicknessMicron:
        form.dimensions?.thicknessMicron === ""
          ? null
          : parseNumber(form.dimensions?.thicknessMicron, 0),
    },
    pricing: {
      costPerUnit:
        form.pricing?.costPerUnit === ""
          ? null
          : parseNumber(form.pricing?.costPerUnit, 0),
      sellPerUnit:
        form.pricing?.sellPerUnit === ""
          ? null
          : parseNumber(form.pricing?.sellPerUnit, 0),
      wastagePercent:
        form.pricing?.wastagePercent === ""
          ? null
          : parseNumber(form.pricing?.wastagePercent, 0),
    },
    stock: {
      onHand: form.stock?.onHand === "" ? null : parseNumber(form.stock?.onHand, 0),
      reorderLevel:
        form.stock?.reorderLevel === ""
          ? null
          : parseNumber(form.stock?.reorderLevel, 0),
    },
    status: String(form.status || "active").trim(),
    notes: String(form.notes || "").trim(),
  };
}

export function sortMaterials(items = []) {
  return [...items].sort((a, b) => {
    const aName = String(a.name || "").toLowerCase();
    const bName = String(b.name || "").toLowerCase();
    return aName.localeCompare(bName);
  });
}

export function isLowStock(material) {
  const onHand = Number(material?.stock?.onHand || 0);
  const reorderLevel = Number(material?.stock?.reorderLevel || 0);

  if (!reorderLevel) return false;
  return onHand <= reorderLevel;
}
