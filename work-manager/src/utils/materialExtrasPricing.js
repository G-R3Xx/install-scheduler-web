import { getMaterialCostPerUnit, normalizeMaterialType } from "./materialCompat";

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function getMaterialSellPerUnit(material) {
  if (!material) return 0;

  if (
    material?.pricing?.sellPerUnit !== undefined &&
    material?.pricing?.sellPerUnit !== null &&
    material?.pricing?.sellPerUnit !== ""
  ) {
    const explicitSell = num(material.pricing.sellPerUnit, 0);
    if (explicitSell > 0) return explicitSell;
  }

  if (material?.sellPerUnit !== undefined && material?.sellPerUnit !== null && material?.sellPerUnit !== "") {
    const explicitSell = num(material.sellPerUnit, 0);
    if (explicitSell > 0) return explicitSell;
  }

  return getMaterialCostPerUnit(material);
}

export function priceMaterialExtras(extras = [], materials = [], options = {}) {
  const lineQty = Math.max(1, num(options?.lineQty, 1));
  const discountPct = Math.max(0, num(options?.discountPct, 0));
  const rows = Array.isArray(extras) ? extras : [];

  return rows
    .map((extra, index) => {
      const material = materials.find((item) => item.id === extra?.materialId) || null;
      const quantityPerItem = Math.max(0, num(extra?.quantity, 0));
      const totalQty = quantityPerItem * lineQty;
      const costPerUnit = getMaterialCostPerUnit(material);
      const sellPerUnit = getMaterialSellPerUnit(material);
      const sellTotalBeforeDiscount = totalQty * sellPerUnit;
      const discountAmount = sellTotalBeforeDiscount * (discountPct / 100);
      const sellTotal = sellTotalBeforeDiscount - discountAmount;
      const costTotal = totalQty * costPerUnit;

      return {
        key: extra?.key || `extra-${index}`,
        materialId: extra?.materialId || "",
        name: material?.name || extra?.name || "",
        materialType: normalizeMaterialType(material || extra?.materialType || extra?.type || "item"),
        materialGroup: material?.materialGroup || extra?.materialGroup || "",
        unit: material?.stockUnit || extra?.unit || "each",
        quantity: quantityPerItem,
        perUnit: true,
        notes: String(extra?.notes || "").trim(),
        costPerUnit,
        sellPerUnit,
        costTotal,
        sellTotalBeforeDiscount,
        discountPct,
        discountAmount,
        sellTotal,
      };
    })
    .filter((row) => row.materialId || row.name || row.quantity > 0);
}

export function summarizeMaterialExtras(rows = []) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (acc, row) => {
      acc.costTotal += num(row?.costTotal, 0);
      acc.sellTotalBeforeDiscount += num(row?.sellTotalBeforeDiscount, 0);
      acc.discountAmount += num(row?.discountAmount, 0);
      acc.sellTotal += num(row?.sellTotal, 0);
      return acc;
    },
    {
      costTotal: 0,
      sellTotalBeforeDiscount: 0,
      discountAmount: 0,
      sellTotal: 0,
    }
  );
}

export function applyExtrasToPreview(preview, pricedExtras = [], options = {}) {
  if (!preview) return preview;

  const lineQty = Math.max(1, num(options?.lineQty, 1));
  const extrasSummary = summarizeMaterialExtras(pricedExtras);

  if (
    extrasSummary.costTotal === 0 &&
    extrasSummary.sellTotalBeforeDiscount === 0 &&
    extrasSummary.discountAmount === 0 &&
    extrasSummary.sellTotal === 0
  ) {
    return {
      ...preview,
      extras: pricedExtras,
      breakdown: {
        ...(preview.breakdown || {}),
        extrasCostTotal: 0,
        extrasSellTotalBeforeDiscount: 0,
        extrasDiscountAmount: 0,
        extrasSellTotal: 0,
      },
    };
  }

  const baseBreakdown = preview.breakdown || {};
  const nextCostTotal = num(baseBreakdown.costTotal, 0) + extrasSummary.costTotal;
  const nextSellBeforeDiscount =
    num(baseBreakdown.sellTotalBeforeDiscount, 0) + extrasSummary.sellTotalBeforeDiscount;
  const nextDiscountAmount = num(baseBreakdown.discountAmount, 0) + extrasSummary.discountAmount;
  const nextSellTotal = num(baseBreakdown.sellTotal, 0) + extrasSummary.sellTotal;

  const nextBreakdown = {
    ...baseBreakdown,
    extrasCostTotal: extrasSummary.costTotal,
    extrasSellTotalBeforeDiscount: extrasSummary.sellTotalBeforeDiscount,
    extrasDiscountAmount: extrasSummary.discountAmount,
    extrasSellTotal: extrasSummary.sellTotal,
    costTotal: nextCostTotal,
    sellTotalBeforeDiscount: nextSellBeforeDiscount,
    discountAmount: nextDiscountAmount,
    sellTotal: nextSellTotal,
    margin: nextSellTotal - nextCostTotal,
  };

  const baseUnit = preview.unit || {};
  const unitCostBase = num(baseUnit.cost, 0);
  const unitSellBase = num(baseUnit.sell, 0);
  const unitSellBeforeBase =
    baseUnit.sellBeforeDiscount !== undefined
      ? num(baseUnit.sellBeforeDiscount, 0)
      : unitSellBase;

  return {
    ...preview,
    extras: pricedExtras,
    unit: {
      ...baseUnit,
      cost: unitCostBase + extrasSummary.costTotal / lineQty,
      sellBeforeDiscount: unitSellBeforeBase + extrasSummary.sellTotalBeforeDiscount / lineQty,
      sell: unitSellBase + extrasSummary.sellTotal / lineQty,
    },
    breakdown: nextBreakdown,
  };
}
