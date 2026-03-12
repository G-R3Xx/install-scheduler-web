import { resolveMaterialJobProfile } from "../constants/materialProfiles";
import { normalizeMaterialType } from "./materialCompat";

export function createEmptyMaterialExtra() {
  return {
    materialId: "",
    quantity: "1",
    notes: "",
  };
}

export function normalizeMaterialSelection(value = {}) {
  return {
    primaryType: value.primaryType || "",
    primaryMaterialId: value.primaryMaterialId || value.materialId || "",
    laminateMaterialId: value.laminateMaterialId || "",
    extras: Array.isArray(value.extras)
      ? value.extras.map((item) => ({
          ...createEmptyMaterialExtra(),
          ...item,
          quantity:
            item?.quantity !== null &&
            item?.quantity !== undefined &&
            item?.quantity !== ""
              ? String(item.quantity)
              : "1",
        }))
      : [],
  };
}

export function buildMaterialSelectionForSave(value = {}) {
  const normalized = normalizeMaterialSelection(value);

  return {
    primaryType: normalized.primaryType || "",
    primaryMaterialId: normalized.primaryMaterialId || "",
    laminateMaterialId: normalized.laminateMaterialId || "",
    extras: normalized.extras
      .filter((item) => item.materialId)
      .map((item) => ({
        materialId: item.materialId,
        quantity: Number(item.quantity || 1),
        notes: String(item.notes || "").trim(),
      })),
  };
}

export function getMaterialById(materials = [], id = "") {
  return materials.find((item) => item.id === id) || null;
}

export function getActiveMaterials(materials = []) {
  return materials.filter((item) => {
    const status = String(item?.status || "active").toLowerCase();
    return item && !["inactive", "discontinued", "archived", "merged"].includes(status) && item?.active !== false;
  });
}

export function getAvailablePrimaryTypes(materials = [], profileOrKey = "sheet_signage") {
  const profile =
    typeof profileOrKey === "string"
      ? resolveMaterialJobProfile(profileOrKey)
      : profileOrKey;

  const activeMaterials = getActiveMaterials(materials);

  return profile.primaryTypes.filter((type) =>
    activeMaterials.some((item) => normalizeMaterialType(item) === type)
  );
}

export function getPrimaryMaterials(materials = [], primaryType = "", profileOrKey = "sheet_signage") {
  const profile =
    typeof profileOrKey === "string"
      ? resolveMaterialJobProfile(profileOrKey)
      : profileOrKey;

  if (!primaryType || !profile.primaryTypes.includes(primaryType)) return [];

  return getActiveMaterials(materials)
    .filter((item) => normalizeMaterialType(item) === primaryType)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function getCompatibleLaminates(materials = [], primaryMaterial = null, profileOrKey = "sheet_signage") {
  const profile =
    typeof profileOrKey === "string"
      ? resolveMaterialJobProfile(profileOrKey)
      : profileOrKey;

  if (!primaryMaterial) return [];

  const primaryType = normalizeMaterialType(primaryMaterial);

  if (!profile.laminateCompatiblePrimaryTypes.includes(primaryType)) {
    return [];
  }

  return getActiveMaterials(materials)
    .filter((item) => normalizeMaterialType(item) === "roll_laminate")
    .filter((item) => {
      const applies = Array.isArray(item?.applicableTo) ? item.applicableTo.map(normalizeMaterialType) : [];
      if (!applies.length) return ["sheet_media", "roll_media"].includes(primaryType) || ["paper_stock", "card_stock"].includes(primaryType);
      if (applies.includes(primaryType)) return true;
      if (["paper_stock", "card_stock"].includes(primaryType) && applies.includes("sheet_media")) return true;
      return false;
    })
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function getOptionalExtraMaterials(materials = [], profileOrKey = "sheet_signage") {
  const profile =
    typeof profileOrKey === "string"
      ? resolveMaterialJobProfile(profileOrKey)
      : profileOrKey;

  return getActiveMaterials(materials)
    .filter((item) => profile.optionalExtraTypes.includes(normalizeMaterialType(item)))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function coerceSelectionForProfile(rawSelection = {}, materials = [], profileOrKey = "sheet_signage") {
  const profile =
    typeof profileOrKey === "string"
      ? resolveMaterialJobProfile(profileOrKey)
      : profileOrKey;

  const selection = normalizeMaterialSelection(rawSelection);
  const availablePrimaryTypes = getAvailablePrimaryTypes(materials, profile);
  const fallbackPrimaryType = availablePrimaryTypes.includes(profile.defaultPrimaryType)
    ? profile.defaultPrimaryType
    : availablePrimaryTypes[0] || "";

  if (!selection.primaryType || !availablePrimaryTypes.includes(selection.primaryType)) {
    selection.primaryType = fallbackPrimaryType;
  }

  const primaryMaterials = getPrimaryMaterials(materials, selection.primaryType, profile);
  if (!primaryMaterials.some((item) => item.id === selection.primaryMaterialId)) {
    selection.primaryMaterialId = primaryMaterials[0]?.id || "";
  }

  const selectedPrimary = getMaterialById(materials, selection.primaryMaterialId);
  const laminates = getCompatibleLaminates(materials, selectedPrimary, profile);
  if (!laminates.some((item) => item.id === selection.laminateMaterialId)) {
    selection.laminateMaterialId = "";
  }

  const allowedExtraIds = new Set(getOptionalExtraMaterials(materials, profile).map((item) => item.id));
  selection.extras = selection.extras
    .filter((item) => !item.materialId || allowedExtraIds.has(item.materialId))
    .map((item) => ({
      ...createEmptyMaterialExtra(),
      ...item,
      quantity:
        item?.quantity !== null &&
        item?.quantity !== undefined &&
        item?.quantity !== ""
          ? String(item.quantity)
          : "1",
    }));

  return selection;
}

export function getProductMaterialProfileFromCalculator(calculatorType = "") {
  const value = String(calculatorType || "").trim().toLowerCase();
  if (value === "roll_print_by_metre") return "roll_signage";
  if (value === "manual_item") return "display_item";
  return "sheet_signage";
}

export function buildSelectionFromLegacy(primaryMaterialId = "", laminateMaterialId = "", materials = []) {
  const primary = getMaterialById(materials, primaryMaterialId);
  return normalizeMaterialSelection({
    primaryType: normalizeMaterialType(primary),
    primaryMaterialId,
    laminateMaterialId,
    extras: [],
  });
}
