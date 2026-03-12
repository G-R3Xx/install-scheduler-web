export const MATERIAL_TYPES = [
  { value: "sheet_media", label: "Sheet Media", group: "print_media" },
  { value: "roll_media", label: "Roll Media", group: "print_media" },
  { value: "roll_laminate", label: "Roll Laminate", group: "laminate" },
  { value: "card_stock", label: "Card Stock", group: "card" },
  { value: "paper_stock", label: "Paper Stock", group: "paper" },
  { value: "fixing", label: "Fixings", group: "fixing" },
  { value: "item", label: "Items", group: "display_product" },
  { value: "other", label: "Other", group: "other" },
];

export const MATERIAL_GROUPS = [
  { value: "print_media", label: "Print Media" },
  { value: "laminate", label: "Laminate" },
  { value: "paper", label: "Paper" },
  { value: "card", label: "Card" },
  { value: "fixing", label: "Fixing" },
  { value: "display_product", label: "Display Product" },
  { value: "consumable", label: "Consumable" },
  { value: "other", label: "Other" },
];

export const APPLICABLE_TO_OPTIONS = [
  { value: "sheet_media", label: "Sheet Media" },
  { value: "roll_media", label: "Roll Media" },
  { value: "card_stock", label: "Card Stock" },
  { value: "paper_stock", label: "Paper Stock" },
  { value: "item", label: "Items" },
  { value: "fixing", label: "Fixings" },
];

export const STOCK_UNITS = [
  { value: "each", label: "Each" },
  { value: "sheet", label: "Sheet" },
  { value: "sqm", label: "m²" },
  { value: "lm", label: "Linear Metre" },
  { value: "roll", label: "Roll" },
  { value: "pack", label: "Pack" },
  { value: "box", label: "Box" },
  { value: "ream", label: "Ream" },
  { value: "set", label: "Set" },
  { value: "pair", label: "Pair" },
  { value: "tube", label: "Tube" },
];

export const PURCHASE_UNITS = [
  { value: "each", label: "Each" },
  { value: "sheet", label: "Sheet" },
  { value: "roll", label: "Roll" },
  { value: "pack", label: "Pack" },
  { value: "box", label: "Box" },
  { value: "ream", label: "Ream" },
  { value: "set", label: "Set" },
  { value: "pair", label: "Pair" },
  { value: "carton", label: "Carton" },
  { value: "pallet", label: "Pallet" },
  { value: "other", label: "Other" },
];

export const MATERIAL_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "discontinued", label: "Discontinued" },
];

export function getMaterialTypeMeta(type) {
  return (
    MATERIAL_TYPES.find((item) => item.value === type) || {
      value: "other",
      label: "Other",
      group: "other",
    }
  );
}

export function getMaterialTypeLabel(type) {
  return getMaterialTypeMeta(type).label;
}

export function getMaterialGroupLabel(group) {
  return (
    MATERIAL_GROUPS.find((item) => item.value === group)?.label || "Other"
  );
}

export function getApplicableToLabel(value) {
  return (
    APPLICABLE_TO_OPTIONS.find((item) => item.value === value)?.label || value
  );
}

export function getStockUnitLabel(value) {
  return STOCK_UNITS.find((item) => item.value === value)?.label || value || "—";
}

export function getPurchaseUnitLabel(value) {
  return (
    PURCHASE_UNITS.find((item) => item.value === value)?.label || value || "—"
  );
}