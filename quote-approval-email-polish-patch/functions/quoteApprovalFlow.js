const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

try {
  admin.app();
} catch {
  admin.initializeApp();
}

const db = admin.firestore();
const region = "australia-southeast1";

const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
const MGMT_EMAIL = defineSecret("MGMT_EMAIL");
const FRONTEND_BASE_URL = defineSecret("FRONTEND_BASE_URL");

function money(n) {
  const v = Number(n || 0);
  return `$${v.toFixed(2)}`;
}

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

function buildQuoteLinesHtml(lineItems = []) {
  if (!Array.isArray(lineItems) || !lineItems.length) {
    return `<tr><td colspan="4" style="padding:10px;border-bottom:1px solid #eee;color:#666;">No line items added yet.</td></tr>`;
  }

  return lineItems
    .map((li) => {
      const qty = Number(li?.qty || 0);
      const item = htmlEscape(li?.productName || "Item");
      const unit = money(li?.calc?.unit?.sell || 0);
      const total = money(li?.calc?.breakdown?.sellTotal || 0);
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #eee;">${item}</td>
          <td style="padding:10px;border-bottom:1px solid #eee;">${qty}</td>
          <td style="padding:10px;border-bottom:1px solid #eee;">${unit}</td>
          <td style="padding:10px;border-bottom:1px solid #eee;">${total}</td>
        </tr>
      `;
    })
    .join("");
}

function buildQuoteLinesText(lineItems = []) {
  if (!Array.isArray(lineItems) || !lineItems.length) {
    return "No line items added yet.";
  }

  return lineItems
    .map((li) => {
      const qty = Number(li?.qty || 0);
      const item = li?.productName || "Item";
      const total = money(li?.calc?.breakdown?.sellTotal || 0);
      return `- ${item} x ${qty} — ${total}`;
    })
    .join("\n");
}

function buildPortalUrl(quoteId, token, action = "") {
  const params = new URLSearchParams({ quoteId, token });
  if (action) params.set("action", action);
  const projectBase = FRONTEND_BASE_URL.value
    ? FRONTEND_BASE_URL.value()
    : "https://installscheduler.web.app";
  const clean = projectBase.replace(/\/+$/, "");
  return `${clean}/quote-approval?${params.toString()}`;
}

function buildApprovalEmailHtml({ quote, portalBaseUrl, message }) {
  const company = quote?.clientSnapshot?.companyName || "";
  const contact = quote?.clientSnapshot?.contactName || "";
  const total = money(quote?.totals?.sellTotal || 0);
  const itemCount = Number(quote?.totals?.itemCount || 0);
  const notes = (quote?.notes || "").trim();
  const preheader = `Quote ${quote?.quoteNumber || ""} is ready for review. Approve, request changes, or reject online.`;

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Quote Approval</title>
    </head>
    <body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#16202a;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
        ${htmlEscape(preheader)}
      </div>

      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:24px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;background:#ffffff;border-radius:16px;overflow:hidden;">
              <tr>
                <td style="padding:28px 28px 16px;background:linear-gradient(135deg,#1f3a5f,#345d91);color:#fff;">
                  <div style="font-size:12px;letter-spacing:1px;opacity:.85;text-transform:uppercase;">Quote ready for approval</div>
                  <div style="font-size:30px;font-weight:700;line-height:1.15;margin-top:6px;">
                    ${htmlEscape(quote?.quoteNumber || "Quote")}
                  </div>
                  <div style="font-size:14px;opacity:.9;margin-top:10px;">
                    Review the quote and let us know whether you'd like to approve it, request changes, or reject it.
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
                      <td style="padding:8px 0;width:160px;color:#667085;"><strong>Items</strong></td>
                      <td style="padding:8px 0;">${itemCount}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;width:160px;color:#667085;"><strong>Total</strong></td>
                      <td style="padding:8px 0;font-size:20px;font-weight:700;">${total}</td>
                    </tr>
                  </table>
                </td>
              </tr>

              ${
                message
                  ? `
                    <tr>
                      <td style="padding:8px 28px 8px;">
                        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;">
                          <div style="font-weight:700;margin-bottom:6px;">Message</div>
                          <div style="font-size:14px;line-height:1.5;">${nl2br(message)}</div>
                        </div>
                      </td>
                    </tr>
                  `
                  : ""
              }

              ${
                notes
                  ? `
                    <tr>
                      <td style="padding:8px 28px 8px;">
                        <div style="background:#fffaf0;border:1px solid #f6e0a7;border-radius:12px;padding:14px;">
                          <div style="font-weight:700;margin-bottom:6px;">Quote Notes</div>
                          <div style="font-size:14px;line-height:1.5;">${nl2br(notes)}</div>
                        </div>
                      </td>
                    </tr>
                  `
                  : ""
              }

              <tr>
                <td style="padding:16px 28px 8px;">
                  <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Quote Summary</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #eee;border-radius:12px;overflow:hidden;">
                    <thead>
                      <tr style="background:#f8fafc;">
                        <th align="left" style="padding:10px;border-bottom:1px solid #eee;">Item</th>
                        <th align="left" style="padding:10px;border-bottom:1px solid #eee;">Qty</th>
                        <th align="left" style="padding:10px;border-bottom:1px solid #eee;">Unit</th>
                        <th align="left" style="padding:10px;border-bottom:1px solid #eee;">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${buildQuoteLinesHtml(quote?.lineItems || [])}
                    </tbody>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:20px 28px 10px;">
                  <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Choose an Action</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="padding:6px 0;">
                        <a href="${portalBaseUrl}&action=approve" style="display:block;text-align:center;background:#1e8e3e;color:#fff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:700;">Approve Quote</a>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;">
                        <a href="${portalBaseUrl}&action=changes_requested" style="display:block;text-align:center;background:#f59e0b;color:#fff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:700;">Request Changes</a>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0 0;">
                        <a href="${portalBaseUrl}&action=reject" style="display:block;text-align:center;background:#dc2626;color:#fff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:700;">Reject Quote</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:18px 28px 28px;color:#667085;font-size:13px;">
                  If the buttons above don't work, copy and paste this link into your browser:<br/>
                  <span style="word-break:break-all;color:#345d91;">${htmlEscape(portalBaseUrl)}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
}

function buildApprovalEmailText({ quote, portalBaseUrl, message }) {
  const company = quote?.clientSnapshot?.companyName || "";
  const contact = quote?.clientSnapshot?.contactName || "";
  const total = money(quote?.totals?.sellTotal || 0);
  const itemCount = Number(quote?.totals?.itemCount || 0);

  return [
    `Quote ${quote?.quoteNumber || ""} is ready for review.`,
    "",
    `Company: ${company || "—"}`,
    `Contact: ${contact || "—"}`,
    `Items: ${itemCount}`,
    `Total: ${total}`,
    "",
    message ? `Message:\n${message}\n` : "",
    `Quote summary:\n${buildQuoteLinesText(quote?.lineItems || [])}`,
    "",
    "Choose an action online:",
    `Approve: ${portalBaseUrl}&action=approve`,
    `Request changes: ${portalBaseUrl}&action=changes_requested`,
    `Reject: ${portalBaseUrl}&action=reject`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPortalPageHtml({ quote, token, action = "", submitted = false, resultText = "" }) {
  const selected = (action || "approve").toLowerCase();
  const total = money(quote?.totals?.sellTotal || 0);

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Quote Approval</title>
      <style>
        body {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          background: #f5f7fb;
          color: #16202a;
        }
        .wrap {
          max-width: 860px;
          margin: 0 auto;
          padding: 24px 14px 40px;
        }
        .card {
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 1px 2px rgba(0,0,0,.05);
          overflow: hidden;
        }
        .hero {
          background: linear-gradient(135deg,#1f3a5f,#345d91);
          color: #fff;
          padding: 26px;
        }
        .section {
          padding: 22px 26px;
          border-top: 1px solid #eef2f6;
        }
        .muted { color: #667085; }
        .row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px 24px;
        }
        .field {
          min-width: 180px;
          flex: 1;
        }
        .choice {
          border: 1px solid #dbe3ee;
          border-radius: 12px;
          padding: 14px;
          margin-bottom: 10px;
          background: #fff;
        }
        .choice.active {
          border-color: #345d91;
          background: #f8fbff;
        }
        textarea {
          width: 100%;
          min-height: 120px;
          border-radius: 12px;
          border: 1px solid #d0d7e2;
          padding: 12px;
          font: inherit;
          box-sizing: border-box;
        }
        button {
          width: 100%;
          border: none;
          border-radius: 12px;
          padding: 14px 18px;
          font-size: 16px;
          font-weight: 700;
          color: white;
          cursor: pointer;
        }
        button.approve { background: #1e8e3e; }
        button.change { background: #f59e0b; }
        button.reject { background: #dc2626; }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
        }
        th, td {
          text-align: left;
          padding: 10px;
          border-bottom: 1px solid #eef2f6;
        }
        th { background: #f8fafc; }
        .success {
          background: #ecfdf3;
          color: #065f46;
          padding: 14px 16px;
          border-radius: 12px;
          border: 1px solid #a7f3d0;
        }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          <div class="hero">
            <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.85;">Quote response</div>
            <div style="font-size:30px;font-weight:700;margin-top:6px;">${htmlEscape(quote?.quoteNumber || "Quote")}</div>
            <div style="margin-top:10px;opacity:.92;">Review the quote details below and submit your response.</div>
          </div>

          <div class="section">
            <div class="row">
              <div class="field"><div class="muted">Company</div><div><strong>${htmlEscape(quote?.clientSnapshot?.companyName || "—")}</strong></div></div>
              <div class="field"><div class="muted">Contact</div><div><strong>${htmlEscape(quote?.clientSnapshot?.contactName || "—")}</strong></div></div>
              <div class="field"><div class="muted">Total</div><div style="font-size:22px;"><strong>${total}</strong></div></div>
            </div>
          </div>

          <div class="section">
            <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Quote Summary</div>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${buildQuoteLinesHtml(quote?.lineItems || [])}
              </tbody>
            </table>
          </div>

          <div class="section">
            ${
              submitted
                ? `<div class="success"><strong>Response recorded.</strong><br/>${htmlEscape(resultText)}</div>`
                : `
                  <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Your Response</div>
                  <form method="POST">
                    <input type="hidden" name="quoteId" value="${htmlEscape(quote?.id || "")}" />
                    <input type="hidden" name="token" value="${htmlEscape(token || "")}" />

                    <label class="choice ${selected === "approve" ? "active" : ""}">
                      <input type="radio" name="action" value="approve" ${selected === "approve" ? "checked" : ""} />
                      <strong>Approve Quote</strong>
                      <div class="muted">Confirm that you're happy to proceed.</div>
                    </label>

                    <label class="choice ${selected === "changes_requested" ? "active" : ""}">
                      <input type="radio" name="action" value="changes_requested" ${selected === "changes_requested" ? "checked" : ""} />
                      <strong>Request Changes</strong>
                      <div class="muted">Ask for adjustments before approval.</div>
                    </label>

                    <label class="choice ${selected === "reject" ? "active" : ""}">
                      <input type="radio" name="action" value="reject" ${selected === "reject" ? "checked" : ""} />
                      <strong>Reject Quote</strong>
                      <div class="muted">Let us know you don't wish to proceed.</div>
                    </label>

                    <div style="margin-top:14px;margin-bottom:8px;font-weight:700;">Comments</div>
                    <textarea name="message" placeholder="Add any comments here..."></textarea>

                    <div style="margin-top:14px;">
                      <button type="submit" class="${selected === "reject" ? "reject" : selected === "changes_requested" ? "change" : "approve"}">
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

exports.sendQuoteApprovalEmail = onRequest(
  { region, secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, FRONTEND_BASE_URL, MGMT_EMAIL] },
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
      const quoteId = (body.quoteId || "").toString().trim();
      const emailOverride = (body.emailOverride || "").toString().trim();
      const message = (body.message || "").toString().trim();

      if (!quoteId) {
        res.status(400).send("Missing quoteId");
        return;
      }

      const quoteRef = db.collection("quotes").doc(quoteId);
const quoteSnap = await quoteRef.get();
if (!quoteSnap.exists) {
  res.status(404).send("Quote not found");
  return;
}

      const quote = { id: quoteSnap.id, ...quoteSnap.data() };
      const targetEmail = emailOverride || quote?.clientSnapshot?.email || "";

      if (!targetEmail || !targetEmail.includes("@")) {
        res.status(400).send("No valid client email found");
        return;
      }

      const token = crypto.randomBytes(24).toString("hex");
      const approvalPortalBase = buildPortalUrl(quoteId, token);
      const approvalRequest = {
        token,
        recipientEmail: targetEmail,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        message,
        status: "sent",
      };

      await quoteRef.set(
        {
          status: quote.status === "draft" ? "sent" : quote.status,
          approvalToken: token,
          approvalRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
          approvalRecipientEmail: targetEmail,
          approvalStatus: "sent",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await quoteRef.collection("approvalRequests").add(approvalRequest);

      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: GMAIL_USER.value(),
          pass: GMAIL_APP_PASSWORD.value(),
        },
      });

      const html = buildApprovalEmailHtml({
        quote,
        portalBaseUrl: approvalPortalBase,
        message,
      });

      const text = buildApprovalEmailText({
        quote,
        portalBaseUrl: approvalPortalBase,
        message,
      });

      const mgmtBcc = (MGMT_EMAIL.value() || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      await transporter.sendMail({
        from: `"Tender Edge" <${GMAIL_USER.value()}>`,
        to: targetEmail,
        bcc: mgmtBcc.length ? mgmtBcc : undefined,
        subject: `Quote ${quote.quoteNumber || ""} ready for approval`,
        html,
        text,
      });

      res.status(200).json({
        ok: true,
        sentTo: targetEmail,
        portalUrl: approvalPortalBase,
      });
    } catch (err) {
      console.error("sendQuoteApprovalEmail failed", err);
      res.status(500).send(err?.message || "Failed to send approval email");
    }
  }
);

