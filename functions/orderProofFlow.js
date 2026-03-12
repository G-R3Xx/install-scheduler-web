const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

try {
  admin.app();
} catch {
  admin.initializeApp();
}

const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const region = "australia-southeast1";

const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
const MGMT_EMAIL = defineSecret("MGMT_EMAIL");
const PROOF_PORTAL_URL = defineSecret("PROOF_PORTAL_URL");

const INLINE_LOGO_CID = "tenderedge-logo";
const LOCAL_LOGO_PATH = path.join(__dirname, "assets", "tender-edge-logo.png");
const REVISION_TASK_TITLE = "Revise artwork from client feedback";
const AWAIT_APPROVAL_TASK_TITLE = "Await client proof approval";

function htmlEscape(s) {
  return (s || "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(s) {
  return htmlEscape(s).replace(/\n/g, "<br/>");
}

function normalize(s) {
  return (s || "").toString().trim().toLowerCase();
}

function getInlineLogoHtml() {
  if (fs.existsSync(LOCAL_LOGO_PATH)) {
    return `<img src="cid:${INLINE_LOGO_CID}" alt="Tender Edge" style="max-width:300px;width:100%;height:auto;display:block;" />`;
  }
  return `<div style="font-size:28px;font-weight:800;letter-spacing:0.5px;color:#3b3b3b;">Tender Edge</div>`;
}

function getInlineLogoAttachment() {
  if (!fs.existsSync(LOCAL_LOGO_PATH)) return null;
  return {
    filename: "tender-edge-logo.png",
    path: LOCAL_LOGO_PATH,
    cid: INLINE_LOGO_CID,
  };
}

function getProofPortalUrl() {
  const preferred = PROOF_PORTAL_URL.value ? PROOF_PORTAL_URL.value() : "";
  if (preferred) return preferred.replace(/\/+$/, "");
  return "https://australia-southeast1-install-scheduler.cloudfunctions.net/orderProofApprovalPortal";
}

function buildProofPortalUrl(orderId, proofId, token, action = "") {
  const params = new URLSearchParams({ orderId, proofId, token });
  if (action) params.set("action", action);
  return `${getProofPortalUrl()}?${params.toString()}`;
}

function formatTs(value) {
  try {
    const d = value?.toDate ? value.toDate() : null;
    if (!d) return "—";
    return d.toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  } catch {
    return "—";
  }
}

function buildProofFileHtml(file) {
  const name = htmlEscape(file?.name || "Proof file");
  const url = htmlEscape(file?.url || "");
  const type = normalize(file?.contentType || "");

  if (!url) {
    return `<li style="margin-bottom:8px;">${name}</li>`;
  }

  if (type.startsWith("image/")) {
    return `
      <div style="display:inline-block;margin:8px;text-align:center;vertical-align:top;">
        <a href="${url}" target="_blank" rel="noopener">
          <img src="${url}" alt="${name}" style="width:140px;max-width:100%;height:auto;border:1px solid #ddd;border-radius:8px;display:block;" />
        </a>
        <div style="margin-top:6px;font-size:12px;line-height:1.35;">${name}</div>
      </div>
    `;
  }

  return `
    <div style="margin:8px 0;">
      <a href="${url}" target="_blank" rel="noopener" style="color:#345d91;text-decoration:none;font-weight:700;">
        Open ${name}
      </a>
    </div>
  `;
}

function buildProofFileText(file) {
  const name = file?.name || "Proof file";
  const url = file?.url || "";
  return url ? `- ${name}: ${url}` : `- ${name}`;
}

function buildProofEmailHtml({ order, proofFiles, portalUrl, message }) {
  const logoHtml = getInlineLogoHtml();
  const company = order?.clientSnapshot?.companyName || "";
  const contact = order?.clientSnapshot?.contactName || "";
  const orderNumber = order?.orderNumber || "Order";
  const quoteNumber = order?.quoteNumber || "";
  const notes = (order?.notes || "").trim();

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Artwork Proof Approval</title>
    </head>
    <body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#16202a;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:24px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;background:#ffffff;border-radius:16px;overflow:hidden;">
              <tr>
                <td style="padding:24px 28px 10px;background:#ffffff;" align="center">
                  ${logoHtml}
                </td>
              </tr>

              <tr>
                <td style="padding:18px 28px 16px;background:linear-gradient(135deg,#1f3a5f,#345d91);color:#fff;">
                  <div style="font-size:12px;letter-spacing:1px;opacity:.85;text-transform:uppercase;">Artwork proof ready for review</div>
                  <div style="font-size:30px;font-weight:700;line-height:1.15;margin-top:6px;">
                    ${htmlEscape(orderNumber)}
                  </div>
                  <div style="font-size:14px;opacity:.92;margin-top:10px;">
                    Please review the proof files and either approve them or request changes.
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding:24px 28px 8px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="padding:8px 0;width:160px;color:#667085;"><strong>Company</strong></td>
                      <td style="padding:8px 0;">${htmlEscape(company || "—")}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;width:160px;color:#667085;"><strong>Contact</strong></td>
                      <td style="padding:8px 0;">${htmlEscape(contact || "—")}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;width:160px;color:#667085;"><strong>Order</strong></td>
                      <td style="padding:8px 0;">${htmlEscape(orderNumber)}</td>
                    </tr>
                    ${
                      quoteNumber
                        ? `<tr>
                             <td style="padding:8px 0;width:160px;color:#667085;"><strong>Quote</strong></td>
                             <td style="padding:8px 0;">${htmlEscape(quoteNumber)}</td>
                           </tr>`
                        : ""
                    }
                  </table>
                </td>
              </tr>

              ${
                message
                  ? `<tr>
                       <td style="padding:8px 28px 8px;">
                         <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;">
                           <div style="font-weight:700;margin-bottom:6px;">Message</div>
                           <div style="font-size:14px;line-height:1.5;">${nl2br(message)}</div>
                         </div>
                       </td>
                     </tr>`
                  : ""
              }

              ${
                notes
                  ? `<tr>
                       <td style="padding:8px 28px 8px;">
                         <div style="background:#fffaf0;border:1px solid #f6e0a7;border-radius:12px;padding:14px;">
                           <div style="font-weight:700;margin-bottom:6px;">Order Notes</div>
                           <div style="font-size:14px;line-height:1.5;">${nl2br(notes)}</div>
                         </div>
                       </td>
                     </tr>`
                  : ""
              }

              <tr>
                <td style="padding:16px 28px 8px;">
                  <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Proof Files</div>
                  <div>
                    ${proofFiles.map(buildProofFileHtml).join("")}
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding:20px 28px 10px;">
                  <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Choose an Action</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="padding:6px 0;">
                        <a href="${portalUrl}&action=approve" style="display:block;text-align:center;background:#1e8e3e;color:#fff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:700;">Approve Artwork</a>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;">
                        <a href="${portalUrl}&action=changes_requested" style="display:block;text-align:center;background:#f59e0b;color:#fff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:700;">Request Changes</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:18px 28px 28px;color:#667085;font-size:13px;">
                  If the buttons above don't work, copy and paste this link into your browser:<br/>
                  <span style="word-break:break-all;color:#345d91;">${htmlEscape(portalUrl)}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
}

function buildProofEmailText({ order, proofFiles, portalUrl, message }) {
  return [
    `Artwork proof ready for review — ${order?.orderNumber || "Order"}`,
    "",
    `Company: ${order?.clientSnapshot?.companyName || "—"}`,
    `Contact: ${order?.clientSnapshot?.contactName || "—"}`,
    order?.quoteNumber ? `Quote: ${order.quoteNumber}` : "",
    message ? `Message:\n${message}\n` : "",
    "Proof files:",
    ...proofFiles.map(buildProofFileText),
    "",
    "Choose an action online:",
    `Approve: ${portalUrl}&action=approve`,
    `Request changes: ${portalUrl}&action=changes_requested`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPortalFileHtml(file) {
  const name = htmlEscape(file?.name || "Proof file");
  const url = htmlEscape(file?.url || "");
  const type = normalize(file?.contentType || "");

  if (!url) return "";

  if (type.startsWith("image/")) {
    return `
      <div style="display:inline-block;margin:8px;text-align:center;vertical-align:top;">
        <a href="${url}" target="_blank" rel="noopener">
          <img src="${url}" alt="${name}" style="width:160px;max-width:100%;height:auto;border:1px solid #ddd;border-radius:8px;display:block;" />
        </a>
        <div style="margin-top:6px;font-size:12px;line-height:1.35;">${name}</div>
      </div>
    `;
  }

  return `
    <div style="margin:8px 0;">
      <a href="${url}" target="_blank" rel="noopener" style="color:#345d91;text-decoration:none;font-weight:700;">
        Open ${name}
      </a>
    </div>
  `;
}

function buildPortalPageHtml({ order, proof, proofFiles, token, action = "", submitted = false, resultText = "" }) {
  const selected = normalize(action || "approve") || "approve";
  const orderNumber = order?.orderNumber || "Order";

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Artwork Proof Approval</title>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f5f7fb; color: #16202a; }
        .wrap { max-width: 920px; margin: 0 auto; padding: 24px 14px 40px; }
        .card { background: #fff; border-radius: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.05); overflow: hidden; }
        .hero { background: linear-gradient(135deg,#1f3a5f,#345d91); color: #fff; padding: 26px; }
        .section { padding: 22px 26px; border-top: 1px solid #eef2f6; }
        .muted { color: #667085; }
        .row { display: flex; flex-wrap: wrap; gap: 12px 24px; }
        .field { min-width: 180px; flex: 1; }
        .choice { display:block; border: 1px solid #dbe3ee; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; background: #fff; cursor: pointer; }
        .choice.active { border-color: #345d91; background: #f8fbff; }
        .choice-row { display:flex; align-items:flex-start; gap:12px; }
        .choice input[type="radio"] { margin: 3px 0 0; flex: 0 0 auto; }
        .choice-copy { display:block; flex:1; min-width:0; }
        .choice-title { display:block; font-weight:700; color:#16202a; margin-bottom:4px; line-height:1.25; }
        .choice-desc { display:block; color:#667085; line-height:1.4; font-size:14px; }
        textarea { width:100%; min-height:120px; border-radius:12px; border:1px solid #d0d7e2; padding:12px; font:inherit; resize:vertical; }
        button { width:100%; border:none; border-radius:12px; padding:14px 18px; font-size:16px; font-weight:700; color:white; cursor:pointer; }
        button.approve { background:#1e8e3e; }
        button.change { background:#f59e0b; }
        .success { background:#ecfdf3; color:#065f46; padding:14px 16px; border-radius:12px; border:1px solid #a7f3d0; }
        .files { margin-top:10px; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          <div class="hero">
            <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.85;">Artwork proof response</div>
            <div style="font-size:30px;font-weight:700;margin-top:6px;">${htmlEscape(orderNumber)}</div>
            <div style="margin-top:10px;opacity:.92;">Please review the proof files below and submit your response.</div>
          </div>

          <div class="section">
            <div class="row">
              <div class="field"><div class="muted">Company</div><div><strong>${htmlEscape(order?.clientSnapshot?.companyName || "—")}</strong></div></div>
              <div class="field"><div class="muted">Contact</div><div><strong>${htmlEscape(order?.clientSnapshot?.contactName || "—")}</strong></div></div>
              <div class="field"><div class="muted">Proof sent</div><div><strong>${formatTs(proof?.sentAt)}</strong></div></div>
            </div>
          </div>

          <div class="section">
            <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Proof Files</div>
            <div class="files">
              ${proofFiles.map(buildPortalFileHtml).join("")}
            </div>
          </div>

          <div class="section">
            ${
              submitted
                ? `<div class="success"><strong>Response recorded.</strong><br/>${htmlEscape(resultText)}</div>`
                : `
                  <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Your Response</div>
                  <form method="POST">
                    <input type="hidden" name="orderId" value="${htmlEscape(order?.id || "")}" />
                    <input type="hidden" name="proofId" value="${htmlEscape(proof?.id || "")}" />
                    <input type="hidden" name="token" value="${htmlEscape(token || "")}" />

                    <label class="choice ${selected === "approve" ? "active" : ""}">
                      <span class="choice-row">
                        <input type="radio" name="action" value="approve" ${selected === "approve" ? "checked" : ""} />
                        <span class="choice-copy">
                          <span class="choice-title">Approve Artwork</span>
                          <span class="choice-desc">Confirm the artwork proof is approved and ready to proceed.</span>
                        </span>
                      </span>
                    </label>

                    <label class="choice ${selected === "changes_requested" ? "active" : ""}">
                      <span class="choice-row">
                        <input type="radio" name="action" value="changes_requested" ${selected === "changes_requested" ? "checked" : ""} />
                        <span class="choice-copy">
                          <span class="choice-title">Request Changes</span>
                          <span class="choice-desc">Tell us what needs to change before approval.</span>
                        </span>
                      </span>
                    </label>

                    <div style="margin-top:14px;margin-bottom:8px;font-weight:700;">Comments</div>
                    <textarea name="message" placeholder="Add any comments here..."></textarea>

                    <div style="margin-top:14px;">
                      <button type="submit" class="${selected === "changes_requested" ? "change" : "approve"}">
                        Submit Response
                      </button>
                    </div>
                  </form>
                `
            }
          </div>
        </div>
      </div>
    </body>
  </html>`;
}

async function addNotification({ title, body = "", route = "", relatedId = "", type = "proof_response" }) {
  await db.collection("notifications").add({
    type,
    title,
    body,
    route,
    relatedId,
    isRead: false,
    createdAt: FV.serverTimestamp(),
  });
}

async function ensureRevisionTask({ orderId, proof, clientMessage }) {
  const tasksRef = db.collection("orders").doc(orderId).collection("tasks");
  const existingSnap = await tasksRef.get();

  const openExisting = existingSnap.docs.find((d) => {
    const data = d.data() || {};
    const done = data.isDone === true || normalize(data.status) === "done";
    return normalize(data.title) === normalize(REVISION_TASK_TITLE) && !done;
  });

  if (openExisting) return;

  const noteParts = [
    "Client requested changes to the artwork proof.",
    `Recipient: ${proof?.recipientEmail || "—"}`,
    `Responded: ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}`,
  ];

  if (clientMessage) {
    noteParts.push("", "Client comments:", clientMessage);
  }

  await tasksRef.add({
    title: REVISION_TASK_TITLE,
    note: noteParts.join("\n"),
    description: noteParts.join("\n"),
    isDone: false,
    status: "todo",
    createdByName: "System",
    createdByUid: "system",
    createdAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp(),
    doneAt: null,
    doneByUid: "",
    doneByName: "",
    completedAt: null,
    completedBy: "",
    completedByName: "",
  });
}

async function completeRevisionTask({ orderId }) {
  const tasksRef = db.collection("orders").doc(orderId).collection("tasks");
  const tasksSnap = await tasksRef.get();

  const matches = tasksSnap.docs.filter((d) => {
    const data = d.data() || {};
    const done = data.isDone === true || normalize(data.status) === "done";
    return normalize(data.title) === normalize(REVISION_TASK_TITLE) && !done;
  });

  if (!matches.length) return;

  const batch = db.batch();

  matches.forEach((taskDoc) => {
    batch.set(
      taskDoc.ref,
      {
        isDone: true,
        status: "done",
        completedAt: FV.serverTimestamp(),
        completedBy: "system",
        completedByName: "System",
        doneAt: FV.serverTimestamp(),
        doneByUid: "system",
        doneByName: "System",
        updatedAt: FV.serverTimestamp(),
      },
      { merge: true }
    );
  });

  await batch.commit();
}

async function ensureAwaitApprovalTask({ orderId, proofRefId, recipientEmail }) {
  const tasksRef = db.collection("orders").doc(orderId).collection("tasks");
  const tasksSnap = await tasksRef.get();

  const openExisting = tasksSnap.docs.find((d) => {
    const data = d.data() || {};
    const done = data.isDone === true || normalize(data.status) === "done";
    return normalize(data.title) === normalize(AWAIT_APPROVAL_TASK_TITLE) && !done;
  });

  if (openExisting) {
    await openExisting.ref.set(
      {
        note: [
          "Awaiting client approval for the latest artwork proof.",
          `Recipient: ${recipientEmail || "—"}`,
          `Proof request: ${proofRefId || "—"}`,
        ].join("\n"),
        description: [
          "Awaiting client approval for the latest artwork proof.",
          `Recipient: ${recipientEmail || "—"}`,
          `Proof request: ${proofRefId || "—"}`,
        ].join("\n"),
        updatedAt: FV.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }

  await tasksRef.add({
    title: AWAIT_APPROVAL_TASK_TITLE,
    note: [
      "Awaiting client approval for the latest artwork proof.",
      `Recipient: ${recipientEmail || "—"}`,
      `Proof request: ${proofRefId || "—"}`,
    ].join("\n"),
    description: [
      "Awaiting client approval for the latest artwork proof.",
      `Recipient: ${recipientEmail || "—"}`,
      `Proof request: ${proofRefId || "—"}`,
    ].join("\n"),
    isDone: false,
    status: "todo",
    createdByName: "System",
    createdByUid: "system",
    createdAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp(),
    doneAt: null,
    doneByUid: "",
    doneByName: "",
    completedAt: null,
    completedBy: "",
    completedByName: "",
  });
}

async function completeAwaitApprovalTask({ orderId }) {
  const tasksRef = db.collection("orders").doc(orderId).collection("tasks");
  const tasksSnap = await tasksRef.get();

  const matches = tasksSnap.docs.filter((d) => {
    const data = d.data() || {};
    const done = data.isDone === true || normalize(data.status) === "done";
    return normalize(data.title) === normalize(AWAIT_APPROVAL_TASK_TITLE) && !done;
  });

  if (!matches.length) return;

  const batch = db.batch();

  matches.forEach((taskDoc) => {
    batch.set(
      taskDoc.ref,
      {
        isDone: true,
        status: "done",
        completedAt: FV.serverTimestamp(),
        completedBy: "system",
        completedByName: "System",
        doneAt: FV.serverTimestamp(),
        doneByUid: "system",
        doneByName: "System",
        updatedAt: FV.serverTimestamp(),
      },
      { merge: true }
    );
  });

  await batch.commit();
}

exports.sendOrderProofEmail = onRequest(
  { region, secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, MGMT_EMAIL, PROOF_PORTAL_URL] },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    try {
      const body = req.body || {};
      const orderId = (body.orderId || "").toString().trim();
      const emailOverride = (body.emailOverride || "").toString().trim();
      const message = (body.message || "").toString().trim();
      const senderName = (body.senderName || "Tender Edge").toString().trim();

      if (!orderId) {
        res.status(400).send("Missing orderId");
        return;
      }

      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) {
        res.status(404).send("Order not found");
        return;
      }

      const order = { id: orderSnap.id, ...orderSnap.data() };
      const targetEmail = emailOverride || order?.clientSnapshot?.email || "";

      if (!targetEmail || !targetEmail.includes("@")) {
        res.status(400).send("No valid client email found");
        return;
      }

      const requestedProofFileIds = Array.isArray(body.proofFileIds)
        ? body.proofFileIds.map((x) => (x || "").toString().trim()).filter(Boolean)
        : [];

      const filesSnap = await db
        .collection("orders")
        .doc(orderId)
        .collection("files")
        .where("category", "==", "proof")
        .get();

      let proofFiles = filesSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((f) => !!f.url);

      if (requestedProofFileIds.length) {
        const allowed = new Set(requestedProofFileIds);
        proofFiles = proofFiles.filter((f) => allowed.has(f.id));
      }

      if (!proofFiles.length) {
        res.status(400).send('No proof files found. Upload file(s) with category "proof" first.');
        return;
      }

      const token = crypto.randomBytes(24).toString("hex");
      const proofRef = db.collection("orders").doc(orderId).collection("proofs").doc();
      const proofUrl = buildProofPortalUrl(orderId, proofRef.id, token);

      await proofRef.set({
        status: "sent",
        token,
        recipientEmail: targetEmail,
        message,
        senderName,
        approvalUrl: proofUrl,
        files: proofFiles.map((f) => ({
          id: f.id || "",
          name: f.name || "",
          url: f.url || "",
          contentType: f.contentType || "",
        })),
        sentAt: FV.serverTimestamp(),
        respondedAt: null,
        clientResponseMessage: "",
      });

      await orderRef.set(
        {
          proofRequired: true,
          artworkApprovalStatus: "sent",
          artworkApprovalRequestedAt: FV.serverTimestamp(),
          artworkApprovalRecipientEmail: targetEmail,
          lastProofRequestId: proofRef.id,
          updatedAt: FV.serverTimestamp(),
        },
        { merge: true }
      );

      await completeRevisionTask({ orderId });
      await ensureAwaitApprovalTask({
        orderId,
        proofRefId: proofRef.id,
        recipientEmail: targetEmail,
      });

      await addNotification({
        type: "proof_sent",
        title: `Proof sent — ${order.orderNumber || "Order"}`,
        body: `Sent to ${targetEmail}`,
        route: `/orders/${orderId}`,
        relatedId: orderId,
      });

      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
      });

      const html = buildProofEmailHtml({ order, proofFiles, portalUrl: proofUrl, message });
      const text = buildProofEmailText({ order, proofFiles, portalUrl: proofUrl, message });

      const mgmtBcc = (MGMT_EMAIL.value() || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const attachments = [];
      const inlineLogo = getInlineLogoAttachment();
      if (inlineLogo) attachments.push(inlineLogo);

      await transporter.sendMail({
        from: `"${senderName || "Tender Edge"}" <${GMAIL_USER.value()}>`,
        to: targetEmail,
        bcc: mgmtBcc.length ? mgmtBcc : undefined,
        subject: `Artwork proof ready — ${order.orderNumber || "Order"}`,
        html,
        text,
        attachments,
      });

      res.status(200).json({
        ok: true,
        sentTo: targetEmail,
        portalUrl: proofUrl,
        proofId: proofRef.id,
      });
    } catch (err) {
      console.error("sendOrderProofEmail failed", err);
      res.status(500).send(err?.message || "Failed to send proof email");
    }
  }
);

exports.orderProofApprovalPortal = onRequest(
  { region },
  async (req, res) => {
    try {
      const source = req.method === "POST" ? req.body || {} : req.query || {};
      const orderId = (source.orderId || "").toString().trim();
      const proofId = (source.proofId || "").toString().trim();
      const token = (source.token || "").toString().trim();
      const action = (source.action || "approve").toString().trim().toLowerCase();
      const message = (source.message || "").toString().trim();

      if (!orderId || !proofId || !token) {
        res.status(400).send("Missing orderId, proofId, or token");
        return;
      }

      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) {
        res.status(404).send("Order not found");
        return;
      }

      const proofRef = db.collection("orders").doc(orderId).collection("proofs").doc(proofId);
      const proofSnap = await proofRef.get();
      if (!proofSnap.exists) {
        res.status(404).send("Proof request not found");
        return;
      }

      const order = { id: orderSnap.id, ...orderSnap.data() };
      const proof = { id: proofSnap.id, ...proofSnap.data() };

      if (!proof.token || proof.token !== token) {
        res.status(403).send("Invalid or expired token");
        return;
      }

      const proofFiles = Array.isArray(proof.files) ? proof.files : [];

      if (req.method === "POST") {
        const responseStatus = action === "approve" ? "approved" : "changes_requested";

        await proofRef.set(
          {
            status: responseStatus,
            respondedAt: FV.serverTimestamp(),
            clientResponseMessage: message,
          },
          { merge: true }
        );

        await orderRef.set(
          {
            artworkApprovalStatus: responseStatus,
            artworkApprovalRespondedAt: FV.serverTimestamp(),
            artworkApprovalResponseMessage: message,
            updatedAt: FV.serverTimestamp(),
          },
          { merge: true }
        );

        if (responseStatus === "changes_requested") {
          await ensureRevisionTask({
            orderId,
            proof,
            clientMessage: message,
          });
        }

        if (responseStatus === "approved") {
          await completeAwaitApprovalTask({ orderId });
        }

        await addNotification({
          type: "proof_response",
          title:
            responseStatus === "approved"
              ? `Artwork approved — ${order.orderNumber || "Order"}`
              : `Artwork changes requested — ${order.orderNumber || "Order"}`,
          body: message || "",
          route: `/orders/${order.id}`,
          relatedId: order.id,
        });

        const resultText =
          responseStatus === "approved"
            ? "Thanks, the artwork proof has been approved. Our team has been notified."
            : "Thanks, your requested changes have been recorded. Our team has been notified.";

        res.status(200).send(
          buildPortalPageHtml({
            order,
            proof: { ...proof, status: responseStatus },
            proofFiles,
            token,
            action,
            submitted: true,
            resultText,
          })
        );
        return;
      }

      res.status(200).send(
        buildPortalPageHtml({
          order,
          proof,
          proofFiles,
          token,
          action,
        })
      );
    } catch (err) {
      console.error("orderProofApprovalPortal failed", err);
      res.status(500).send(err?.message || "Failed to load proof approval page");
    }
  }
);