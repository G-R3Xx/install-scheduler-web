const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const TYPE_MAP = {
  sheet: "sheet_media",
  roll: "roll_media",
  laminate: "roll_laminate",
  item: "item",
  items: "item",
  fixing: "fixing",
  fixings: "fixing",
};

export function normalizeMaterialType(input) {
  const raw =
    typeof input === "string"
      ? input
      : input?.materialType || input?.type || input?.mediaType || "";

  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  return TYPE_MAP[value] || value;
}

export function isSheetFamilyType(input) {
  const type = normalizeMaterialType(input);
  return ["sheet_media", "paper_stock", "card_stock"].includes(type);
}

export function getMaterialStatus(material) {
  const status = String(material?.status || "").trim().toLowerCase();
  if (status) return status;
  return material?.active === false ? "inactive" : "active";
}

export function isMaterialActive(material) {
  if (!material) return false;
  const status = getMaterialStatus(material);
  if (["inactive", "discontinued", "archived", "merged"].includes(status)) {
    return false;
  }
  return material?.active !== false;
}

export function getMaterialCostPerUnit(material) {
  if (!material) return 0;

  if (material?.pricing?.costPerUnit !== undefined && material?.pricing?.costPerUnit !== null && material?.pricing?.costPerUnit !== "") {
    return num(material.pricing.costPerUnit, 0);
  }

  if (num(material?.costPerSheet, 0) > 0) return num(material.costPerSheet, 0);
  if (num(material?.costPerMetre, 0) > 0) return num(material.costPerMetre, 0);
  if (num(material?.unitCost, 0) > 0) return num(material.unitCost, 0);

  return 0;
}

export function getMaterialWidthMm(material) {
  return Math.max(
    0,
    Math.floor(
      num(
        material?.dimensions?.widthMm ??
          material?.rollWidthMm ??
          material?.widthMm,
        0
      )
    )
  );
}

export function getMaterialApplicableTo(material) {
  const direct = Array.isArray(material?.applicableTo)
    ? material.applicableTo.map((item) => normalizeMaterialType(item)).filter(Boolean)
    : [];

  if (direct.length) return direct;

  const type = normalizeMaterialType(material);
  if (type === "roll_laminate") return ["sheet_media", "roll_media"];
  return [];
}

export function getLegacyCompatibleMaterial(material, mode = "sheet") {
  if (!material) return null;

  const costPerUnit = getMaterialCostPerUnit(material);
  const compat = {
    ...material,
    active: isMaterialActive(material),
    materialType: normalizeMaterialType(material),
    costPerSheet: num(material?.costPerSheet, costPerUnit),
    costPerMetre: num(material?.costPerMetre, costPerUnit),
    rollWidthMm: getMaterialWidthMm(material),
  };

  if (mode === "sheet") {
    compat.costPerSheet = num(material?.costPerSheet, costPerUnit);
  }

  if (mode === "roll") {
    compat.costPerMetre = num(material?.costPerMetre, costPerUnit);
  }

  return compat;
}

export function hasSheetCost(material) {
  const compat = getLegacyCompatibleMaterial(material, "sheet");
  return num(compat?.costPerSheet, 0) > 0;
}

export function hasRollCost(material) {
  const compat = getLegacyCompatibleMaterial(material, "roll");
  return num(compat?.costPerMetre, 0) > 0;
}

export function supportsSheetBase(material) {
  if (!isMaterialActive(material)) return false;
  const type = normalizeMaterialType(material);

  if (["sheet_media", "paper_stock", "card_stock"].includes(type)) {
    return hasSheetCost(material) || getMaterialCostPerUnit(material) > 0;
  }

  return num(material?.costPerSheet, 0) > 0;
}

export function supportsRollBase(material) {
  if (!isMaterialActive(material)) return false;
  const type = normalizeMaterialType(material);
  const widthMm = getMaterialWidthMm(material);

  if (type === "roll_media") {
    return (hasRollCost(material) || getMaterialCostPerUnit(material) > 0) && widthMm > 0;
  }

  return num(material?.costPerMetre, 0) > 0 && widthMm > 0;
}

function laminateAppliesToPrimaryType(laminate, primaryTypeInput) {
  const primaryType = normalizeMaterialType(primaryTypeInput);
  const applicableTo = getMaterialApplicableTo(laminate);

  if (!primaryType) return false;
  if (applicableTo.includes(primaryType)) return true;
  if (isSheetFamilyType(primaryType) && applicableTo.includes("sheet_media")) return true;
  return false;
}

export function supportsLaminateForBase(laminate, primaryMaterialOrType) {
  if (!isMaterialActive(laminate)) return false;

  const primaryType =
    typeof primaryMaterialOrType === "string"
      ? normalizeMaterialType(primaryMaterialOrType)
      : normalizeMaterialType(primaryMaterialOrType);

  if (!primaryType) return false;

  const laminateType = normalizeMaterialType(laminate);
  if (laminateType === "roll_laminate") {
    return laminateAppliesToPrimaryType(laminate, primaryType);
  }

  if (primaryType === "roll_media") return hasRollCost(laminate);
  if (isSheetFamilyType(primaryType)) return hasSheetCost(laminate);
  return false;
}

export function getSheetBaseMaterials(materials = []) {
  return materials.filter((material) => supportsSheetBase(material));
}

export function getRollBaseMaterials(materials = []) {
  return materials.filter((material) => supportsRollBase(material));
}

export function getLaminateOptions(materials = [], primaryMaterialOrType) {
  return materials.filter((material) => supportsLaminateForBase(material, primaryMaterialOrType));
}

export function getMaterialDisplayName(material) {
  if (!material) return "";
  const type = normalizeMaterialType(material);
  const labelParts = [material.name || "Unnamed material"];

  if (type) labelParts.push(type.replace(/_/g, " "));
  if (material.brand) labelParts.push(material.brand);

  return labelParts.join(" • ");
}
