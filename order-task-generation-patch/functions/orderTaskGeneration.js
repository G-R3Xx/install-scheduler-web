const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

try {
  admin.app();
} catch {
  admin.initializeApp();
}

const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const region = "australia-southeast1";

function num(x, fallback = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function formatUsage(li, kind = "base") {
  const calc = li?.calc || {};
  if (calc?.roll?.billedMetres) return `${num(calc.roll.billedMetres, 0).toFixed(2)} m`;
  if (calc?.sheets?.billedSheets) return `${num(calc.sheets.billedSheets, 0).toFixed(2)} sheets`;
  if (kind === "laminate" && li?.inputs?.laminateMaterialName) return `${Math.max(1, num(li?.qty, 1))} unit(s)`;
  return `${Math.max(1, num(li?.qty, 1))} unit(s)`;
}

function buildMaterialsSummary(order) {
  const base = new Map();
  const laminate = new Map();
  const lines = Array.isArray(order?.lineItems) ? order.lineItems : [];

  for (const li of lines) {
    const materialName = (li?.inputs?.materialName || "").toString().trim();
    const laminateName = (li?.inputs?.laminateMaterialName || "").toString().trim();

    if (materialName) {
      base.set(materialName, {
        name: materialName,
        usageLabel: formatUsage(li, "base"),
      });
    }

    if (laminateName) {
      laminate.set(laminateName, {
        name: laminateName,
        usageLabel: formatUsage(li, "laminate"),
      });
    }
  }

  return {
    base: Array.from(base.values()),
    laminate: Array.from(laminate.values()),
  };
}

function buildOrderTaskSeed(order, orderId) {
  const lines = Array.isArray(order?.lineItems) ? order.lineItems : [];
  const tasks = [];
  if (!lines.length) return tasks;

  tasks.push({
    title: "Check supplied artwork / files",
    description: "Review files, dimensions, finishes, and make sure production assets are ready.",
    group: "Pre-Production",
    type: "artwork_check",
    orderIndex: 10,
    status: "todo",
    productName: "",
    materialName: "",
    laminateMaterialName: "",
    qty: 0,
    sourceLineId: "",
    orderId,
  });

  tasks.push({
    title: "Client proof approval",
    description: "Send proof to client if required and confirm approval before production.",
    group: "Pre-Production",
    type: "proof",
    orderIndex: 20,
    status: "todo",
    productName: "",
    materialName: "",
    laminateMaterialName: "",
    qty: 0,
    sourceLineId: "",
    orderId,
  });

  lines.forEach((li, index) => {
    const productName = (li?.productName || `Item ${index + 1}`).toString();
    const materialName = (li?.inputs?.materialName || "").toString();
    const laminateMaterialName = (li?.inputs?.laminateMaterialName || "").toString();
    const qty = Math.max(1, num(li?.qty, 1));
    const calculatorType = (li?.calculatorType || "").toString();
    const baseIndex = 100 + index * 100;

    if (calculatorType === "manual_item") {
      tasks.push({
        title: `Complete ${productName}`,
        description: "Manual / labour-based item to be completed and checked off.",
        group: "Production",
        type: "manual_item",
        orderIndex: baseIndex,
        status: "todo",
        productName,
        materialName,
        laminateMaterialName,
        qty,
        sourceLineId: li?.id || "",
        orderId,
      });
      return;
    }

    tasks.push({
      title: `Print ${productName}`,
      description: materialName ? `Base material: ${materialName}` : "Print / produce this line item.",
      group: "Production",
      type: "print",
      orderIndex: baseIndex,
      status: "todo",
      productName,
      materialName,
      laminateMaterialName,
      qty,
      sourceLineId: li?.id || "",
      orderId,
    });

    if (laminateMaterialName) {
      tasks.push({
        title: `Laminate ${productName}`,
        description: `Laminate required: ${laminateMaterialName}`,
        group: "Production",
        type: "laminate",
        orderIndex: baseIndex + 10,
        status: "todo",
        productName,
        materialName,
        laminateMaterialName,
        qty,
        sourceLineId: li?.id || "",
        orderId,
      });
    }

    tasks.push({
      title: `Trim / cut ${productName}`,
      description: "Final trim, cut, finish, and quality check.",
      group: "Production",
      type: "trim_cut",
      orderIndex: baseIndex + 20,
      status: "todo",
      productName,
      materialName,
      laminateMaterialName,
      qty,
      sourceLineId: li?.id || "",
      orderId,
    });
  });

  tasks.push({
    title: "Pack / production check",
    description: "Final production check, pack items, and confirm ready state.",
    group: "Finalise",
    type: "pack",
    orderIndex: 900,
    status: "todo",
    productName: "",
    materialName: "",
    laminateMaterialName: "",
    qty: 0,
    sourceLineId: "",
    orderId,
  });

  tasks.push({
    title: "Ready for install handoff",
    description: "Mark order ready to hand off to install workflow if required.",
    group: "Finalise",
    type: "install_handoff",
    orderIndex: 950,
    status: "todo",
    productName: "",
    materialName: "",
    laminateMaterialName: "",
    qty: 0,
    sourceLineId: "",
    orderId,
  });

  return tasks;
}

exports.generateOrderTasksOnCreate = onDocumentCreated(
  { region, document: "orders/{orderId}" },
  async (event) => {
    const snap = event.data;
    if (!snap || !snap.exists) return;

    const orderId = event.params.orderId;
    const order = { id: snap.id, ...snap.data() };

    const tasksRef = db.collection("orders").doc(orderId).collection("tasks");
    const existingTasks = await tasksRef.limit(1).get();
    if (!existingTasks.empty) return;

    const seed = buildOrderTaskSeed(order, orderId);
    const materialsSummary = buildMaterialsSummary(order);

    const batch = db.batch();

    seed.forEach((task) => {
      const ref = tasksRef.doc();
      batch.set(ref, {
        ...task,
        createdAt: FV.serverTimestamp(),
        updatedAt: FV.serverTimestamp(),
      });
    });

    batch.set(
      db.collection("orders").doc(orderId),
      {
        materialsSummary,
        taskCount: seed.length,
        tasksGeneratedAt: FV.serverTimestamp(),
        workflowState: "production_tasks_ready",
        updatedAt: FV.serverTimestamp(),
      },
      { merge: true }
    );

    const notificationRef = db.collection("notifications").doc();
    batch.set(notificationRef, {
      type: "order_tasks",
      title: `Production tasks ready — ${order.orderNumber || "Order"}`,
      body: `${seed.length} task(s) generated from approved quote.`,
      route: `/orders/${orderId}`,
      relatedId: orderId,
      isRead: false,
      createdAt: FV.serverTimestamp(),
    });

    await batch.commit();
  }
);
