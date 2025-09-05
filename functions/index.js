// functions/index.js

// ---- Firebase Functions v2 ----
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

// ---- Admin / SendGrid / PDF / Fetch ----
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const PDFDocument = require('pdfkit');
const fetch = require('node-fetch'); // v2

// Initialize Admin
admin.initializeApp({ storageBucket: 'install-scheduler.appspot.com' });
const db = admin.firestore();

// Secrets
const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');

// Helpers
const lower = (s) => (s || '').toString().toLowerCase().trim();
const esc = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

// --------------------------------------------------------------------
// Job completion email (HTML only)
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
    from: fromAddress,
    subject: `Job Completed — ${clientName}`,
    html,
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
// Manual test endpoint
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
// Survey PDF + Email
// --------------------------------------------------------------------
exports.sendSurveyPdf = onRequest(
  { secrets: [SENDGRID_API_KEY], region: 'us-central1' },
  async (req, res) => {
    const origin = req.get('origin') || '';
    const ALLOWED_ORIGINS = [
      'https://install-scheduler.web.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
    if (ALLOWED_ORIGINS.includes(origin)) res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).send('Use POST');

    try {
      const { surveyId, to: toOverride } = req.body || {};
      if (!surveyId) return res.status(400).send('Missing surveyId');

      const snap = await db.collection('jobs').doc(String(surveyId)).get();
      if (!snap.exists) return res.status(404).send('Survey not found');

      const survey = snap.data() || {};
      if ((survey.jobType || 'survey') !== 'survey') {
        return res.status(400).send('Not a survey document');
      }

      const to = toOverride || process.env.SENDGRID_TO || 'printroom@tenderedge.com.au';
      const from = process.env.SENDGRID_FROM || 'printroom@tenderedge.com.au';

      const title = `Site Survey — ${survey.clientName || survey.client || survey.company || 'Untitled'}`;
      const fileName = `Survey_${(survey.clientName || survey.client || survey.company || surveyId)
        .toString().replace(/\s+/g, '_')}.pdf`;

      // ---- Generate PDF (wait for end event) ----
      const pdfBuf = await new Promise((resolve, reject) => {
        const buffers = [];
        const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: title } });
        doc.on('data', (b) => buffers.push(b));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        doc.fontSize(18).text('SITE SURVEY', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Client: ${survey.clientName || survey.client || ''}`);
        doc.text(`Company: ${survey.company || ''}`);
        doc.text(`Contact: ${survey.contact || ''}`);
        doc.text(`Phone: ${survey.phone || ''}`);
        doc.text(`Email: ${survey.email || ''}`);
        doc.text(`Address: ${survey.address || ''}`);
        if (survey.description) {
          doc.moveDown();
          doc.text(`Notes: ${survey.description}`);
        }

        doc.end();
      });

      // ---- Send email with attachment ----
      sgMail.setApiKey(SENDGRID_API_KEY.value());
      await sgMail.send({
        to,
        from,
        subject: title,
        html: `<p>Attached is the Site Survey for <strong>${survey.clientName || survey.client || ''}</strong>.</p>`,
        attachments: [{
          content: pdfBuf.toString('base64'),
          filename: fileName,
          type: 'application/pdf',
          disposition: 'attachment',
        }],
      });

      console.log('✅ Survey PDF sent', { surveyId, to });
      res.status(200).send('OK');
    } catch (err) {
      console.error('❌ sendSurveyPdf failed', err);
      res.status(500).send(`Failed: ${err.message}`);
    }
  }
);

// --------------------------------------------------------------------
// Manual resend endpoint
// --------------------------------------------------------------------
exports.resendCompletionEmail = onRequest(
  { secrets: [SENDGRID_API_KEY] },
  async (req, res) => {
    try {
      const jobId = (req.query.jobId || req.body?.jobId || '').toString().trim();
      if (!jobId) return res.status(400).send('Missing jobId');

      const jobRef = db.collection('jobs').doc(jobId);
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) return res.status(404).send(`Job ${jobId} not found`);

      const job = jobSnap.data() || {};
      await sendCompletionEmail({
        jobId,
        job,
        toOverride: req.query.to || req.body?.to,
        keyVal: SENDGRID_API_KEY.value(),
      });

      res.send(`✅ Resent completion email for job ${jobId}`);
    } catch (err) {
      res.status(500).send(`❌ Failed: ${err.message}`);
    }
  }
);
