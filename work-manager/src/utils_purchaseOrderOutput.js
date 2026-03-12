export function formatPurchaseOrderDate(value) {
  if (!value) return "—";

  const date = typeof value?.toDate === "function" ? value.toDate() : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString();
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getPurchaseOrderSupplierSummary({ purchaseOrder, supplier, supplierName }) {
  return {
    id: supplier?.id || purchaseOrder?.supplierId || "",
    name:
      supplier?.name ||
      String(supplierName || purchaseOrder?.supplierName || "").trim(),
    contactName: supplier?.contactName || "",
    email: supplier?.email || purchaseOrder?.supplierEmail || "",
    phone: supplier?.phone || purchaseOrder?.supplierPhone || "",
    address: supplier?.address || purchaseOrder?.supplierAddress || "",
  };
}

export function buildPurchaseOrderPrintLines(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => ({
      materialName: String(line?.materialName || "").trim(),
      supplierSku: String(line?.supplierSku || "").trim(),
      qty: num(line?.qty, 0),
      unit: String(line?.unit || "").trim(),
      unitCost: num(line?.unitCost, 0),
      lineTotal:
        num(line?.lineTotal, NaN) || num(line?.qty, 0) * num(line?.unitCost, 0),
      notes: String(line?.notes || "").trim(),
    }))
    .filter((line) => line.materialName);
}

export function buildPurchaseOrderEmailSubject({ purchaseOrder, poNumber, supplierName }) {
  const poLabel = String(poNumber || purchaseOrder?.poNumber || purchaseOrder?.id || "").trim();
  const supplierLabel = String(supplierName || purchaseOrder?.supplierName || "").trim();

  if (poLabel && supplierLabel) return `Purchase Order ${poLabel} - ${supplierLabel}`;
  if (poLabel) return `Purchase Order ${poLabel}`;
  if (supplierLabel) return `Purchase Order - ${supplierLabel}`;
  return "Purchase Order";
}

export function buildPurchaseOrderEmailBody({
  purchaseOrder,
  supplier,
  supplierName,
  poNumber,
  notes,
  lines,
  total,
}) {
  const summary = getPurchaseOrderSupplierSummary({ purchaseOrder, supplier, supplierName });
  const poLabel = String(poNumber || purchaseOrder?.poNumber || purchaseOrder?.id || "").trim();
  const printLines = buildPurchaseOrderPrintLines(lines);

  const intro = [
    summary.contactName ? `Hi ${summary.contactName},` : "Hello,",
    "",
    `Please see purchase order ${poLabel || "attached below"}.`,
    "",
  ];

  const detailRows = printLines.length
    ? printLines.map((line, index) => {
        const parts = [
          `${index + 1}. ${line.materialName}`,
          `Qty: ${line.qty}${line.unit ? ` ${line.unit}` : ""}`,
        ];

        if (line.supplierSku) parts.push(`SKU: ${line.supplierSku}`);
        if (line.unitCost > 0) parts.push(`Unit Cost: $${line.unitCost.toFixed(2)}`);
        if (line.lineTotal > 0) parts.push(`Line Total: $${line.lineTotal.toFixed(2)}`);
        if (line.notes) parts.push(`Notes: ${line.notes}`);

        return parts.join(" | ");
      })
    : ["No line items added."];

  const footer = [
    "",
    `Order Total: $${num(total, 0).toFixed(2)}`,
    "",
  ];

  if (notes) {
    footer.push("PO Notes:");
    footer.push(String(notes).trim());
    footer.push("");
  }

  footer.push("Please confirm availability, pricing, and lead time.");
  footer.push("");
  footer.push("Regards,");
  footer.push("Tender Edge");

  return [...intro, ...detailRows, ...footer].join("\n");
}
