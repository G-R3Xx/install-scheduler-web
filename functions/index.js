// functions/index.js

const { onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { Storage } = require('@google-cloud/storage');
const crypto = require('crypto');

try {
  admin.app();
} catch {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = new Storage();
const region = 'australia-southeast1';

// === Secrets ===
const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
const MGMT_EMAIL = defineSecret('MGMT_EMAIL');
const MAIL_TEST_KEY = defineSecret('MAIL_TEST_KEY');
const FRONTEND_BASE_URL = defineSecret('FRONTEND_BASE_URL');

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (v) => (v || '').toString().trim();

function makeDocNumber(prefix = 'DOC') {
  const d = new Date();
  const y = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const t = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${y}${m}${day}-${t}-${rand}`;
}

function makeToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function makeTempPassword() {
  return `${crypto.randomBytes(12).toString('base64url')}Aa1!`;
}

function formatMoney(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function esc(v) {
  return (v || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(v) {
  return esc(v).replace(/\n/g, '<br/>');
}

function parseEmailList(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function makeTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
  });
}

function projectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
}

function buildQuoteApprovalPortalUrl(quoteId, token) {
  const pid = projectId();
  return `https://${region}-${pid}.cloudfunctions.net/quoteApprovalPortal?quoteId=${encodeURIComponent(quoteId)}&token=${encodeURIComponent(token)}`;
}

function buildOrderProofPortalUrl(orderId, proofId, token) {
  const pid = projectId();
  return `https://${region}-${pid}.cloudfunctions.net/orderProofApprovalPortal?orderId=${encodeURIComponent(orderId)}&proofId=${encodeURIComponent(proofId)}&token=${encodeURIComponent(token)}`;
}

function getRequestField(req, key) {
  if (req.body && typeof req.body === 'object' && req.body[key] !== undefined) {
    return req.body[key];
  }

  try {
    const raw = (req.rawBody || '').toString();
    const params = new URLSearchParams(raw);
    if (params.has(key)) return params.get(key);
  } catch (_) {}

  if (req.query && req.query[key] !== undefined) return req.query[key];
  return '';
}

function applyCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function createNotification(payload) {
  try {
    await db.collection('notifications').add({
      ...payload,
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('createNotification warning:', e?.message || e);
  }
}

/** Compute hours from entry (manual hours or start/end). */
function hoursFromEntry(d) {
  if (typeof d.hours === 'number' && Number.isFinite(d.hours)) return d.hours;

  const hasEnd = typeof d.end !== 'undefined' && d.end !== null;
  if (!hasEnd) return 0;

  const start = d.start?.toDate?.() || null;
  const end = d.end?.toDate?.() || null;
  if (!start || !end) return 0;

  return (end.getTime() - start.getTime()) / 3600000;
}

function renderClientFacingQuoteHtml(quote, approvalUrl, extraMessage = '') {
  const lines = Array.isArray(quote.lineItems) ? quote.lineItems : [];
  const rows = lines.length
    ? lines.map((li) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;">${esc(li.productName || 'Item')}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center;">${Number(li.qty || 0)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${formatMoney(li?.calc?.breakdown?.sellTotal || 0)}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="3" style="padding:8px 0;color:#777;">No line items.</td></tr>`;

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111;line-height:1.5;">
      <p>Hi ${esc(quote?.clientSnapshot?.contactName || quote?.clientSnapshot?.companyName || 'there')},</p>
      <p>Please review your quote below.</p>

      ${extraMessage ? `<div style="background:#fafafa;border:1px solid #ddd;padding:10px;border-radius:4px;margin:12px 0;">${nl2br(extraMessage)}</div>` : ''}

      <h3 style="margin:16px 0 8px;">Quote ${esc(quote.quoteNumber || '')}</h3>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th align="left" style="padding:8px 0;border-bottom:2px solid #ddd;">Item</th>
            <th align="center" style="padding:8px 0;border-bottom:2px solid #ddd;">Qty</th>
            <th align="right" style="padding:8px 0;border-bottom:2px solid #ddd;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr>
            <td colspan="2" style="padding:12px 0 0;font-weight:700;">Total</td>
            <td style="padding:12px 0 0;text-align:right;font-weight:700;">${formatMoney(quote?.totals?.sellTotal || 0)}</td>
          </tr>
        </tbody>
      </table>

      ${quote?.notes ? `
        <h3 style="margin:16px 0 8px;">Notes</h3>
        <div style="background:#fafafa;border:1px solid #ddd;padding:10px;border-radius:4px;">
          ${nl2br(quote.notes)}
        </div>
      ` : ''}

      <div style="margin-top:24px;">
        <a href="${approvalUrl}" style="display:inline-block;background:#1976d2;color:#fff;text-decoration:none;padding:12px 16px;border-radius:8px;font-weight:700;">
          Review / Approve Quote
        </a>
      </div>

      <p style="margin-top:16px;color:#666;">If the button doesn't work, copy this link into your browser:<br/>${esc(approvalUrl)}</p>

      <p>Thanks,<br/>Tender Edge</p>
    </div>
  `;
}

function renderClientFacingQuoteText(quote, approvalUrl, extraMessage = '') {
  const lines = Array.isArray(quote.lineItems) ? quote.lineItems : [];
  const lineText = lines.length
    ? lines.map((li) => `• ${li.productName || 'Item'} × ${Number(li.qty || 0)} — ${formatMoney(li?.calc?.breakdown?.sellTotal || 0)}`).join('\n')
    : 'No line items';

  return [
    `Hi ${quote?.clientSnapshot?.contactName || quote?.clientSnapshot?.companyName || 'there'},`,
    '',
    'Please review your quote below.',
    extraMessage ? `\n${extraMessage}\n` : '',
    `Quote ${quote.quoteNumber || ''}`,
    lineText,
    '',
    `Total: ${formatMoney(quote?.totals?.sellTotal || 0)}`,
    quote?.notes ? `\nNotes:\n${quote.notes}\n` : '',
    `Review / Approve here: ${approvalUrl}`,
    '',
    'Thanks,',
    'Tender Edge',
  ].filter(Boolean).join('\n');
}

function renderOrderProofEmailHtml(order, proof, portalUrl, extraMessage = '') {
  const attachments = Array.isArray(proof?.attachments) ? proof.attachments : [];
  const attachmentList = attachments.length
    ? attachments.map((a) => `<li><a href="${a.url}" target="_blank" rel="noopener">${esc(a.name || 'Proof file')}</a></li>`).join('')
    : '<li>No proof attachments found.</li>';

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111;line-height:1.5;">
      <p>Hi ${esc(order?.clientSnapshot?.contactName || order?.clientSnapshot?.companyName || 'there')},</p>
      <p>Please review the attached / linked artwork proof for your order.</p>

      ${extraMessage ? `<div style="background:#fafafa;border:1px solid #ddd;padding:10px;border-radius:4px;margin:12px 0;">${nl2br(extraMessage)}</div>` : ''}

      <h3 style="margin:16px 0 8px;">Order ${esc(order.orderNumber || '')}</h3>
      <p>${esc(order?.clientSnapshot?.companyName || '')}${order?.quoteNumber ? ` • Quote ${esc(order.quoteNumber)}` : ''}</p>

      <h3 style="margin:16px 0 8px;">Proof files</h3>
      <ul>${attachmentList}</ul>

      <div style="margin-top:24px;">
        <a href="${portalUrl}" style="display:inline-block;background:#1976d2;color:#fff;text-decoration:none;padding:12px 16px;border-radius:8px;font-weight:700;">
          Review / Approve Artwork
        </a>
      </div>

      <p style="margin-top:16px;color:#666;">If the button doesn't work, copy this link into your browser:<br/>${esc(portalUrl)}</p>

      <p>Thanks,<br/>Tender Edge</p>
    </div>
  `;
}

function renderOrderProofEmailText(order, proof, portalUrl, extraMessage = '') {
  const attachments = Array.isArray(proof?.attachments) ? proof.attachments : [];
  return [
    `Hi ${order?.clientSnapshot?.contactName || order?.clientSnapshot?.companyName || 'there'},`,
    '',
    'Please review the artwork proof for your order.',
    extraMessage ? `\n${extraMessage}\n` : '',
    `Order: ${order.orderNumber || ''}`,
    order?.quoteNumber ? `Quote: ${order.quoteNumber}` : '',
    '',
    'Proof files:',
    attachments.length ? attachments.map((a) => `• ${a.name || 'Proof file'} — ${a.url}`).join('\n') : '• No proof attachments found.',
    '',
    `Review / Approve here: ${portalUrl}`,
    '',
    'Thanks,',
    'Tender Edge',
  ].filter(Boolean).join('\n');
}

function renderProofStatusChipLabel(status) {
  const s = (status || '').toString().toLowerCase();
  if (s === 'approved') return 'Approved';
  if (s === 'changes_requested') return 'Changes Requested';
  if (s === 'sent') return 'Sent';
  return status || 'Unknown';
}

function renderQuotePortalPage({ quote, quoteId, token, statusMessage = '', severity = 'info' }) {
  const lines = Array.isArray(quote.lineItems) ? quote.lineItems : [];
  const rows = lines.length
    ? lines.map((li) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #eee;">${esc(li.productName || 'Item')}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:center;">${Number(li.qty || 0)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;">${formatMoney(li?.calc?.breakdown?.sellTotal || 0)}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="3" style="padding:10px 0;color:#777;">No line items.</td></tr>`;

  const bannerBg = severity === 'success' ? '#e8f5e9' : severity === 'error' ? '#ffebee' : '#e3f2fd';
  const bannerBorder = severity === 'success' ? '#81c784' : severity === 'error' ? '#ef9a9a' : '#64b5f6';

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title>Quote ${esc(quote.quoteNumber || '')}</title>
      <style>
        body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #f6f7fb; margin: 0; color: #111; }
        .wrap { max-width: 900px; margin: 0 auto; padding: 24px; }
        .card { background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,.08); margin-bottom: 16px; }
        .btn { display: inline-block; padding: 12px 16px; border-radius: 10px; border: 1px solid #d0d7de; text-decoration: none; font-weight: 700; cursor: pointer; background: #fff; }
        .btn-primary { background: #1976d2; color: #fff; border-color: #1976d2; }
        .btn-danger { color: #b71c1c; border-color: #ef9a9a; }
        textarea { width: 100%; min-height: 110px; border-radius: 10px; border: 1px solid #d0d7de; padding: 12px; font: inherit; box-sizing: border-box; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 10px 0; border-bottom: 2px solid #ddd; }
        .muted { color: #666; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          <h1 style="margin:0 0 8px;">Quote ${esc(quote.quoteNumber || '')}</h1>
          <div class="muted">${esc(quote?.clientSnapshot?.companyName || '')}${quote?.clientSnapshot?.contactName ? ` • ${esc(quote.clientSnapshot.contactName)}` : ''}</div>
          ${statusMessage ? `<div style="margin-top:16px;background:${bannerBg};border:1px solid ${bannerBorder};padding:12px 14px;border-radius:10px;">${statusMessage}</div>` : ''}
        </div>

        <div class="card">
          <h2 style="margin-top:0;">Quote summary</h2>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th style="text-align:center;">Qty</th>
                <th style="text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
              <tr>
                <td colspan="2" style="padding-top:14px;font-weight:800;">Total</td>
                <td style="padding-top:14px;text-align:right;font-weight:800;">${formatMoney(quote?.totals?.sellTotal || 0)}</td>
              </tr>
            </tbody>
          </table>
          ${quote?.notes ? `<div style="margin-top:16px;background:#fafafa;border:1px solid #ddd;padding:12px;border-radius:10px;">${nl2br(quote.notes)}</div>` : ''}
        </div>

        <div class="card">
          <h2 style="margin-top:0;">Respond</h2>
          <form method="post">
            <input type="hidden" name="quoteId" value="${esc(quoteId)}"/>
            <input type="hidden" name="token" value="${esc(token)}"/>
            <label for="message" style="display:block;margin-bottom:8px;font-weight:700;">Comments (optional)</label>
            <textarea id="message" name="message" placeholder="Add any comments or requested changes here..."></textarea>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
              <button class="btn btn-primary" type="submit" name="action" value="approve">Approve Quote</button>
              <button class="btn" type="submit" name="action" value="changes">Request Changes</button>
              <button class="btn btn-danger" type="submit" name="action" value="reject">Reject</button>
            </div>
          </form>
        </div>
      </div>
    </body>
  </html>`;
}

function renderOrderProofPortalPage({ order, proof, orderId, proofId, token, statusMessage = '', severity = 'info' }) {
  const attachments = Array.isArray(proof?.attachments) ? proof.attachments : [];
  const attachmentList = attachments.length
    ? attachments.map((a) => `<li><a href="${a.url}" target="_blank" rel="noopener">${esc(a.name || 'Proof file')}</a></li>`).join('')
    : '<li>No proof attachments found.</li>';

  const bannerBg = severity === 'success' ? '#e8f5e9' : severity === 'error' ? '#ffebee' : '#e3f2fd';
  const bannerBorder = severity === 'success' ? '#81c784' : severity === 'error' ? '#ef9a9a' : '#64b5f6';

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title>Artwork Proof ${esc(order.orderNumber || '')}</title>
      <style>
        body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #f6f7fb; margin: 0; color: #111; }
        .wrap { max-width: 900px; margin: 0 auto; padding: 24px; }
        .card { background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,.08); margin-bottom: 16px; }
        .btn { display: inline-block; padding: 12px 16px; border-radius: 10px; border: 1px solid #d0d7de; text-decoration: none; font-weight: 700; cursor: pointer; background: #fff; }
        .btn-primary { background: #1976d2; color: #fff; border-color: #1976d2; }
        textarea { width: 100%; min-height: 110px; border-radius: 10px; border: 1px solid #d0d7de; padding: 12px; font: inherit; box-sizing: border-box; }
        .muted { color: #666; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          <h1 style="margin:0 0 8px;">Artwork Proof — ${esc(order.orderNumber || '')}</h1>
          <div class="muted">${esc(order?.clientSnapshot?.companyName || '')}${order?.quoteNumber ? ` • Quote ${esc(order.quoteNumber)}` : ''}</div>
          <div class="muted" style="margin-top:6px;">Status: ${esc(renderProofStatusChipLabel(proof?.status || 'sent'))}</div>
          ${statusMessage ? `<div style="margin-top:16px;background:${bannerBg};border:1px solid ${bannerBorder};padding:12px 14px;border-radius:10px;">${statusMessage}</div>` : ''}
        </div>

        <div class="card">
          <h2 style="margin-top:0;">Proof files</h2>
          <ul>${attachmentList}</ul>
          ${proof?.message ? `<div style="margin-top:16px;background:#fafafa;border:1px solid #ddd;padding:12px;border-radius:10px;">${nl2br(proof.message)}</div>` : ''}
        </div>

        <div class="card">
          <h2 style="margin-top:0;">Respond</h2>
          <form method="post">
            <input type="hidden" name="orderId" value="${esc(orderId)}"/>
            <input type="hidden" name="proofId" value="${esc(proofId)}"/>
            <input type="hidden" name="token" value="${esc(token)}"/>
            <label for="message" style="display:block;margin-bottom:8px;font-weight:700;">Comments (optional)</label>
            <textarea id="message" name="message" placeholder="Add any changes or comments here..."></textarea>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
              <button class="btn btn-primary" type="submit" name="action" value="approve">Approve Artwork</button>
              <button class="btn" type="submit" name="action" value="changes">Request Changes</button>
            </div>
          </form>
        </div>
      </div>
    </body>
  </html>`;
}

async function createOrderFromQuoteIfMissing(quoteId) {
  const quoteRef = db.collection('quotes').doc(quoteId);
  const leadRefGetter = (leadId) => db.collection('leads').doc(leadId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(quoteRef);
    if (!snap.exists) throw new Error(`Quote not found: ${quoteId}`);
    const quote = snap.data() || {};

    if (quote.orderId) {
      return { orderId: quote.orderId, orderNumber: quote.orderNumber || '' };
    }

    const lineItems = Array.isArray(quote.lineItems) ? quote.lineItems : [];
    const computedTotals = {
      costTotal: round2(lineItems.reduce((a, li) => a + (Number(li?.calc?.breakdown?.costTotal) || 0), 0)),
      sellTotal: round2(lineItems.reduce((a, li) => a + (Number(li?.calc?.breakdown?.sellTotal) || 0), 0)),
      itemCount: lineItems.length,
    };

    const orderNumber = makeDocNumber('WO');
    const orderRef = db.collection('orders').doc();

    tx.set(orderRef, {
      orderNumber,
      status: 'open',
      sourceQuoteId: quoteId,
      quoteNumber: quote.quoteNumber || '',
      clientId: quote.clientId || '',
      clientSnapshot: quote.clientSnapshot || null,
      lineItems,
      totals: quote.totals || computedTotals,
      notes: quote.notes || '',
      installJobId: '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(quoteRef, {
      orderId: orderRef.id,
      orderNumber,
      convertedToOrderAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (quote.sourceLeadId) {
      tx.set(
        leadRefGetter(quote.sourceLeadId),
        {
          status: 'won',
          quoteId: quoteId,
          quoteNumber: quote.quoteNumber || '',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return { orderId: orderRef.id, orderNumber };
  });
}

async function notifyManagementOfQuoteResponse({ quote, action, message, orderNumber = '' }) {
  const mgmt = parseEmailList(MGMT_EMAIL.value());
  if (!mgmt.length) return;

  const transporter = makeTransporter();
  const statusMap = {
    approve: 'approved',
    changes: 'requested changes for',
    reject: 'rejected',
  };
  const verb = statusMap[action] || action;
  const subject = `Quote ${quote.quoteNumber || ''} ${verb}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111;line-height:1.5;">
      <h2>Quote response received</h2>
      <p><strong>Quote:</strong> ${esc(quote.quoteNumber || '')}</p>
      <p><strong>Client:</strong> ${esc(quote?.clientSnapshot?.companyName || '')} ${quote?.clientSnapshot?.contactName ? `• ${esc(quote.clientSnapshot.contactName)}` : ''}</p>
      <p><strong>Response:</strong> ${esc(verb)}</p>
      ${orderNumber ? `<p><strong>Order created:</strong> ${esc(orderNumber)}</p>` : ''}
      ${message ? `<h3>Client message</h3><div style="background:#fafafa;border:1px solid #ddd;padding:10px;border-radius:4px;">${nl2br(message)}</div>` : ''}
    </div>
  `;
  const text = [
    'Quote response received',
    `Quote: ${quote.quoteNumber || ''}`,
    `Client: ${quote?.clientSnapshot?.companyName || ''} ${quote?.clientSnapshot?.contactName ? `• ${quote.clientSnapshot.contactName}` : ''}`,
    `Response: ${verb}`,
    orderNumber ? `Order created: ${orderNumber}` : '',
    message ? `Client message:\n${message}` : '',
  ].filter(Boolean).join('\n');

  await transporter.sendMail({
    from: `"Work Manager" <${GMAIL_USER.value()}>`,
    to: mgmt,
    subject,
    html,
    text,
  });
}

async function notifyManagementOfProofResponse({ order, proof, action, message }) {
  const mgmt = parseEmailList(MGMT_EMAIL.value());
  if (!mgmt.length) return;

  const transporter = makeTransporter();
  const verb = action === 'approve' ? 'approved' : 'requested changes for';
  const subject = `Artwork proof ${verb} — ${order.orderNumber || ''}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111;line-height:1.5;">
      <h2>Artwork proof response received</h2>
      <p><strong>Order:</strong> ${esc(order.orderNumber || '')}</p>
      <p><strong>Client:</strong> ${esc(order?.clientSnapshot?.companyName || '')} ${order?.clientSnapshot?.contactName ? `• ${esc(order.clientSnapshot.contactName)}` : ''}</p>
      <p><strong>Response:</strong> ${esc(verb)}</p>
      ${proof?.attachments?.length ? `<p><strong>Proof files:</strong> ${proof.attachments.map((a) => esc(a.name || 'Proof file')).join(', ')}</p>` : ''}
      ${message ? `<h3>Client message</h3><div style="background:#fafafa;border:1px solid #ddd;padding:10px;border-radius:4px;">${nl2br(message)}</div>` : ''}
    </div>
  `;
  const text = [
    'Artwork proof response received',
    `Order: ${order.orderNumber || ''}`,
    `Client: ${order?.clientSnapshot?.companyName || ''} ${order?.clientSnapshot?.contactName ? `• ${order.clientSnapshot.contactName}` : ''}`,
    `Response: ${verb}`,
    message ? `Client message:\n${message}` : '',
  ].filter(Boolean).join('\n');

  await transporter.sendMail({
    from: `"Work Manager" <${GMAIL_USER.value()}>`,
    to: mgmt,
    subject,
    html,
    text,
  });
}

// ------------------------------------------------------------------
// HOURS RECALC: runs on any timeEntries write
// ------------------------------------------------------------------
exports.recalcJobHoursOnTimeEntryWrite = onDocumentWritten(
  { region, document: 'jobs/{jobId}/timeEntries/{entryId}' },
  async (event) => {
    const { jobId } = event.params;
    const entriesSnap = await db.collection('jobs').doc(jobId).collection('timeEntries').get();
    let total = 0;
    for (const docSnap of entriesSnap.docs) {
      total += hoursFromEntry(docSnap.data() || {});
    }
    await db.collection('jobs').doc(jobId).update({
      hoursTotal: round2(total),
      hoursUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
);

// ------------------------------------------------------------------
// EMAIL ON COMPLETION — Gmail (SMTP + App Password)
// ------------------------------------------------------------------
exports.sendCompletionEmail = onDocumentUpdated(
  { region, document: 'jobs/{jobId}', secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, MGMT_EMAIL] },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after  = event.data?.after?.data()  || {};
    const jobId  = event.params.jobId;

    const wasCompleted = String(before.status || '').toLowerCase() === 'completed';
    const nowCompleted = String(after.status  || '').toLowerCase() === 'completed';
    if (wasCompleted || !nowCompleted) return;

    const job = after;
    const client = job.clientName || 'Unknown Job';

    const usersSnap = await db.collection('users').get();
    const userMap = {};
    usersSnap.forEach((d) => {
      const u = d.data() || {};
      userMap[d.id] = { shortName: u.shortName, displayName: u.displayName, email: u.email };
    });

    const timeEntriesSnap = await db.collection(`jobs/${jobId}/timeEntries`).get();
    const timeEntries = timeEntriesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    let total = 0;
    const rows = timeEntries.map((e) => {
      const hrs = round2(hoursFromEntry(e));
      total += hrs;
      const user =
        userMap[e.userId]?.shortName ||
        userMap[e.userId]?.displayName ||
        userMap[e.userId]?.email ||
        e.userId;
      const when = e.createdAt?.toDate?.()?.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }) || '—';
      return `<tr><td>${user}</td><td>${hrs}</td><td>${when}</td></tr>`;
    });
    const totalRounded = round2(total);

    const completedSnap = await db.collection(`jobs/${jobId}/completedPhotos`).get();
    const photos = completedSnap.docs.map((d) => d.data());
    const photoHtml = photos.length
      ? photos.map((p) => `
          <a href="${p.url}" target="_blank" rel="noopener">
            <img src="${p.url}" style="width:120px;height:auto;border:1px solid #ccc;border-radius:4px;margin:4px;" />
          </a>`).join('')
      : `<p style="color:#888;">No completed photos.</p>`;

    const signatureHtml = job.signatureURL
      ? `<a href="${job.signatureURL}" target="_blank" rel="noopener">
           <img src="${job.signatureURL}" style="max-width:300px;border:1px solid #ccc;border-radius:4px;" />
         </a>`
      : '';

    const assignedNames = Array.isArray(job.assignedTo)
      ? job.assignedTo.map(uid =>
          userMap[uid]?.shortName || userMap[uid]?.displayName || userMap[uid]?.email || uid
        ).join(', ')
      : '—';

    const installDate = job.installDate?.toDate?.() || null;
    const dateStr = installDate
      ? installDate.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })
      : '—';
    const timeStr = installDate && job.installTime
      ? installDate.toLocaleTimeString('en-AU', {
          timeZone: 'Australia/Sydney',
          hour: 'numeric',
          minute: '2-digit'
        })
      : '';

    const notesHtml = (job.installerNotes || '—')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5;color:#333;">
        <h2 style="color:#2e7d32;margin:0 0 12px;">✅ Job Completed</h2>

        <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:16px;">
          <tr style="background:#f5f5f5;"><td><strong>Job</strong></td><td>${client}</td></tr>
          <tr><td><strong>Client</strong></td><td>${job.company || ''}</td></tr>
          <tr style="background:#f5f5f5;"><td><strong>Address</strong></td><td>${job.address || ''}</td></tr>
          <tr><td><strong>Install Date</strong></td><td>${dateStr} ${timeStr}</td></tr>
          <tr style="background:#f5f5f5;"><td><strong>Assigned To</strong></td><td>${assignedNames}</td></tr>
        </table>

        <h3 style="margin:16px 0 8px;">Installer Notes</h3>
        <div style="background:#fafafa;border:1px solid #ddd;padding:10px;border-radius:4px;">
          ${notesHtml}
        </div>

        <h3 style="margin:16px 0 8px;">Hours</h3>
        <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #eee;margin-bottom:16px;">
          <thead>
            <tr style="background:#efefef;">
              <th align="left">User</th>
              <th align="left">Hours</th>
              <th align="left">Logged At</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('')}
            <tr style="background:#f5f5f5;font-weight:600;">
              <td>Total</td><td>${totalRounded}</td><td></td>
            </tr>
          </tbody>
        </table>

        <h3 style="margin:16px 0 8px;">Completed Photos</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">${photoHtml}</div>

        ${signatureHtml ? `<h3 style="margin:16px 0 8px;">Signature</h3>${signatureHtml}` : ''}
      </div>
    `;

    const transporter = makeTransporter();
    const toList = parseEmailList(MGMT_EMAIL.value());
    const replyTo = (job.email && String(job.email).includes('@'))
      ? `${job.contactName || job.clientName || 'Job'} <${job.email}>`
      : `"Install Scheduler" <${GMAIL_USER.value()}>`;

    const info = await transporter.sendMail({
      from: `"Install Scheduler" <${GMAIL_USER.value()}>`,
      to: toList,
      replyTo,
      subject: `Job Completed — ${client}${job.jobNumber ? ` [${job.jobNumber}]` : ''}`,
      html,
      text: `Job Completed — ${client}\n\n(HTML version includes details, hours, photos and signature.)`,
    });

    console.log(`Completion email sent for job ${jobId}`, info.messageId);
  }
);

// ------------------------------------------------------------------
// CLIENT SUMMARY EMAIL — Firestore trigger
// ------------------------------------------------------------------
exports.sendClientSummaryEmail = onDocumentUpdated(
  { region, document: 'jobs/{jobId}', secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, MGMT_EMAIL] },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after  = event.data?.after?.data()  || {};
    const jobId  = event.params.jobId;

    const prevReqId = before.clientEmailRequestId || null;
    const reqId     = after.clientEmailRequestId  || null;
    if (!reqId || prevReqId === reqId) return;

    const job = after;
    const targetEmail = (job.clientEmailTarget || job.email || '').toString().trim();
    if (!targetEmail || !targetEmail.includes('@')) {
      console.warn('Client summary email requested but no valid email', { jobId, targetEmail });
      return;
    }

    const clientName = job.clientName || job.contact || 'Valued client';
    const jobRef = db.collection('jobs').doc(jobId);
    const completedSnap = await jobRef.collection('completedPhotos').get();
    const photos = completedSnap.docs.map((d) => d.data() || {});

    const photosHtml = photos.length
      ? photos.filter((p) => p.url).map((p) => `
          <a href="${p.url}" target="_blank" rel="noopener">
            <img src="${p.url}" style="width:120px;height:auto;border:1px solid #ccc;border-radius:4px;margin:4px;" />
          </a>
        `).join('')
      : `<p style="color:#777;">No completion photos were attached for this job.</p>`;

    const signatureHtml = job.signatureURL
      ? `<p><strong>Sign-off:</strong></p>
         <img src="${job.signatureURL}" style="max-width:300px;border:1px solid #ddd;border-radius:4px;" />`
      : '';

    let dateStr = '';
    try {
      const installDate = job.installDate?.toDate?.() || null;
      dateStr = installDate ? installDate.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' }) : '';
    } catch (e) {
      console.warn('Unable to format installDate for job', jobId, e);
      dateStr = '';
    }

    const notesHtml = (job.installerNotes || '')
      .toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    const subject = `Your install is complete — ${clientName}`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111;line-height:1.5;">
        <p>Hi ${job.company || clientName},</p>
        <p>Your installation has been completed.</p>
        <h3 style="margin-top:16px;">Job summary</h3>
        <ul style="padding-left:18px;">
          <li><strong>Job:</strong> ${job.clientName || ''}</li>
          <li><strong>Client:</strong> ${job.company || ''}</li>
          <li><strong>Address:</strong> ${job.address || ''}</li>
          ${dateStr ? `<li><strong>Install date:</strong> ${dateStr}</li>` : ''}
          ${job.jobNumber ? `<li><strong>Job #:</strong> ${job.jobNumber}</li>` : ''}
          ${job.description ? `<li><strong>Description:</strong> ${job.description}</li>` : ''}
        </ul>
        ${notesHtml ? `<h3 style="margin-top:16px;">Installer notes</h3><div style="background:#fafafa;border:1px solid #ddd;padding:10px;border-radius:4px;">${notesHtml}</div>` : ''}
        <h3 style="margin-top:16px;">Completion photos</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">${photosHtml}</div>
        ${signatureHtml}
        <p style="margin-top:24px;">If you have any questions or need any adjustments, please reply to this email.</p>
        <p>Thanks,<br/>Tender Edge Install Team</p>
      </div>
    `;
    const text = [
      `Hi ${clientName},`,
      '',
      'Your installation has been completed.',
      '',
      `Job Name: ${job.clientName || ''}`,
      `Company: ${job.company || ''}`,
      `Address: ${job.address || ''}`,
      dateStr ? `Install date: ${dateStr}` : '',
      job.jobNumber ? `Job #: ${job.jobNumber}` : '',
      job.description ? `Description: ${job.description}` : '',
      '',
      photos.length ? 'Completion photos are visible in the HTML version of this email.' : 'No completion photos were added for this job.',
      job.signatureURL ? 'A copy of the sign-off is included in the HTML version.' : '',
      '',
      'Thanks,',
      'Tender Edge Install Team',
    ].filter(Boolean).join('\n');

    const transporter = makeTransporter();
    const to = `${clientName} <${targetEmail}>`;
    const mgmtEmail = parseEmailList(MGMT_EMAIL.value());

    try {
      const info = await transporter.sendMail({
        from: `"Tender Edge Install Team" <${GMAIL_USER.value()}>`,
        to,
        bcc: mgmtEmail.length ? mgmtEmail : undefined,
        subject,
        html,
        text,
      });

      console.log(`Client summary email sent for job ${jobId}`, info.messageId);
      await jobRef.update({
        clientEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastClientEmailRequestId: reqId,
        lastClientEmailError: admin.firestore.FieldValue.delete(),
      });
    } catch (err) {
      console.error('sendClientSummaryEmail failed', jobId, err);
      await jobRef.update({
        lastClientEmailRequestId: reqId,
        lastClientEmailError: err?.message || String(err),
      }).catch(() => {});
    }
  }
);

// ------------------------------------------------------------------
// INSTALLER REMINDER EMAIL — HTTP
// ------------------------------------------------------------------
exports.sendInstallerReminder = onRequest(
  { region, secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, FRONTEND_BASE_URL] },
  async (req, res) => {
    applyCors(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');

    try {
      if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

      const body = req.body || {};
      const jobId = body.jobId;
      const userIds = Array.isArray(body.userIds) ? body.userIds : [];
      const fields = Array.isArray(body.fields) ? body.fields : [];
      const extraMessage = (body.message || '').toString().trim();

      if (!jobId) return res.status(400).send('Missing jobId');
      if (!userIds.length) return res.status(400).send('No userIds provided');

      const jobRef = db.collection('jobs').doc(jobId);
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) return res.status(404).send(`Job not found: ${jobId}`);
      const job = jobSnap.data() || {};

      const userRefs = userIds.map((uid) => db.collection('users').doc(uid));
      const userSnaps = await db.getAll(...userRefs);
      const recipients = userSnaps
        .filter((snap) => snap.exists)
        .map((snap) => {
          const u = snap.data() || {};
          const email = (u.email || '').toString().trim();
          return { email, name: u.shortName || u.displayName || email };
        })
        .filter((r) => r.email && r.email.includes('@'));

      if (!recipients.length) return res.status(400).send('No valid recipient emails found');

      const friendlyFieldNames = {
        referencePhotos: 'Reference photos',
        completedPhotos: 'Completed photos',
        signature: 'Client signature',
        hours: 'Hours / timesheets',
        installerNotes: 'Installer notes',
      };
      const fieldLabels = fields.length ? fields.map((key) => friendlyFieldNames[key] || key) : ['Pending items'];
      const fieldHtml = fieldLabels.map((label) => `<li>${label}</li>`).join('');
      const fieldText = fieldLabels.map((label) => `• ${label}`).join('\n');

      const jobTitle = job.clientName || job.company || job.jobNumber || `Job ${jobId}`;
      const baseUrlRaw = (FRONTEND_BASE_URL.value && FRONTEND_BASE_URL.value()) || 'https://installscheduler.web.app';
      const baseUrl = baseUrlRaw.replace(/\/+$/, '');
      const jobUrl = `${baseUrl}/jobs/${jobId}`;

      const safeExtraHtml = extraMessage
        ? extraMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
        : '';

      const subject = `Reminder: Update job – ${jobTitle}`;
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111;line-height:1.5;">
          <p>Hi team,</p>
          <p>This is a reminder to finish the following items on job <strong>${jobTitle}</strong>.</p>
          <h3 style="margin-top:12px;">Items to update</h3>
          <ul>${fieldHtml}</ul>
          ${safeExtraHtml ? `<p><strong>Note from manager:</strong><br>${safeExtraHtml}</p>` : ''}
          <p style="margin-top:16px;"><a href="${jobUrl}">Open this job in InstallScheduler</a></p>
        </div>
      `;
      const text = [
        'Hi team,',
        '',
        `This is a reminder to finish the following items on job "${jobTitle}":`,
        '',
        fieldText,
        '',
        extraMessage ? `Note from manager:\n${extraMessage}` : '',
        '',
        `Open this job: ${jobUrl}`,
      ].filter(Boolean).join('\n');

      const transporter = makeTransporter();
      const to = recipients.map((r) => (r.name ? `${r.name} <${r.email}>` : r.email));
      const info = await transporter.sendMail({
        from: `"Install Scheduler" <${GMAIL_USER.value()}>`,
        to,
        subject,
        html,
        text,
      });

      await jobRef.collection('reminders').add({
        userIds,
        fields,
        message: extraMessage,
        recipients: to,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log('sendInstallerReminder sent', jobId, info.messageId);
      res.status(200).json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error('sendInstallerReminder error', err);
      res.status(500).send(err?.message || String(err));
    }
  }
);

// ------------------------------------------------------------------
// SECURE QUOTE EMAIL SEND — HTTP + SMTP
// ------------------------------------------------------------------
exports.sendQuoteApprovalEmail = onRequest(
  { region, secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, MGMT_EMAIL] },
  async (req, res) => {
    applyCors(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');

    try {
      if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

      const quoteId = norm(getRequestField(req, 'quoteId'));
      const emailOverride = norm(getRequestField(req, 'emailOverride'));
      const customMessage = norm(getRequestField(req, 'message'));
      if (!quoteId) return res.status(400).send('Missing quoteId');

      const quoteRef = db.collection('quotes').doc(quoteId);
      const quoteSnap = await quoteRef.get();
      if (!quoteSnap.exists) return res.status(404).send(`Quote not found: ${quoteId}`);
      const quote = quoteSnap.data() || {};

      const targetEmail = emailOverride || norm(quote?.clientSnapshot?.email);
      if (!targetEmail || !targetEmail.includes('@')) {
        return res.status(400).send('Quote has no valid client email');
      }

      const approvalToken = quote.approvalToken || makeToken();
      const approvalUrl = buildQuoteApprovalPortalUrl(quoteId, approvalToken);

      await quoteRef.update({
        status: 'sent',
        approvalToken,
        approvalUrl,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSentToEmail: targetEmail,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (quote.sourceLeadId) {
        await db.collection('leads').doc(quote.sourceLeadId).set(
          {
            status: 'quoted',
            quoteId,
            quoteNumber: quote.quoteNumber || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      const subject = `Quote ${quote.quoteNumber || ''}${quote?.clientSnapshot?.companyName ? ` — ${quote.clientSnapshot.companyName}` : ''}`;
      const html = renderClientFacingQuoteHtml(quote, approvalUrl, customMessage);
      const text = renderClientFacingQuoteText(quote, approvalUrl, customMessage);

      const transporter = makeTransporter();
      const bcc = parseEmailList(MGMT_EMAIL.value());
      const info = await transporter.sendMail({
        from: `"Work Manager" <${GMAIL_USER.value()}>`,
        to: targetEmail,
        bcc: bcc.length ? bcc : undefined,
        subject,
        html,
        text,
      });

      console.log('sendQuoteApprovalEmail sent', quoteId, info.messageId);
      res.status(200).json({
        ok: true,
        messageId: info.messageId,
        approvalUrl,
        sentTo: targetEmail,
      });
    } catch (err) {
      console.error('sendQuoteApprovalEmail error', err);
      res.status(500).send(err?.message || String(err));
    }
  }
);

// ------------------------------------------------------------------
// SECURE QUOTE APPROVAL PORTAL — public HTML + server-side updates
// ------------------------------------------------------------------
exports.quoteApprovalPortal = onRequest(
  { region, secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, MGMT_EMAIL] },
  async (req, res) => {
    applyCors(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');

    try {
      const quoteId = norm(getRequestField(req, 'quoteId'));
      const token = norm(getRequestField(req, 'token'));
      if (!quoteId || !token) return res.status(400).send('Missing quoteId or token');

      const quoteRef = db.collection('quotes').doc(quoteId);
      const quoteSnap = await quoteRef.get();
      if (!quoteSnap.exists) return res.status(404).send('Quote not found');
      const quote = { id: quoteSnap.id, ...(quoteSnap.data() || {}) };

      if (!quote.approvalToken || quote.approvalToken !== token) {
        return res.status(403).send('This approval link is invalid or has expired.');
      }

      if (req.method === 'GET') {
        return res.status(200).send(renderQuotePortalPage({
          quote,
          quoteId,
          token,
          statusMessage: quote.clientResponse
            ? `Current response recorded: <strong>${esc(String(quote.clientResponse).replace(/_/g, ' '))}</strong>. You can submit a new response below if needed.`
            : '',
          severity: 'info',
        }));
      }

      if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

      const action = norm(getRequestField(req, 'action'));
      const message = norm(getRequestField(req, 'message'));
      if (!['approve', 'changes', 'reject'].includes(action)) return res.status(400).send('Invalid action');

      let banner = '';
      let severity = 'success';
      let createdOrderNumber = '';

      if (action === 'approve') {
        await quoteRef.update({
          status: 'accepted',
          clientResponse: 'approved',
          clientResponseMessage: message || '',
          clientRespondedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const { orderNumber } = await createOrderFromQuoteIfMissing(quoteId);
        createdOrderNumber = orderNumber || '';

        await createNotification({
          type: 'quote_response',
          title: `Quote ${quote.quoteNumber || ''} accepted`,
          body: `${quote?.clientSnapshot?.companyName || quote?.clientSnapshot?.contactName || 'Client'} approved the quote.`,
          quoteId,
          quoteNumber: quote.quoteNumber || '',
          orderNumber: createdOrderNumber,
          leadId: quote.sourceLeadId || '',
          clientName: quote?.clientSnapshot?.companyName || quote?.clientSnapshot?.contactName || '',
          response: 'accepted',
        });

        banner = `Thanks — your quote has been <strong>approved</strong>.`;
        if (createdOrderNumber) banner += ` Your order has been created (${esc(createdOrderNumber)}).`;
      }

      if (action === 'changes') {
        await quoteRef.update({
          status: 'changes_requested',
          clientResponse: 'changes_requested',
          clientResponseMessage: message || '',
          clientRespondedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (quote.sourceLeadId) {
          await db.collection('leads').doc(quote.sourceLeadId).set(
            { status: 'quoting', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
        }

        await createNotification({
          type: 'quote_response',
          title: `Quote ${quote.quoteNumber || ''} needs changes`,
          body: `${quote?.clientSnapshot?.companyName || quote?.clientSnapshot?.contactName || 'Client'} requested quote changes.`,
          quoteId,
          quoteNumber: quote.quoteNumber || '',
          leadId: quote.sourceLeadId || '',
          clientName: quote?.clientSnapshot?.companyName || quote?.clientSnapshot?.contactName || '',
          response: 'changes_requested',
        });

        banner = 'Your change request has been sent. We will review it and get back to you.';
      }

      if (action === 'reject') {
        await quoteRef.update({
          status: 'rejected',
          clientResponse: 'rejected',
          clientResponseMessage: message || '',
          clientRespondedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (quote.sourceLeadId) {
          await db.collection('leads').doc(quote.sourceLeadId).set(
            { status: 'lost', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
        }

        await createNotification({
          type: 'quote_response',
          title: `Quote ${quote.quoteNumber || ''} rejected`,
          body: `${quote?.clientSnapshot?.companyName || quote?.clientSnapshot?.contactName || 'Client'} rejected the quote.`,
          quoteId,
          quoteNumber: quote.quoteNumber || '',
          leadId: quote.sourceLeadId || '',
          clientName: quote?.clientSnapshot?.companyName || quote?.clientSnapshot?.contactName || '',
          response: 'rejected',
        });

        banner = 'This quote has been marked as rejected.';
        severity = 'error';
      }

      await notifyManagementOfQuoteResponse({
        quote,
        action,
        message,
        orderNumber: createdOrderNumber,
      }).catch((e) => console.warn('notifyManagementOfQuoteResponse warning', e?.message || e));

      const latestSnap = await quoteRef.get();
      const latestQuote = { id: latestSnap.id, ...(latestSnap.data() || {}) };

      res.status(200).send(renderQuotePortalPage({
        quote: latestQuote,
        quoteId,
        token,
        statusMessage: banner,
        severity,
      }));
    } catch (err) {
      console.error('quoteApprovalPortal error', err);
      res.status(500).send(err?.message || String(err));
    }
  }
);

// ------------------------------------------------------------------
// ORDER PROOF EMAIL SEND — secure email + proof portal
// ------------------------------------------------------------------
exports.sendOrderProofEmail = onRequest(
  { region, secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, MGMT_EMAIL] },
  async (req, res) => {
    applyCors(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');

    try {
      if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

      const orderId = norm(getRequestField(req, 'orderId'));
      const emailOverride = norm(getRequestField(req, 'emailOverride'));
      const customMessage = norm(getRequestField(req, 'message'));
      const senderName = norm(getRequestField(req, 'senderName'));

      if (!orderId) return res.status(400).send('Missing orderId');

      const orderRef = db.collection('orders').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) return res.status(404).send(`Order not found: ${orderId}`);
      const order = { id: orderSnap.id, ...(orderSnap.data() || {}) };

      const targetEmail = emailOverride || norm(order?.clientSnapshot?.email);
      if (!targetEmail || !targetEmail.includes('@')) {
        return res.status(400).send('Order has no valid client email');
      }

      const filesSnap = await orderRef.collection('files').get();
      const proofAttachments = filesSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() || {}) }))
        .filter((f) => String(f.category || '').toLowerCase() === 'proof' && f.url);

      if (!proofAttachments.length) {
        return res.status(400).send('No proof files found on this order. Upload at least one file in category "Proof".');
      }

      const proofRef = orderRef.collection('proofs').doc();
      const approvalToken = makeToken();
      const portalUrl = buildOrderProofPortalUrl(orderId, proofRef.id, approvalToken);

      const proofDoc = {
        status: 'sent',
        message: customMessage || '',
        recipientEmail: targetEmail,
        sentByName: senderName || '',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        approvalToken,
        approvalUrl: portalUrl,
        attachments: proofAttachments.map((f) => ({
          name: f.name || 'Proof file',
          url: f.url,
          contentType: f.contentType || '',
          size: f.size || 0,
          fileId: f.id,
        })),
        clientResponseMessage: '',
        clientRespondedAt: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await proofRef.set(proofDoc);

      await orderRef.update({
        artworkApprovalStatus: 'sent',
        latestProofId: proofRef.id,
        latestProofStatus: 'sent',
        latestProofSentAt: admin.firestore.FieldValue.serverTimestamp(),
        latestProofSentToEmail: targetEmail,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const transporter = makeTransporter();
      const bcc = parseEmailList(MGMT_EMAIL.value());
      const html = renderOrderProofEmailHtml(order, { ...proofDoc, attachments: proofDoc.attachments }, portalUrl, customMessage);
      const text = renderOrderProofEmailText(order, { ...proofDoc, attachments: proofDoc.attachments }, portalUrl, customMessage);

      const info = await transporter.sendMail({
        from: `"Work Manager" <${GMAIL_USER.value()}>`,
        to: targetEmail,
        bcc: bcc.length ? bcc : undefined,
        subject: `Artwork proof — ${order.orderNumber || ''}`,
        html,
        text,
      });

      console.log('sendOrderProofEmail sent', orderId, info.messageId);

      res.status(200).json({
        ok: true,
        messageId: info.messageId,
        proofId: proofRef.id,
        portalUrl,
        sentTo: targetEmail,
      });
    } catch (err) {
      console.error('sendOrderProofEmail error', err);
      res.status(500).send(err?.message || String(err));
    }
  }
);

// ------------------------------------------------------------------
// ORDER PROOF APPROVAL PORTAL — public HTML + server-side updates
// ------------------------------------------------------------------
exports.orderProofApprovalPortal = onRequest(
  { region, secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, MGMT_EMAIL] },
  async (req, res) => {
    applyCors(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');

    try {
      const orderId = norm(getRequestField(req, 'orderId'));
      const proofId = norm(getRequestField(req, 'proofId'));
      const token = norm(getRequestField(req, 'token'));

      if (!orderId || !proofId || !token) {
        return res.status(400).send('Missing orderId, proofId or token');
      }

      const orderRef = db.collection('orders').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) return res.status(404).send('Order not found');
      const order = { id: orderSnap.id, ...(orderSnap.data() || {}) };

      const proofRef = orderRef.collection('proofs').doc(proofId);
      const proofSnap = await proofRef.get();
      if (!proofSnap.exists) return res.status(404).send('Proof not found');
      const proof = { id: proofSnap.id, ...(proofSnap.data() || {}) };

      if (!proof.approvalToken || proof.approvalToken !== token) {
        return res.status(403).send('This proof approval link is invalid or has expired.');
      }

      if (req.method === 'GET') {
        return res.status(200).send(renderOrderProofPortalPage({
          order,
          proof,
          orderId,
          proofId,
          token,
          statusMessage: proof.status && proof.status !== 'sent'
            ? `Current response recorded: <strong>${esc(renderProofStatusChipLabel(proof.status))}</strong>.`
            : '',
          severity: proof.status === 'approved' ? 'success' : proof.status === 'changes_requested' ? 'error' : 'info',
        }));
      }

      if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

      const action = norm(getRequestField(req, 'action'));
      const message = norm(getRequestField(req, 'message'));
      if (!['approve', 'changes'].includes(action)) return res.status(400).send('Invalid action');

      let banner = '';
      let severity = 'success';

      if (action === 'approve') {
        await proofRef.update({
          status: 'approved',
          clientResponseMessage: message || '',
          clientRespondedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await orderRef.update({
          artworkApprovalStatus: 'approved',
          latestProofId: proofId,
          latestProofStatus: 'approved',
          latestProofMessage: message || '',
          artworkApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await createNotification({
          type: 'proof_response',
          title: `Artwork proof approved — ${order.orderNumber || ''}`,
          body: `${order?.clientSnapshot?.companyName || order?.clientSnapshot?.contactName || 'Client'} approved the artwork proof.`,
          orderId,
          orderNumber: order.orderNumber || '',
          quoteNumber: order.quoteNumber || '',
          clientName: order?.clientSnapshot?.companyName || order?.clientSnapshot?.contactName || '',
          response: 'approved',
        });

        banner = 'Thanks — the artwork proof has been <strong>approved</strong>.';
      }

      if (action === 'changes') {
        await proofRef.update({
          status: 'changes_requested',
          clientResponseMessage: message || '',
          clientRespondedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await orderRef.update({
          artworkApprovalStatus: 'changes_requested',
          latestProofId: proofId,
          latestProofStatus: 'changes_requested',
          latestProofMessage: message || '',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await createNotification({
          type: 'proof_response',
          title: `Artwork proof changes requested — ${order.orderNumber || ''}`,
          body: `${order?.clientSnapshot?.companyName || order?.clientSnapshot?.contactName || 'Client'} requested artwork changes.`,
          orderId,
          orderNumber: order.orderNumber || '',
          quoteNumber: order.quoteNumber || '',
          clientName: order?.clientSnapshot?.companyName || order?.clientSnapshot?.contactName || '',
          response: 'changes_requested',
        });

        banner = 'Your change request has been sent. We will review the artwork and get back to you.';
        severity = 'error';
      }

      await notifyManagementOfProofResponse({
        order,
        proof,
        action,
        message,
      }).catch((e) => console.warn('notifyManagementOfProofResponse warning', e?.message || e));

      const latestOrderSnap = await orderRef.get();
      const latestOrder = { id: latestOrderSnap.id, ...(latestOrderSnap.data() || {}) };
      const latestProofSnap = await proofRef.get();
      const latestProof = { id: latestProofSnap.id, ...(latestProofSnap.data() || {}) };

      res.status(200).send(renderOrderProofPortalPage({
        order: latestOrder,
        proof: latestProof,
        orderId,
        proofId,
        token,
        statusMessage: banner,
        severity,
      }));
    } catch (err) {
      console.error('orderProofApprovalPortal error', err);
      res.status(500).send(err?.message || String(err));
    }
  }
);


// ------------------------------------------------------------------
// CREATE WORK MANAGER USER — callable
// ------------------------------------------------------------------
exports.createWorkManagerUser = onCall(
  { region },
  async (request) => {
    const requesterUid = request.auth?.uid;
    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const requesterSnap = await db.collection('users').doc(requesterUid).get();
    if (!requesterSnap.exists) {
      throw new HttpsError('permission-denied', 'Your user profile was not found.');
    }

    const requester = requesterSnap.data() || {};
    if (!['manager', 'admin'].includes(String(requester.role || '').toLowerCase())) {
      throw new HttpsError('permission-denied', 'Only managers can add users.');
    }

    const data = request.data || {};

    const displayName = norm(data.displayName);
    const shortName = norm(data.shortName);
    const email = norm(data.email).toLowerCase();
    const phone = norm(data.phone);
    const role = ['staff', 'manager', 'admin'].includes(norm(data.role).toLowerCase())
      ? norm(data.role).toLowerCase()
      : 'staff';
    const active = data.active !== false;

    if (!displayName) {
      throw new HttpsError('invalid-argument', 'Display name is required.');
    }

    if (!shortName) {
      throw new HttpsError('invalid-argument', 'Short name is required.');
    }

    if (!email || !email.includes('@')) {
      throw new HttpsError('invalid-argument', 'A valid email is required.');
    }

    const shortNameLower = shortName.toLowerCase();

    const allUsersSnap = await db.collection('users').get();
    const shortNameTaken = allUsersSnap.docs.some((docSnap) => {
      const user = docSnap.data() || {};
      return String(user.shortName || '').trim().toLowerCase() === shortNameLower;
    });

    if (shortNameTaken) {
      throw new HttpsError('already-exists', 'Short name already exists.');
    }

    try {
      await admin.auth().getUserByEmail(email);
      throw new HttpsError('already-exists', 'A user with this email already exists.');
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      if (err.code !== 'auth/user-not-found') {
        console.error('Error checking existing auth user:', err);
        throw new HttpsError('internal', 'Failed checking existing user.');
      }
    }

    const tempPassword = makeTempPassword();

    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email,
        password: tempPassword,
        displayName,
        disabled: !active,
      });
    } catch (err) {
      console.error('Error creating auth user:', err);
      throw new HttpsError('internal', err?.message || 'Failed creating auth user.');
    }

    const profile = {
      uid: userRecord.uid,
      email,
      displayName,
      shortName,
      shortNameLower,
      phone,
      role,
      active,
      photoURL: '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: requesterUid,
    };

    try {
      await db.collection('users').doc(userRecord.uid).set(profile, { merge: true });
    } catch (err) {
      console.error('Error creating Firestore user profile:', err);
      throw new HttpsError('internal', 'Auth user created but Firestore profile failed.');
    }

    let resetLink = '';
    try {
      resetLink = await admin.auth().generatePasswordResetLink(email);
    } catch (err) {
      console.error('Error generating password reset link:', err);
    }

    return {
      ok: true,
      uid: userRecord.uid,
      email,
      resetLink,
    };
  }
);
// ------------------------------------------------------------------
// HTTPS test endpoint
// ------------------------------------------------------------------
exports.sendTestEmail = onRequest(
  { region, secrets: [MAIL_TEST_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, MGMT_EMAIL] },
  async (req, res) => {
    if (req.query.key !== MAIL_TEST_KEY.value()) return res.status(401).send('Unauthorized');

    const transporter = makeTransporter();
    const info = await transporter.sendMail({
      from: `"Install Scheduler" <${GMAIL_USER.value()}>`,
      to: (req.query.to || MGMT_EMAIL.value()),
      subject: 'Test: Install Scheduler mail pipeline',
      text: 'This is a test from Cloud Functions via Gmail SMTP.',
    });

    res.status(200).send(`Sent: ${info.messageId}`);
  }
);

// ------------------------------------------------------------------
// Optional one-off repair endpoint (stub)
// ------------------------------------------------------------------
exports.repairDownloadUrls = onRequest(async (req, res) => {
  res.send({ ok: true, message: 'Not changed in this snippet' });
});
exports.parseLeadEmailOnUpload = require('./leadEmailParser').parseLeadEmailOnUpload;

const { generateOrderTasksOnCreate } = require('./orderTaskGeneration');
exports.generateOrderTasksOnCreate = generateOrderTasksOnCreate;