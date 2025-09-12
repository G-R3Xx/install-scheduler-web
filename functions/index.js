// functions/index.js

// ---- Firebase Functions v2 ----
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

// ---- Admin / SendGrid / Fetch ----
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const fetch = require('node-fetch'); // v2

// Initialize Admin
admin.initializeApp({ storageBucket: 'install-scheduler.appspot.com' });
const db = admin.firestore();

// Secrets
// set with: firebase functions:secrets:set SENDGRID_API_KEY
const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');

// --------------------------------------------------------------------
// Mail identity & preferences (to avoid "looks unsafe")
// --------------------------------------------------------------------
// Use a neutral "from" on your authenticated domain; keep your real inbox in replyTo
const FROM_ADDRESS = process.env.SENDGRID_FROM || 'no-reply@tenderedge.com.au';
const REPLY_TO = process.env.SENDGRID_REPLY_TO || 'printroom@tenderedge.com.au';
const TO_DEFAULT = process.env.SENDGRID_TO || 'printroom@tenderedge.com.au';

// Optional: disable SendGrid tracking until Link Branding (CNAME) is set up.
// Set SENDGRID_DISABLE_TRACKING=1 in your env to honor this.
const DISABLE_TRACKING =
  String(process.env.SENDGRID_DISABLE_TRACKING || '0').trim() === '1';

const baseMailSettings = DISABLE_TRACKING
  ? {
      clickTracking: { enable: false, enableText: false },
      openTracking: { enable: false },
    }
  : undefined;

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------
const lower = (s) => (s || '').toString().toLowerCase().trim();
const esc = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const bucket = admin.storage().bucket();
const isHttp = (u) => /^https?:\/\//i.test(u || '');
const isGs = (u) => /^gs:\/\//i.test(u || '');

// Convert gs:// or storage path to a signed URL; pass-through http(s) URLs
async function toHttpUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;

  // Extract object path from gs:// or accept a bare storage path
  let objectPath = pathOrUrl;
  if (isGs(objectPath)) {
    objectPath = objectPath.replace(/^gs:\/\/[^/]+\//i, '');
  }

  try {
    const [signed] = await bucket
      .file(objectPath)
      .getSignedUrl({ action: 'read', expires: Date.now() + 1000 * 60 * 60 * 24 }); // 24h
    return signed;
  } catch (err) {
    console.warn('Could not sign URL', { objectPath, err: err?.message });
    return null;
  }
}

async function normalizeMany(list) {
  const arr = Array.isArray(list) ? list : [];
  const resolved = await Promise.all(arr.map(toHttpUrl));
  return resolved.filter(Boolean);
}
async function normalizeOne(value) {
  const url = await toHttpUrl(value);
  return url || null;
}

// Fetch remote URL to Buffer (with timeout)
async function safeFetchBuf(url, ms = 15000) {
  if (!url) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// --------------------------------------------------------------------
// Job completion email (HTML only; keep your existing content/format)
// --------------------------------------------------------------------
async function sendCompletionEmail({ jobId, job, toOverride, keyVal }) {
  sgMail.setApiKey(keyVal);

  const toAddress = toOverride || TO_DEFAULT;

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

  await sgMail.send({
    to: toAddress,
    from: FROM_ADDRESS,
    replyTo: REPLY_TO,
    subject: `Job Completed — ${clientName}`,
    html,
    mailSettings: baseMailSettings,
  });

  console.log('✅ Completion email sent', { jobId, toAddress });
}

// --------------------------------------------------------------------
// Firestore trigger: send completion email
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
/** Manual resend endpoint
 * GET/POST .../resendCompletionEmail?jobId=ABC&to=me@x.com&force=true
 */
// --------------------------------------------------------------------
exports.resendCompletionEmail = onRequest(
  { secrets: [SENDGRID_API_KEY] },
  async (req, res) => {
    try {
      const jobId = (req.query.jobId || req.body?.jobId || '').toString().trim();
      const toOverride = (req.query.to || req.body?.to || '').toString().trim();
      const force = ((req.query.force || req.body?.force || '') + '').toLowerCase() === 'true';

      if (!jobId) return res.status(400).send('Missing jobId');

      const jobRef = db.collection('jobs').doc(jobId);
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) return res.status(404).send(`Job ${jobId} not found`);

      const job = jobSnap.data() || {};
      const status = lower(job.status);
      if (!force && status !== 'complete' && status !== 'completed') {
        return res.status(400).send(`Job status is "${status}". Append &force=true to override.`);
      }

      await sendCompletionEmail({
        jobId,
        job,
        toOverride,
        keyVal: SENDGRID_API_KEY.value(),
      });

      res.send(`✅ Resent completion email for job ${jobId}`);
    } catch (err) {
      console.error('❌ resendCompletionEmail failed', {
        message: err?.message, code: err?.code, body: err?.response?.body
      });
      const details =
        err?.response?.body?.errors?.map(e => e.message).join('; ')
        || err?.message || 'Unknown error';
      res.status(500).send(`❌ Failed: ${details}`);
    }
  }
);

