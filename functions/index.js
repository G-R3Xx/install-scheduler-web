// functions/index.js

// ---- Firebase Functions v2 ----
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

// ---- Admin / SendGrid ----
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

// Initialize Admin with your storage bucket so we can sign URLs
admin.initializeApp({ storageBucket: 'install-scheduler.appspot.com' });
const db = admin.firestore();

// Secret set with: firebase functions:secrets:set SENDGRID_API_KEY
const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');

// Helpers
const lower = (s) => (s || '').toString().toLowerCase().trim();
const esc = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

// ---------- Shared email sender ----------
async function sendCompletionEmail({ jobId, job, toOverride, keyVal }) {
  // Configure SendGrid
  sgMail.setApiKey(keyVal);

  // Addresses from env (set via --set-env-vars) with fallbacks
  const toAddress = toOverride || process.env.SENDGRID_TO || 'printroom@tenderedge.com.au';
  const fromAddress = process.env.SENDGRID_FROM || 'printroom@tenderedge.com.au'; // must be verified in SendGrid

  // Build user map
  const usersSnap = await db.collection('users').get();
  const userMap = {};
  usersSnap.forEach((d) => {
    const u = d.data() || {};
    userMap[d.id] = u.shortName || u.displayName || u.email || d.id;
  });

  // ---- Helpers to normalize image URLs (http, gs://, or bare storage paths) ----
  const bucket = admin.storage().bucket();
  const isHttp = (u) => /^https?:\/\//i.test(u || '');
  const isGs = (u) => /^gs:\/\//i.test(u || '');

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

  // ---- Extract job fields ----
  const clientName  = job.clientName || job.company || 'Unknown Client';
  const address     = job.address || 'No address supplied';
  const description = job.description || '';

  const completedPhotos = await normalizeMany(job.completedPhotos);
  const signatureUrl    = await normalizeOne(job.signatureURL || job.signatureUrl);

  console.log('Email image summary', {
    jobId,
    photos: completedPhotos.length,
    hasSignature: !!signatureUrl,
  });

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

  // Hours breakdown
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

  // Photos & signature sections
  let photosHtml = '';
  if (completedPhotos.length) {
    photosHtml += `<h3 style="margin-top:20px;">Completed Photos</h3><div>`;
    completedPhotos.forEach((url) => {
      photosHtml += `<img src="${url}" width="280" style="margin:6px;border:1px solid #ccc;border-radius:6px;max-width:100%;height:auto;display:inline-block;" />`;
    });
    photosHtml += `</div>`;
  }
  let sigHtml = '';
  if (signatureUrl) {
    sigHtml = `<h3 style="margin-top:20px;">Client Signature</h3>
      <img src="${signatureUrl}" width="280" style="border:1px solid #ccc;border-radius:6px;max-width:100%;height:auto;display:block;" />`;
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

      ${photosHtml}
      ${sigHtml}

      <hr style="margin:30px 0;border:none;border-top:1px solid #eee;">
      <p style="color:#888;font-size:12px;text-align:center;">Job ID: ${esc(jobId)}</p>
    </div>
  </div>
  `;

  await sgMail.send({
    to: toAddress,
    from: fromAddress,
    subject: `Job Completed — ${clientName}`,
    html,
  });

  console.log('✅ Completion email sent', {
    jobId,
    toAddress,
    fromAddress,
    photos: completedPhotos.length,
    hasSignature: !!signatureUrl,
  });
}

// ---------- Trigger: send when job becomes completed ----------
exports.sendJobCompletedEmail = onDocumentWritten(
  { document: 'jobs/{jobId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const jobId = event.params.jobId;

    const before = event.data.before.exists ? (event.data.before.data() || {}) : null;
    const after  = event.data.after.exists  ? (event.data.after.data()  || {}) : null;

    const beforeStatus = before ? lower(before.status) : null;
    const afterStatus  = after  ? lower(after.status)  : null;

    console.log('sendJobCompletedEmail fired', {
      jobId, hasBefore: !!before, hasAfter: !!after, beforeStatus, afterStatus
    });

    // Require transition to completed
    const isNowCompleted = after && (afterStatus === 'complete' || afterStatus === 'completed');
    if (!isNowCompleted) {
      console.log('Skip: not completed now', { jobId, afterStatus });
      return;
    }

    const wasCompleted = before && (beforeStatus === 'complete' || beforeStatus === 'completed');
    if (wasCompleted) {
      console.log('Skip: already completed before', { jobId, beforeStatus, afterStatus });
      return;
    }

    try {
      await sendCompletionEmail({
        jobId,
        job: after,
        keyVal: SENDGRID_API_KEY.value(),
      });
    } catch (err) {
      console.error('❌ sendJobCompletedEmail failed', {
        jobId, error: err?.message, code: err?.code, body: err?.response?.body
      });
    }
  }
);

// ---------- Manual test endpoint ----------
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
        subject: '🔥 Test Email from Firebase (v2 env)',
        html: '<h2>SendGrid works</h2><p>This is a test using v2 env vars.</p>',
      });
      res.send(`✅ Test email sent to ${to}`);
    } catch (err) {
      console.error('SendGrid test failed:', err);
      res.status(500).send(`❌ Failed: ${err.message}`);
    }
  }
);

// ---------- Manual resend endpoint ----------
// GET .../resendCompletionEmail?jobId=ABC&to=me@x.com&force=true
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
      const details = err?.response?.body?.errors?.map(e => e.message).join('; ')
        || err?.message || 'Unknown error';
      res.status(500).send(`❌ Failed: ${details}`);
    }
  }
);
