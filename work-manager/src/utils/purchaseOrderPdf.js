import {
  buildPurchaseOrderPrintLines,
  getPurchaseOrderSupplierSummary,
} from "./purchaseOrderOutput";

function toAscii(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2022]/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "")
    .trimEnd();
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function currency(value) {
  return `$${num(value, 0).toFixed(2)}`;
}

function escapePdfText(value) {
  return toAscii(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(text, maxChars = 90) {
  const safe = toAscii(text);
  if (!safe) return [""];

  const words = safe.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    const next = `${current} ${word}`;
    if (next.length <= maxChars) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function truncate(value, length) {
  const safe = toAscii(value);
  if (safe.length <= length) return safe;
  if (length <= 3) return safe.slice(0, length);
  return `${safe.slice(0, length - 3)}...`;
}

function padRight(value, length) {
  return truncate(value, length).padEnd(length, " ");
}

function padLeft(value, length) {
  return truncate(value, length).padStart(length, " ");
}

function formatDate(value) {
  if (!value) return "-";
  const date = typeof value?.toDate === "function" ? value.toDate() : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "-";
  return toAscii(date.toLocaleString());
}

function buildDocumentLines({ purchaseOrder, supplier, supplierName, poNumber, notes, lines, total }) {
  const supplierSummary = getPurchaseOrderSupplierSummary({
    purchaseOrder,
    supplier,
    supplierName,
  });
  const poLabel = String(poNumber || purchaseOrder?.poNumber || purchaseOrder?.id || "Draft Purchase Order").trim();
  const printLines = buildPurchaseOrderPrintLines(lines);

  const docLines = [];
  const push = (text = "", type = "body") => docLines.push({ text: toAscii(text), type });

  push("Purchase Order", "title");
  push(`PO Number: ${poLabel}`, "body");
  push(`Status: ${String(purchaseOrder?.status || "draft").replace(/_/g, " ")}`, "body");
  push(`Created: ${formatDate(purchaseOrder?.createdAt)}`, "body");
  push(`Updated: ${formatDate(purchaseOrder?.updatedAt)}`, "body");
  push("", "spacer");

  push("Supplier", "section");
  push(`Name: ${supplierSummary.name || "-"}`, "body");
  if (supplierSummary.contactName) push(`Contact: ${supplierSummary.contactName}`, "body");
  if (supplierSummary.email) push(`Email: ${supplierSummary.email}`, "body");
  if (supplierSummary.phone) push(`Phone: ${supplierSummary.phone}`, "body");
  if (supplierSummary.address) {
    wrapText(`Address: ${supplierSummary.address}`, 88).forEach((line) => push(line, "body"));
  }
  push("", "spacer");

  push("Line Items", "section");
  push(
    `${padRight("Item", 30)} ${padRight("SKU", 12)} ${padLeft("Qty", 7)} ${padRight("Unit", 8)} ${padLeft("Unit Cost", 12)} ${padLeft("Total", 12)}`,
    "table"
  );
  push(`${"-".repeat(30)} ${"-".repeat(12)} ${"-".repeat(7)} ${"-".repeat(8)} ${"-".repeat(12)} ${"-".repeat(12)}`, "table");

  if (!printLines.length) {
    push("No line items added.", "body");
  } else {
    printLines.forEach((line) => {
      push(
        `${padRight(line.materialName || "-", 30)} ${padRight(line.supplierSku || "", 12)} ${padLeft(line.qty, 7)} ${padRight(line.unit || "", 8)} ${padLeft(currency(line.unitCost), 12)} ${padLeft(currency(line.lineTotal), 12)}`,
        "table"
      );

      if (line.notes) {
        wrapText(`Notes: ${line.notes}`, 86).forEach((noteLine) => push(`  ${noteLine}`, "body"));
      }
    });
  }

  push("", "spacer");
  push(`Order Total: ${currency(total)}`, "section");

  if (notes) {
    push("", "spacer");
    push("PO Notes", "section");
    wrapText(notes, 90).forEach((line) => push(line, "body"));
  }

  return docLines;
}

function paginateLines(lines) {
  const pages = [];
  let current = [];
  let used = 0;
  const maxUnits = 62;

  for (const line of lines) {
    const units = line.type === "title" ? 3 : line.type === "section" ? 2 : line.type === "spacer" ? 1 : 1.3;
    if (current.length && used + units > maxUnits) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += units;
  }

  if (current.length) pages.push(current);
  return pages.length ? pages : [[{ text: "Purchase Order", type: "title" }]];
}

function buildPageStream(lines) {
  let y = 800;
  const out = [];

  const drawLine = (text, x, fontRef, size) => {
    out.push(`BT /${fontRef} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`);
  };

  lines.forEach((line) => {
    if (line.type === "spacer") {
      y -= 10;
      return;
    }

    if (line.type === "title") {
      drawLine(line.text, 40, "F2", 18);
      y -= 24;
      return;
    }

    if (line.type === "section") {
      drawLine(line.text, 40, "F2", 12);
      y -= 18;
      return;
    }

    if (line.type === "table") {
      drawLine(line.text, 40, "F3", 9);
      y -= 14;
      return;
    }

    drawLine(line.text, 40, "F1", 10);
    y -= 14;
  });

  return out.join("\n");
}

function buildPdfBlob(pageStreams) {
  const objects = {
    1: `<< /Type /Catalog /Pages 2 0 R >>`,
    2: `<< /Type /Pages /Count ${pageStreams.length} /Kids [${pageStreams
      .map((_, index) => `${6 + index * 2} 0 R`)
      .join(" ")}] >>`,
    3: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    4: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`,
    5: `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`,
  };

  pageStreams.forEach((stream, index) => {
    const pageId = 6 + index * 2;
    const contentId = pageId + 1;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  const ids = Object.keys(objects)
    .map(Number)
    .sort((a, b) => a - b);

  ids.forEach((id) => {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${ids.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;

  ids.forEach((id) => {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  });

  pdf += `trailer\n<< /Size ${ids.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

export function downloadPurchaseOrderPdf({
  purchaseOrder,
  supplier,
  supplierName,
  poNumber,
  notes,
  lines,
  total,
}) {
  const docLines = buildDocumentLines({
    purchaseOrder,
    supplier,
    supplierName,
    poNumber,
    notes,
    lines,
    total,
  });

  const pageStreams = paginateLines(docLines).map((pageLines) => buildPageStream(pageLines));
  const blob = buildPdfBlob(pageStreams);
  const fileLabel = String(poNumber || purchaseOrder?.poNumber || purchaseOrder?.id || "purchase-order")
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "purchase-order";

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileLabel}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
