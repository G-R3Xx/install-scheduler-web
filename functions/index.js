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

const PDFDocument = require('pdfkit');
const fetch = require('node-fetch'); // v2
const cors = require('cors')({ origin: true });

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

// ---------- Email a Survey PDF (client-generated) ----------
exports.sendSurveyPdf = onRequest({ secrets: [SENDGRID_API_KEY] }, async (req, res) => {
  return cors(req, res, async () => {
    try {
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method !== 'POST') return res.status(405).send('Use POST');

      const { surveyId, to: toOverride } = req.body || {};
      if (!surveyId) return res.status(400).send('Missing surveyId');

      // Load survey (stored in jobs collection with jobType === 'survey')
      const snap = await db.collection('jobs').doc(String(surveyId)).get();
      if (!snap.exists) return res.status(404).send('Survey not found');

      const survey = snap.data() || {};
      if ((survey.jobType || 'survey') !== 'survey') {
        return res.status(400).send('Document is not a survey');
      }

      // Configure SendGrid
      const key = SENDGRID_API_KEY.value();
      sgMail.setApiKey(key);
      const to = toOverride || process.env.SENDGRID_TO || 'printroom@tenderedge.com.au';
      const from = process.env.SENDGRID_FROM || 'printroom@tenderedge.com.au';

      // Build PDF
      const title = `Site Survey — ${survey.clientName || survey.client || survey.company || 'Untitled'}`;
      const fileName = `Survey_${(survey.clientName || survey.client || survey.company || surveyId)
        .toString()
        .replace(/\s+/g, '_')}.pdf`;

      const buffers = [];
      const doc = new PDFDocument({
        size: 'A4',
        margin: 32,
        info: { Title: title }
      });
      doc.on('data', (b) => buffers.push(b));
      doc.on('error', (e) => console.error('PDF error', e));

      // Header band
      doc.rect(doc.page.margins.left - 10, 22, doc.page.width - 2 * doc.page.margins.left + 20, 40).fill('#0e2a47');
      doc.fill('#ffffff').fontSize(18).text('SITE SURVEY', { align: 'left' }).moveDown(0.2);
      doc.fontSize(10).text(new Date().toLocaleString(), { align: 'left' });
      doc.moveDown(1.1);
      doc.fill('#000000');

      // Client block
      const p = (label, value) => {
        doc.font('Helvetica-Bold').fontSize(11).text(`${label}:`, { continued: true });
        doc.font('Helvetica').text(` ${value || '—'}`);
      };
      p('Client', survey.clientName || survey.client || '—');
      p('Company', survey.company || '—');
      p('Contact', survey.contact || '—');
      p('Phone', survey.phone || '—');
      p('Email', survey.email || '—');
      p('Address', survey.address || '—');
      if (survey.description) {
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').text('Notes:');
        doc.font('Helvetica').text(String(survey.description || ''), { width: 520 });
      }

      // Helper: fetch image -> Buffer
      async function fetchImageBuf(url) {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          return Buffer.from(await r.arrayBuffer());
        } catch {
          return null;
        }
      }

      // Signs
      const signs = Array.isArray(survey.signs) ? survey.signs : [];
      if (signs.length) {
        doc.addPage();
        doc.font('Helvetica-Bold').fontSize(14).text('Survey Signs', { underline: true });
        doc.moveDown(0.6);

        for (let i = 0; i < signs.length; i++) {
          const s = signs[i] || {};
          const caption = s.name || `Sign ${i + 1}`;
          const desc = s.description || '';
          const imgUrl = s.annotatedImageUrl || s.originalImageUrl || '';

          // Keep each sign (image + caption) on the same page
          doc.moveDown(0.2);
          const startY = doc.y;
          const blockHeight = 320; // approx space for image + text
          if (startY + blockHeight > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
          }

          doc.font('Helvetica-Bold').fontSize(12).text(caption);
          if (desc) {
            doc.font('Helvetica').fontSize(10).text(desc, { width: 520 });
            doc.moveDown(0.3);
          }

          if (imgUrl) {
            const buf = await fetchImageBuf(imgUrl);
            if (buf) {
              // Place image max width ~520, keep aspect
              try {
                const x = doc.x;
                const y = doc.y;
                doc.image(buf, x, y, { fit: [520, 260], align: 'left' });
                doc.moveDown( (260 / 14) ); // move roughly image height (line-height fudge)
              } catch (e) {
                console.warn('Image failed for sign', i, e?.message);
                doc.font('Helvetica-Oblique').fontSize(10).fillColor('#aa0000').text('Image could not be embedded.');
                doc.fillColor('#000000');
              }
            } else {
              doc.font('Helvetica-Oblique').fontSize(10).fillColor('#aa0000').text('Image unavailable.');
              doc.fillColor('#000000');
            }
          } else {
            doc.font('Helvetica-Oblique').fontSize(10).text('No image provided.');
          }

          doc.moveDown(0.6);
        }
      }

      // Reference photos (thumbnails grid)
      const refs = Array.isArray(survey.referencePhotos) ? survey.referencePhotos : [];
      if (refs.length) {
        doc.addPage();
        doc.font('Helvetica-Bold').fontSize(14).text('Reference Photos', { underline: true });
        doc.moveDown(0.6);

        const cellW = 170, cellH = 120, gap = 10;
        let x = doc.x, y = doc.y, col = 0;

        for (let i = 0; i < refs.length; i++) {
          const buf = await fetchImageBuf(refs[i]);
          if (buf) {
            if (y + cellH > doc.page.height - doc.page.margins.bottom) {
              doc.addPage();
              x = doc.page.margins.left; y = doc.y; col = 0;
            }
            try {
              doc.image(buf, x, y, { fit: [cellW, cellH], align: 'left', valign: 'top' });
            } catch (e) {
              doc.font('Helvetica-Oblique').fontSize(10).fillColor('#aa0000')
                .text('Photo error', x, y);
              doc.fillColor('#000000');
            }
            col++;
            if (col === 3) { col = 0; x = doc.page.margins.left; y += cellH + gap; }
            else { x += cellW + gap; }
          }
        }
      }

      doc.end();
      const pdfBuf = Buffer.concat(buffers);

      // Send email
      await sgMail.send({
        to,
        from,
        subject: `Site Survey — ${survey.clientName || survey.company || surveyId}`,
        html: `
          <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;">
            <h2 style="margin:0 0 8px;">Site Survey</h2>
            <div><strong>Client:</strong> ${survey.clientName || survey.client || ''}</div>
            <div><strong>Company:</strong> ${survey.company || ''}</div>
            <div><strong>Address:</strong> ${survey.address || ''}</div>
            <p style="color:#666">Survey ID: ${surveyId}</p>
          </div>
        `,
        attachments: [
          {
            content: pdfBuf.toString('base64'),
            filename: fileName,
            type: 'application/pdf',
            disposition: 'attachment'
          }
        ],
      });

      console.log('✅ Survey PDF sent', { surveyId, to });
      res.status(200).send('OK');
    } catch (err) {
      console.error('❌ sendSurveyPdf failed', {
        message: err?.message, code: err?.code, body: err?.response?.body
      });
      const details = err?.response?.body?.errors?.map(e => e.message).join('; ')
        || err?.message || 'Unknown error';
      res.status(500).send(`Failed: ${details}`);
    }
  });
});


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
