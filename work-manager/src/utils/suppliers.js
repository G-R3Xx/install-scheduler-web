function parseNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getDefaultSupplierForm() {
  return {
    name: "",
    code: "",
    contactName: "",
    email: "",
    phone: "",
    website: "",
    address: "",
    defaultLeadTimeDays: "",
    status: "active",
    notes: "",
  };
}

export function normalizeSupplierRecord(id, data = {}) {
  return {
    id,
    name: data.name || "",
    nameLower: data.nameLower || String(data.name || "").trim().toLowerCase(),
    code: data.code || "",
    codeUpper: data.codeUpper || String(data.code || "").trim().toUpperCase(),
    contactName: data.contactName || "",
    email: data.email || "",
    phone: data.phone || "",
    website: data.website || "",
    address: data.address || "",
    defaultLeadTimeDays:
      data.defaultLeadTimeDays !== null &&
      data.defaultLeadTimeDays !== undefined &&
      data.defaultLeadTimeDays !== ""
        ? data.defaultLeadTimeDays
        : "",
    status: data.status || "active",
    notes: data.notes || "",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

export function getInitialSupplierForm(supplier = null) {
  if (!supplier) return getDefaultSupplierForm();

  return {
    name: supplier.name || "",
    code: supplier.code || "",
    contactName: supplier.contactName || "",
    email: supplier.email || "",
    phone: supplier.phone || "",
    website: supplier.website || "",
    address: supplier.address || "",
    defaultLeadTimeDays:
      supplier.defaultLeadTimeDays !== "" &&
      supplier.defaultLeadTimeDays !== null &&
      supplier.defaultLeadTimeDays !== undefined
        ? String(supplier.defaultLeadTimeDays)
        : "",
    status: supplier.status || "active",
    notes: supplier.notes || "",
  };
}

export function buildSupplierPayload(form = {}) {
  const name = String(form.name || "").trim();
  const code = String(form.code || "").trim();

  return {
    name,
    nameLower: name.toLowerCase(),
    code,
    codeUpper: code.toUpperCase(),
    contactName: String(form.contactName || "").trim(),
    email: String(form.email || "").trim(),
    phone: String(form.phone || "").trim(),
    website: String(form.website || "").trim(),
    address: String(form.address || "").trim(),
    defaultLeadTimeDays:
      form.defaultLeadTimeDays === ""
        ? null
        : parseNumber(form.defaultLeadTimeDays, 0),
    status: String(form.status || "active").trim(),
    notes: String(form.notes || "").trim(),
  };
}

export function sortSuppliers(items = []) {
  return [...items].sort((a, b) => {
    const aName = String(a.name || "").toLowerCase();
    const bName = String(b.name || "").toLowerCase();
    return aName.localeCompare(bName);
  });
}

export function getSupplierDisplayName(supplier) {
  if (!supplier) return "";
  if (supplier.code) return `${supplier.name} (${supplier.code})`;
  return supplier.name || "Unnamed supplier";
}
