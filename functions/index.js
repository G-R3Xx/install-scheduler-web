// functions/index.js

// ---- Firebase Functions v2 ----
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

// ---- Admin / SendGrid ----
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

// Initialize Admin (use your default bucket)
admin.initializeApp({ storageBucket: 'install-scheduler.appspot.com' });
const db = admin.firestore();

// Secret set with: firebase functions:secrets:set SENDGRID_API_KEY
const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');

// ---- Helpers ----
const lower = (s) => (s || '').toString().toLowerCase().trim();
const esc = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

// Safe HTTP fetch for binary buffers with timeout
const fetch = require('node-fetch'); // v2
async function safeFetchBuf(url, ms = 15000) {
  if (!url) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    return { buf, contentType: ct };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function pickExtFromContentType(ct = '') {
  const type = ct.split(';')[0].trim().toLowerCase();
  if (type === 'image/png') return { ext: 'png', type };
  if (type === 'image/webp') return { ext: 'webp', type };
  if (type === 'image/gif') return { ext: 'gif', type };
  if (type === 'image/bmp') return { ext: 'bmp', type };
  if (type === 'image/tiff') return { ext: 'tiff', type };
  // default jpeg
  return { ext: 'jpg', type: type || 'image/jpeg' };
}

// --------------------------------------------------------------------
// Completed Job email (HTML + image & signature attachments)
// --------------------------------------------------------------------
async function sendCompletionEmail({ jobId, job, toOverride, keyVal }) {
  sgMail.setApiKey(keyVal);

  const toAddress = toOverride || process.env.SENDGRID_TO || 'printroom@tenderedge.com.au';
  const fromAddress = process.env.SENDGRID_FROM || 'printroom@tenderedge.com.au';

  // Build user map
  const usersSnap = await db.collection('users').get();
  const userMap = {};
  usersSnap.forEach((d) => {
    const u = d.data() || {};
    userMap[d.id] = u.shortName || u.displayName || u.email || d.id;
  });

  const clientName  = job.clientName || job.company || 'Unknown Client';
  const address     = job.address || 'No address supplied';
  const description = job.description || '';

  let installDateStr = 'N/A';
  try {
    const d = job.installDate?.toDate?.()
      ? job.installDate.toDate()
      : (job.installDate instanceof Date ? job.installDate : null);
    if (d) installDateStr = d.toLocaleString();
  } catch (_) {}

  const assignedIds = Array.isArray(job.assignedTo)
    ? job.assignedTo
    : (job.assignedTo ? [job.assignedTo] : []);
  const assignedNames = assignedIds.map((id) => userMap[id] || id);

  // Hours table
  const timeEntriesSnap = await db.collection('jobs').doc(jobId).collection('timeEntries').get();
  const perUser = {};
  let grandTotal = 0;
  timeEntriesSnap.forEach((d) => {
    const e = d.data() || {};
    const h = Number(e.hours || 0);
    const uid = e.userId || 'unknown';
    if (!isNaN(h) && h > 0) {
      perUser[uid] = (perUser[uid] || 0) + h;
      grandTotal += h;
    }
  });

  let breakdownRows = '';
  Object.entries(perUser).forEach(([uid, hrs]) => {
    breakdownRows += `
      <tr>
        <td style="padding:6px 10px;border:1px solid #ddd;">${esc(userMap[uid] || uid)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${hrs} hrs</td>
      </tr>`;
  });
  if (!breakdownRows) {
    breakdownRows = `<tr><td colspan="2" style="padding:6px 10px;border:1px solid #ddd;">No hours logged</td></tr>`;
  }

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:760px;margin:0 auto;background:#fff;border:1px solid #eaeaea;border-radius:10px;overflow:hidden;">
    <div style="background:#d6d2d5;padding:20px;text-align:center;">
      <img src="https://tenderedge.com.au/images/logo-2019.png" alt="Company Logo" style="max-height:60px;">
    </div>
    <div style="padding:20px;">
      <h2 style="color:#004aad;margin-top:0;">Job Completed — ${esc(clientName)}</h2>
      <p><strong>Address:</strong> ${esc(address)}</p>
      <p><strong>Install Date:</strong> ${esc(installDateStr)}</p>
      <p><strong>Assigned:</strong> ${esc(assignedNames.join(', ') || 'None')}</p>
      <p><strong>Description:</strong><br/>${esc(description) || '—'}</p>

      <h3 style="margin-top:20px;">Hours Breakdown</h3>
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:600px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 10px;border:1px solid #ddd;background:#f6f8fa;">User</th>
            <th style="text-align:right;padding:6px 10px;border:1px solid #ddd;background:#f6f8fa;">Hours</th>
          </tr>
        </thead>
        <tbody>
          ${breakdownRows}
          <tr>
            <td style="padding:6px 10px;border:1px solid #ddd;font-weight:bold;">Total</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-weight:bold;">${grandTotal} hrs</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  `;

  // Attach completed photos + signature (with size limits)
  const completedPhotos = Array.isArray(job.completedPhotos) ? job.completedPhotos : [];
  const signatureUrl = job.signatureURL || job.signatureUrl || null;

  const attachments = [];
  let totalBytes = 0;
  const MAX_TOTAL = 20 * 1024 * 1024; // ~20MB total to be safe
  const MAX_EACH  = 6 * 1024 * 1024;  // ~6MB per image

  const pushAttachment = (filename, payload) => {
    if (!payload) return;
    const { buf, contentType } = payload;
    if (!buf || !buf.length) return;
    if (buf.length > MAX_EACH) return;
    if (totalBytes + buf.length > MAX_TOTAL) return;
    const { type } = pickExtFromContentType(contentType);
    attachments.push({
      filename,
      content: buf.toString('base64'),
      type: type || 'application/octet-stream',
      disposition: 'attachment',
    });
    totalBytes += buf.length;
  };

  for (let i = 0; i < completedPhotos.length; i++) {
    const url = completedPhotos[i];
    const payload = await safeFetchBuf(url);
    const { ext } = pickExtFromContentType(payload?.contentType);
    pushAttachment(`completed-${i + 1}.${ext}`, payload);
  }

  if (signatureUrl) {
    const payload = await safeFetchBuf(signatureUrl);
    const { ext } = pickExtFromContentType(payload?.contentType);
    pushAttachment(`signature.${ext}`, payload);
  }

  await sgMail.send({
    to: toAddress,
    from: fromAddress,
    subject: `Job Completed — ${clientName}`,
    html,
    attachments,
  });

  console.log('✅ Completion email sent', {
    jobId,
    toAddress,
    photos: completedPhotos.length,
    hasSignature: !!signatureUrl,
    attachments: attachments.length
  });
}

// --------------------------------------------------------------------
// Firestore trigger: send completion email once status becomes complete
// --------------------------------------------------------------------
exports.sendJobCompletedEmail = onDocumentWritten(
  { document: 'jobs/{jobId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const jobId = event.params.jobId;
    const before = event.data.before.exists ? (event.data.before.data() || {}) : null;
    const after  = event.data.after.exists  ? (event.data.after.data()  || {}) : null;

    const beforeStatus = before ? lower(before.status) : null;
    const afterStatus  = after  ? lower(after.status)  : null;

    const isNowCompleted = after && (afterStatus === 'complete' || afterStatus === 'completed');
    if (!isNowCompleted) return;

    const wasCompleted = before && (beforeStatus === 'complete' || beforeStatus === 'completed');
    if (wasCompleted) return;

    try {
      await sendCompletionEmail({
        jobId,
        job: after,
        keyVal: SENDGRID_API_KEY.value(),
      });
    } catch (err) {
      console.error('❌ sendJobCompletedEmail failed', err);
    }
  }
);

// --------------------------------------------------------------------
// HTTPS: Test SendGrid
// --------------------------------------------------------------------
exports.testSendgridMail = onRequest(
  { secrets: [SENDGRID_API_KEY] },
  async (_req, res) => {
    try {
      sgMail.setApiKey(SENDGRID_API_KEY.value());
      const to = process.env.SENDGRID_TO || 'printroom@tenderedge.com.au';
      const from = process.env.SENDGRID_FROM || 'printroom@tenderedge.com.au';
      await sgMail.send({
        to,
        from,
        subject: '🔥 Test Email from Firebase',
        html: '<h2>SendGrid works</h2>',
      });
      res.send(`✅ Test email sent to ${to}`);
    } catch (err) {
      res.status(500).send(`❌ Failed: ${err.message}`);
    }
  }
);

// --------------------------------------------------------------------
// HTTPS: "sendSurveyPdf" (kept name) — now sends a styled HTML email
//        and attaches survey images (signs + reference) instead of PDF.
// --------------------------------------------------------------------
exports.sendSurveyPdf = onRequest(
  {
    secrets: [SENDGRID_API_KEY],
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (req, res) => {
    // ---- CORS FIRST ----
    const origin = req.get('origin') || '';
    const ALLOWED_ORIGINS = [
      'https://install-scheduler.web.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
    const allowOrigin = ALLOWED_ORIGINS.includes(origin)
      ? origin
      : 'https://install-scheduler.web.app';
    res.set('Access-Control-Allow-Origin', allowOrigin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');

    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST')  return res.status(405).send('Use POST');

    try {
      const { surveyId, to: toOverride } = req.body || {};
      if (!surveyId) return res.status(400).send('Missing surveyId');

      // Load survey
      const snap = await db.collection('jobs').doc(String(surveyId)).get();
      if (!snap.exists) return res.status(404).send('Survey not found');

      const survey = snap.data() || {};
      if ((survey.jobType || 'survey') !== 'survey') {
        return res.status(400).send('Document is not a survey');
      }

      // Configure SendGrid
      sgMail.setApiKey(SENDGRID_API_KEY.value());
      const to   = toOverride || process.env.SENDGRID_TO   || 'printroom@tenderedge.com.au';
      const from =              process.env.SENDGRID_FROM || 'printroom@tenderedge.com.au';

      // Normalize arrays
      const signs = Array.isArray(survey.signs) ? survey.signs : [];
      const referencePhotos = Array.isArray(survey.referencePhotos) ? survey.referencePhotos : [];

      // Build a neat HTML summary (no embedded images, just info)
      const clientName = survey.clientName || survey.client || 'Untitled';
      const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:760px;margin:0 auto;background:#fff;border:1px solid #eaeaea;border-radius:10px;overflow:hidden;">
        <div style="background:#0E2A47;padding:16px 20px;color:#fff;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-weight:700;font-size:16px;letter-spacing:.3px;">SITE SURVEY</div>
            <div style="font-size:12px;opacity:.9;">${new Date().toLocaleString()}</div>
          </div>
          <div style="background:#0b2240;padding:4px 10px;border-radius:999px;font-size:12px;border:1px solid rgba(255,255,255,.2);">
            Survey ID: ${surveyId}
          </div>
        </div>

        <div style="padding:20px;">
          <h2 style="margin:0 0 10px;color:#111827;">${esc(clientName)}</h2>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;max-width:620px;font-size:14px;">
            <div><strong>Company:</strong> ${esc(survey.company || '')}</div>
            <div><strong>Contact:</strong> ${esc(survey.contact || '')}</div>
            <div><strong>Phone:</strong> ${esc(survey.phone || '')}</div>
            <div><strong>Email:</strong> ${esc(survey.email || '')}</div>
            <div style="grid-column:1 / -1;"><strong>Address:</strong> ${esc(survey.address || '')}</div>
          </div>

          ${
            survey.description
              ? `<div style="margin-top:14px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;">
                   <div style="font-weight:600;margin-bottom:6px;">Survey Notes</div>
                   <div style="white-space:pre-wrap;">${esc(survey.description || '')}</div>
                 </div>`
              : ''
          }

          <div style="margin-top:18px;">
            <div style="font-weight:700;margin-bottom:8px;">Signs</div>
            ${
              signs.length
                ? `<ol style="margin:0 0 0 18px;padding:0;">
                     ${signs.map((s, idx) => {
                       const name = s?.name || `Sign ${idx + 1}`;
                       const desc = s?.description ? ` — ${esc(s.description)}` : '';
                       return `<li style="margin:3px 0;">${esc(name)}${desc}</li>`;
                     }).join('')}
                   </ol>`
                : '<div style="color:#6b7280;">No signs captured.</div>'
            }
          </div>

          <div style="margin-top:16px;">
            <div style="font-weight:700;margin-bottom:8px;">Reference Photos</div>
            <div style="font-size:14px;color:#6b7280;">
              ${referencePhotos.length ? `${referencePhotos.length} photo(s) attached below.` : 'No reference photos.'}
            </div>
          </div>

          <hr style="margin:22px 0;border:none;border-top:1px solid #eee;">
          <div style="text-align:center;color:#6b7280;font-size:12px;">Survey ID: ${surveyId}</div>
        </div>
      </div>`;

      // Build attachments for signs (annotated first) and reference photos
      const attachments = [];
      let totalBytes = 0;
      const MAX_TOTAL = 20 * 1024 * 1024; // ~20MB
      const MAX_EACH  = 6 * 1024 * 1024;  // ~6MB

      const pushAttachment = (filename, payload) => {
        if (!payload) return;
        const { buf, contentType } = payload;
        if (!buf || !buf.length) return;
        if (buf.length > MAX_EACH) return;
        if (totalBytes + buf.length > MAX_TOTAL) return;
        const { type } = pickExtFromContentType(contentType);
        attachments.push({
          filename,
          content: buf.toString('base64'),
          type: type || 'application/octet-stream',
          disposition: 'attachment',
        });
        totalBytes += buf.length;
      };

      // Signs
      for (let i = 0; i < signs.length; i++) {
        const s = signs[i] || {};
        const imgUrl = s.annotatedImageUrl || s.originalImageUrl || '';
        if (!imgUrl) continue;
        const payload = await safeFetchBuf(imgUrl);
        const { ext } = pickExtFromContentType(payload?.contentType);
        pushAttachment(`sign-${i + 1}.${ext}`, payload);
      }

      // Reference photos
      for (let i = 0; i < referencePhotos.length; i++) {
        const url = referencePhotos[i];
        const payload = await safeFetchBuf(url);
        const { ext } = pickExtFromContentType(payload?.contentType);
        pushAttachment(`reference-${i + 1}.${ext}`, payload);
      }

      await sgMail.send({
        to,
        from,
        subject: `Site Survey — ${clientName}`,
        html,
        attachments,
      });

      console.log('✅ Survey email sent (HTML + attachments)', {
        surveyId,
        signs: signs.length,
        refs: referencePhotos.length,
        attachments: attachments.length,
      });
      return res.status(200).send('OK');
    } catch (err) {
      console.error('❌ sendSurveyPdf failed', {
        message: err?.message, code: err?.code, body: err?.response?.body
      });
      const details =
        err?.response?.body?.errors?.map((e) => e.message).join('; ') ||
        err?.message || 'Unknown error';
      return res.status(500).send(`Failed: ${details}`);
    }
  }
);