exports.quoteApprovalPortal = onRequest(
  { region },
  async (req, res) => {
    try {
      const source = req.method === "POST" ? req.body || {} : req.query || {};
      const quoteId = (source.quoteId || "").toString().trim();
      const token = (source.token || "").toString().trim();
      const action = (source.action || "approve").toString().trim().toLowerCase();
      const message = (source.message || "").toString().trim();

      if (!quoteId || !token) {
        res.status(400).send("Missing quoteId or token");
        return;
      }

      const quoteRef = db.collection("quotes").doc(quoteId);
const quoteSnap = await quoteRef.get();
if (!quoteSnap.exists) {
  res.status(404).send("Quote not found");
  return;
}

const quote = { id: quoteSnap.id, ...quoteSnap.data() };
      if (!quote.approvalToken || quote.approvalToken !== token) {
        res.status(403).send("Invalid or expired token");
        return;
      }

      if (req.method === "POST") {
        const responseStatus =
          action === "approve"
            ? "approved"
            : action === "reject"
            ? "rejected"
            : "changes_requested";

        const nowField =
          responseStatus === "approved"
            ? { approvedAt: FV.serverTimestamp() }
            : responseStatus === "rejected"
            ? { rejectedAt: FV.serverTimestamp() }
            : { changesRequestedAt: FV.serverTimestamp() };

        await quoteRef.set(
          {
            approvalStatus: responseStatus,
            approvalResponseMessage: message,
            approvalRespondedAt: FV.serverTimestamp(),
            updatedAt: FV.serverTimestamp(),
            ...nowField,
          },
          { merge: true }
        );

        await quoteRef.collection("approvalResponses").add({
          action: responseStatus,
          message,
          respondedAt: FV.serverTimestamp(),
        });

        await addNotification({
          type: "quote_response",
          title:
            responseStatus === "approved"
              ? `Quote approved — ${quote.quoteNumber || "Quote"}`
              : responseStatus === "rejected"
              ? `Quote rejected — ${quote.quoteNumber || "Quote"}`
              : `Quote changes requested — ${quote.quoteNumber || "Quote"}`,
          body: message || "",
          route: `/quotes/${quote.id}`,
          relatedId: quote.id,
        });

        const workflowResult = await applyQuoteResponseWorkflow(
          quote,
          responseStatus,
          message
        );

        res.status(200).send(
          buildPortalPageHtml({
            quote,
            token,
            action,
            submitted: true,
            resultText: workflowResult.resultText,
          })
        );
        return;
      }

      res.status(200).send(buildPortalPageHtml({ quote, token, action }));
    } catch (err) {
      console.error("quoteApprovalPortal failed", err);
      res.status(500).send(err?.message || "Failed to load quote approval page");
    }
  }
);