// --------------------------------------------------------------------
// Test endpoint
// --------------------------------------------------------------------
exports.testSendgridMail = onRequest(
  { secrets: [SENDGRID_API_KEY] },
  async (_req, res) => {
    try {
      sgMail.setApiKey(SENDGRID_API_KEY.value());
      const to = TO_DEFAULT;
      await sgMail.send({
        to,
        from: FROM_ADDRESS,
        replyTo: REPLY_TO,
        subject: '🔥 Test Email from Firebase',
        html: '<h2>SendGrid works</h2>',
        mailSettings: baseMailSettings,
      });
      res.send(`✅ Test email sent to ${to}`);
    } catch (err) {
      res.status(500).send(`❌ Failed: ${err.message}`);
    }
  }
);

// --------------------------------------------------------------------
// Survey email endpoint (keeps your existing URL: /sendSurveyPdf)
// Sends a styled HTML email; attach sign/reference images if desired.
// --------------------------------------------------------------------
exports.sendSurveyPdf = onRequest(
  { secrets: [SENDGRID_API_KEY], region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    // ---- CORS ----
    const origin = req.get('origin') || '';
    const ALLOWED_ORIGINS = [
      'https://install-scheduler.web.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://install-scheduler.web.app';
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

      // Load survey doc (stored in jobs with jobType === 'survey')
      const snap = await db.collection('jobs').doc(String(surveyId)).get();
      if (!snap.exists) return res.status(404).send('Survey not found');

      const survey = snap.data() || {};
      if ((survey.jobType || 'survey') !== 'survey') {
        return res.status(400).send('Document is not a survey');
      }

      // SendGrid
      sgMail.setApiKey(SENDGRID_API_KEY.value());
      const to   = toOverride || TO_DEFAULT;

      // Build HTML summary (clean & simple)
      const client = survey.clientName || survey.client || '';
      const html = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width:760px; margin:0 auto;">
          <div style="background:#0E2A47;color:#fff;padding:14px 18px;border-radius:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <div>
                <div style="font-weight:700;font-size:16px;letter-spacing:.2px;">SITE SURVEY</div>
                <div style="opacity:.9;font-size:12px;margin-top:2px;">Survey ID: ${surveyId}</div>
              </div>
              <img src="https://tenderedge.com.au/images/logo-2019.png" alt="Logo" style="height:28px;">
            </div>
          </div>

          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-top:12px;overflow:hidden;">
            <div style="padding:16px 18px;">
              <h2 style="margin:0 0 8px 0;font-size:18px;color:#0E2A47;">${esc(client || 'Untitled')}</h2>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:13px;color:#111;">
                <div><strong>Company:</strong> ${esc(survey.company || '—')}</div>
                <div><strong>Contact:</strong> ${esc(survey.contact || '—')}</div>
                <div><strong>Phone:</strong> ${esc(survey.phone || '—')}</div>
                <div><strong>Email:</strong> ${esc(survey.email || '—')}</div>
                <div style="grid-column:1 / -1;"><strong>Address:</strong> ${esc(survey.address || '—')}</div>
              </div>
              ${survey.description ? `
                <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e5e7eb;">
                  <div style="font-weight:600;margin-bottom:4px;color:#374151;">Notes</div>
                  <div style="white-space:pre-wrap;color:#111;font-size:13px;">${esc(survey.description)}</div>
                </div>` : ''}
            </div>
          </div>

          <p style="color:#6b7280;font-size:12px;margin-top:10px;">
            Images are attached to this email (annotated signs first, then reference photos).
          </p>
        </div>
      `;

      // Build attachments (annotated signs then reference photos)
      const attachments = [];

      const signs = Array.isArray(survey.signs) ? survey.signs : [];
      for (let i = 0; i < signs.length; i++) {
        const s = signs[i] || {};
        const imgUrl = s.annotatedImageUrl || s.originalImageUrl || '';
        const buf = await safeFetchBuf(imgUrl);
        if (!buf) continue;
        attachments.push({
          content: buf.toString('base64'),
          filename: `sign_${(s.name || `Sign_${i+1}`).replace(/\s+/g, '_')}.jpg`,
          type: 'image/jpeg',
          disposition: 'attachment',
        });
      }

      const refs = Array.isArray(survey.referencePhotos) ? survey.referencePhotos : [];
      for (let i = 0; i < refs.length; i++) {
        const buf = await safeFetchBuf(refs[i]);
        if (!buf) continue;
        attachments.push({
          content: buf.toString('base64'),
          filename: `reference_${i+1}.jpg`,
          type: 'image/jpeg',
          disposition: 'attachment',
        });
      }

      // Send email
      await sgMail.send({
        to,
        from: FROM_ADDRESS,
        replyTo: REPLY_TO,
        subject: `Site Survey — ${client || surveyId}`,
        html,
        attachments: attachments.length ? attachments : undefined,
        mailSettings: baseMailSettings,
      });

      console.log('✅ Survey email sent', { surveyId, to, attachments: attachments.length });
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
