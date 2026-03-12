export const MATERIAL_JOB_PROFILES = {
  sheet_signage: {
    key: "sheet_signage",
    label: "Sheet Signage",
    description:
      "Choose a sheet-family base material, then optionally add a compatible laminate and extras.",
    primaryTypes: ["sheet_media", "paper_stock", "card_stock"],
    defaultPrimaryType: "sheet_media",
    laminateCompatiblePrimaryTypes: ["sheet_media", "paper_stock", "card_stock"],
    optionalExtraTypes: ["fixing", "item"],
  },
  roll_signage: {
    key: "roll_signage",
    label: "Roll Signage",
    description:
      "Choose a roll base material, then optionally add a compatible laminate and extras.",
    primaryTypes: ["roll_media"],
    defaultPrimaryType: "roll_media",
    laminateCompatiblePrimaryTypes: ["roll_media"],
    optionalExtraTypes: ["fixing", "item"],
  },
  display_item: {
    key: "display_item",
    label: "Display Item",
    description:
      "Item-based products can also include optional extras such as fixings or additional bought-in items.",
    primaryTypes: ["item"],
    defaultPrimaryType: "item",
    laminateCompatiblePrimaryTypes: [],
    optionalExtraTypes: ["fixing", "item"],
  },
};

export function resolveMaterialJobProfile(profileKey) {
  return MATERIAL_JOB_PROFILES[profileKey] || MATERIAL_JOB_PROFILES.sheet_signage;
}
