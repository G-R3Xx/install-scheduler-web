// work-manager/src/services/pricingEngine.js
// Supports:
/// SHEETS
// - Stock $/sheet via sheet material
// - Laminate $/sheet via optional laminate sheet material
// - Ink via RateCard ink $/m² OR optional product override inkPerM2Override
// - Labour via trim minutes (rounded to block) + optional labourPerSheet ($/sheet)
//
// ROLLS
// - Stock $/m via roll material
// - Laminate $/m via optional laminate roll material
// - Ink $/m per side via optional inkPerMetre (else derived from ink $/m² and nesting width)
// - Labour $/m via optional labourPerMetre + trim minutes
//
// And globally:
// - Markup + Profit Margin
// - Combined discounts (client tier + qty tiers)

function n(x, fallback = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function ceilToStep(value, step) {
  const s = Math.max(0.000001, n(step, 0.5));
  return Math.ceil(value / s) * s;
}

function clampPct(x) {
  const v = n(x, 0);
  return Math.min(100, Math.max(0, v));
}

function computeSellFactor(markupPct, profitMarginPct) {
  const m = 1 + clampPct(markupPct) / 100;
  const p = 1 + clampPct(profitMarginPct) / 100;
  return m * p;
}

function applyDiscount(amount, discountPct) {
  const d = clampPct(discountPct) / 100;
  const after = amount * (1 - d);
  return {
    discountPct: clampPct(discountPct),
    before: amount,
    after,
    discountAmount: amount - after,
  };
}

// ===== SHEET sign (manual yield + min sheets + step) =====
export function calcSheetSignManualYield({
  qty,
  widthMm,
  heightMm,
  sides,
  unitsPerSheet,
  minutesTrimPerUnit,
  minSheetEquiv,
  sheetStep,

  // NEW (optional)
  inkPerM2Override, // if >0, overrides rateCard ink per m²
  labourPerSheet,   // if >0, adds billedSheets * labourPerSheet
  laminateMaterial, // optional SHEET material

  discountPct,
  rateCard,
  material, // sheet material (stock)
}) {
  const q = Math.max(1, Math.floor(n(qty, 1)));
  const wMm = n(widthMm, 0);
  const hMm = n(heightMm, 0);
  const s = Math.max(1, Math.floor(n(sides, 1)));
  const ups = Math.max(1, Math.floor(n(unitsPerSheet, 1)));
  const minPer = Math.max(0, n(minutesTrimPerUnit, 0));

  const labourPerHour = n(rateCard?.labourPerHour, 0);
  const blockMinutes = Math.max(1, Math.floor(n(rateCard?.labourBlockMinutes, 5)));
  const inkPerM2Base = n(rateCard?.inkPerM2, 0);

  const markupPct = n(rateCard?.markupPct, 0);
  const profitMarginPct = n(rateCard?.profitMarginPct, 0);

  const costPerSheet = n(material?.costPerSheet, 0);
  const lamCostPerSheet = n(laminateMaterial?.costPerSheet, 0);

  const areaM2 = (wMm / 1000) * (hMm / 1000);

  // Material (sheets)
  const rawSheets = q / ups;
  const minSheets = Math.max(0, n(minSheetEquiv, 0.5));
  const step = Math.max(0.000001, n(sheetStep, 0.5));
  const billedSheets = ceilToStep(Math.max(rawSheets, minSheets), step);

  const stockTotal = billedSheets * costPerSheet;
  const laminateTotal = laminateMaterial ? billedSheets * lamCostPerSheet : 0;

  // Ink (area)
  const inkPerM2Effective = n(inkPerM2Override, 0) > 0 ? n(inkPerM2Override, 0) : inkPerM2Base;
  const inkTotal = areaM2 * inkPerM2Effective * s * q;

  // Labour (trim blocks) + optional sheet labour
  const totalMinutes = minPer * q;
  const blocks = Math.ceil(totalMinutes / blockMinutes);
  const blockCost = (labourPerHour / 60) * blockMinutes;
  const labourTrimTotal = blocks * blockCost;

  const labourPerSheetEffective = Math.max(0, n(labourPerSheet, 0));
  const labourSheetTotal = labourPerSheetEffective > 0 ? billedSheets * labourPerSheetEffective : 0;

  const labourTotal = labourTrimTotal + labourSheetTotal;

  const costTotal = stockTotal + laminateTotal + inkTotal + labourTotal;

  // Sell (markup + profit margin)
  const sellFactor = computeSellFactor(markupPct, profitMarginPct);
  const sellTotalBeforeDiscount = costTotal * sellFactor;

  // Discounts
  const disc = applyDiscount(sellTotalBeforeDiscount, discountPct);
  const sellTotal = disc.after;

  return {
    qty: q,
    inputs: {
      widthMm: wMm,
      heightMm: hMm,
      sides: s,
      unitsPerSheet: ups,
      minutesTrimPerUnit: minPer,
      minSheetEquiv: minSheets,
      sheetStep: step,
      inkPerM2Override: n(inkPerM2Override, 0),
      labourPerSheet: labourPerSheetEffective,
      discountPct: disc.discountPct,
    },
    rates: {
      labourPerHour,
      labourBlockMinutes: blockMinutes,
      inkPerM2: inkPerM2Base,
      inkPerM2Effective,
      markupPct,
      profitMarginPct,
    },
    areaM2,
    sheets: {
      rawSheets,
      minSheets,
      sheetStep: step,
      billedSheets,
      costPerSheet,
      laminateCostPerSheet: lamCostPerSheet,
    },
    breakdown: {
      stockTotal,
      laminateTotal,
      inkTotal,
      labourSheetTotal,
      labourTrimTotal,
      labourTotal,
      costTotal,
      sellFactor,
      sellTotalBeforeDiscount,
      discountPct: disc.discountPct,
      discountAmount: disc.discountAmount,
      sellTotal,
    },
    unit: {
      cost: costTotal / q,
      sellBeforeDiscount: sellTotalBeforeDiscount / q,
      sell: sellTotal / q,
    },
    labour: {
      totalMinutes,
      blocks,
      blockMinutes,
      blockCost,
    },
  };
}

// ===== ROLL print (priced per metre) =====
export function calcRollPrintByMetre({
  qty,
  widthMm,
  heightMm,
  sides,
  minutesTrimPerUnit,

  minMetres,
  metreStep,

  inkPerMetre,     // optional override ($/m per side)
  labourPerMetre,  // optional override ($/m)

  discountPct,

  rateCard,
  material,         // roll material (print stock)
  laminateMaterial, // optional roll material (laminate)
}) {
  const q = Math.max(1, Math.floor(n(qty, 1)));
  const wMm = Math.max(0, n(widthMm, 0));
  const hMm = Math.max(0, n(heightMm, 0));
  const s = Math.max(1, Math.floor(n(sides, 1)));
  const minPer = Math.max(0, n(minutesTrimPerUnit, 0));

  const labourPerHour = n(rateCard?.labourPerHour, 0);
  const blockMinutes = Math.max(1, Math.floor(n(rateCard?.labourBlockMinutes, 5)));
  const inkPerM2 = n(rateCard?.inkPerM2, 0);

  const markupPct = n(rateCard?.markupPct, 0);
  const profitMarginPct = n(rateCard?.profitMarginPct, 0);

  const printCostPerMetre = n(material?.costPerMetre, 0);
  const rollWidthMm = Math.max(0, n(material?.rollWidthMm, 0));
  const lamCostPerMetre = n(laminateMaterial?.costPerMetre, 0);

  // unitsAcross nesting
  let unitsAcross = 1;
  if (rollWidthMm > 0 && wMm > 0) unitsAcross = Math.max(1, Math.floor(rollWidthMm / wMm));

  const rawMetres = ((hMm / 1000) * q) / unitsAcross;

  const minM = Math.max(0, n(minMetres, 1));
  const step = Math.max(0.000001, n(metreStep, 0.1));
  const billedMetres = ceilToStep(Math.max(rawMetres, minM), step);

  // Stock ($/m)
  const stockTotal = billedMetres * printCostPerMetre;

  // Laminate ($/m)
  const laminateTotal = laminateMaterial ? billedMetres * lamCostPerMetre : 0;

  // Ink ($/m): derive from inkPerM2 and used nesting width if not provided
  const pieceWidthM = wMm / 1000;
  const usedWidthM = unitsAcross * pieceWidthM;
  const derivedInkPerMetre = usedWidthM * inkPerM2; // per side

  const inkPerMetreEffective = n(inkPerMetre, 0) > 0 ? n(inkPerMetre, 0) : derivedInkPerMetre;
  const inkTotal = billedMetres * inkPerMetreEffective * s;

  // Labour: per-m + trim blocks
  const labourPerMetreEffective = Math.max(0, n(labourPerMetre, 0));
  const labourMetreTotal = labourPerMetreEffective > 0 ? billedMetres * labourPerMetreEffective : 0;

  const totalMinutes = minPer * q;
  const blocks = Math.ceil(totalMinutes / blockMinutes);
  const blockCost = (labourPerHour / 60) * blockMinutes;
  const labourTrimTotal = blocks * blockCost;

  const labourTotal = labourMetreTotal + labourTrimTotal;

  const costTotal = stockTotal + laminateTotal + inkTotal + labourTotal;

  const sellFactor = computeSellFactor(markupPct, profitMarginPct);
  const sellTotalBeforeDiscount = costTotal * sellFactor;

  const disc = applyDiscount(sellTotalBeforeDiscount, discountPct);
  const sellTotal = disc.after;

  return {
    qty: q,
    inputs: {
      widthMm: wMm,
      heightMm: hMm,
      sides: s,
      minutesTrimPerUnit: minPer,
      minMetres: minM,
      metreStep: step,
      inkPerMetre: inkPerMetreEffective,
      labourPerMetre: labourPerMetreEffective,
      discountPct: disc.discountPct,
    },
    rates: {
      labourPerHour,
      labourBlockMinutes: blockMinutes,
      inkPerM2,
      markupPct,
      profitMarginPct,
    },
    roll: {
      rollWidthMm,
      unitsAcross,
      rawMetres,
      minMetres: minM,
      metreStep: step,
      billedMetres,
      printCostPerMetre,
      laminateCostPerMetre: lamCostPerMetre,
      usedWidthM,
      derivedInkPerMetre,
      inkPerMetreEffective,
      labourPerMetreEffective,
    },
    breakdown: {
      stockTotal,
      laminateTotal,
      inkTotal,
      labourMetreTotal,
      labourTrimTotal,
      labourTotal,
      costTotal,
      sellFactor,
      sellTotalBeforeDiscount,
      discountPct: disc.discountPct,
      discountAmount: disc.discountAmount,
      sellTotal,
    },
    unit: {
      cost: costTotal / q,
      sellBeforeDiscount: sellTotalBeforeDiscount / q,
      sell: sellTotal / q,
    },
    labour: {
      totalMinutes,
      blocks,
      blockMinutes,
      blockCost,
    },
  };
}

// ===== Manual item =====
export function calcManualItem({ qty, unitPrice, discountPct, rateCard }) {
  const q = Math.max(1, Math.floor(n(qty, 1)));
  const baseUnit = n(unitPrice, 0);

  const markupPct = n(rateCard?.markupPct, 0);
  const profitMarginPct = n(rateCard?.profitMarginPct, 0);

  const costTotal = baseUnit * q;

  const sellFactor = computeSellFactor(markupPct, profitMarginPct);
  const sellTotalBeforeDiscount = costTotal * sellFactor;

  const disc = applyDiscount(sellTotalBeforeDiscount, discountPct);
  const sellTotal = disc.after;

  return {
    qty: q,
    rates: { markupPct, profitMarginPct },
    breakdown: {
      costTotal,
      sellFactor,
      sellTotalBeforeDiscount,
      discountPct: disc.discountPct,
      discountAmount: disc.discountAmount,
      sellTotal,
    },
    unit: {
      cost: baseUnit,
      sellBeforeDiscount: sellTotalBeforeDiscount / q,
      sell: sellTotal / q,
    },
  };
}

// ===== Discount helpers =====
export function getQtyDiscountPct(qty, qtyDiscounts = []) {
  const q = Math.max(0, Math.floor(n(qty, 0)));
  if (!Array.isArray(qtyDiscounts)) return 0;

  let best = 0;
  for (const row of qtyDiscounts) {
    const minQty = Math.max(0, Math.floor(n(row?.minQty, 0)));
    const pct = clampPct(row?.pct);
    if (minQty > 0 && q >= minQty) best = Math.max(best, pct);
  }
  return best;
}

export function combineDiscountsPct(...pcts) {
  let mult = 1;
  for (const p of pcts) {
    const d = clampPct(p) / 100;
    mult *= 1 - d;
  }
  const combined = (1 - mult) * 100;
  return Math.round(combined * 100) / 100;
}
