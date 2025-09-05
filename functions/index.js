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

// Initialize Admin with your storage bucket so we can sign URLs
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

// ---------- Shared email sender (Job Completed HTML email) ----------
async function sendCompletionEmail({ jobId, job, toOverride, keyVal }) {
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

// ---------- Email a Survey PDF (client-generated) ----------
exports.sendSurveyPdf = onRequest(
  { secrets: [SENDGRID_API_KEY], region: 'us-central1' },
  async (req, res) => {
    // --- CORS ---
    const origin = req.get('origin') || '';
    const ALLOWED_ORIGINS = [
      'https://install-scheduler.web.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
    }
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Max-Age', '3600');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') {
      return res.status(405).send('Use POST');
    }

    try {
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
      sgMail.setApiKey(SENDGRID_API_KEY.value());
      const to = toOverride || process.env.SENDGRID_TO || 'printroom@tenderedge.com.au';
      const from = process.env.SENDGRID_FROM || 'printroom@tenderedge.com.au';

     // ---------- Build a polished, branded PDF ----------
const title = `Site Survey — ${survey.clientName || survey.client || survey.company || 'Untitled'}`;
const fileName = `Survey_${(survey.clientName || survey.client || survey.company || surveyId)
  .toString()
  .replace(/\s+/g, '_')}.pdf`;

const buffers = [];
const doc = new PDFDocument({
  size: 'A4',
  margin: 36, // a bit tighter than default; we manage whitespace ourselves
  info: { Title: title }
});
doc.on('data', (b) => buffers.push(b));
doc.on('error', (e) => console.error('PDF error', e));

/* ---- quick style helpers ---- */
const ACCENT = '#0E2A47';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const TEXT = '#111827';
const SUBTLE = '#f3f4f6';
doc.fillColor(TEXT);

const pageWidth = doc.page.width;
const L = doc.page.margins.left;
const R = pageWidth - doc.page.margins.right;
const usableWidth = R - L;

function hr(y = doc.y, color = BORDER) {
  doc.save().moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(color).stroke().restore();
}

function sectionTitle(text) {
  doc.moveDown(0.7);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXT).text(text);
  hr(doc.y + 4);
  doc.moveDown(0.7);
}

function kvRow(label, value, colX, labelW = 80, valueW = 190) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(`${label}`, colX, doc.y, {
    width: labelW, continued: false
  });
  const yTop = doc.y - 12;
  doc.font('Helvetica').fontSize(10).fillColor('#111').text(String(value || '—'), colX + labelW + 8, yTop, {
    width: valueW
  });
}

/* ---- footer page numbers ---- */
function drawFooter() {
  const str = `Page ${doc.page.number}`;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  doc.text(str, L, doc.page.height - doc.page.margins.bottom + 10, {
    width: usableWidth,
    align: 'right'
  });
}

doc.on('pageAdded', drawFooter);

/* ---- header band w/ logo ---- */
(function drawHeader() {
  // Accent bar
  doc.save();
  doc.rect(0, 0, pageWidth, 70).fill(ACCENT);
  doc.restore();

  // Logo (optional — swap URL if you have a better asset)
  const logoUrl = 'https://tenderedge.com.au/images/logo-2019.png';

  // Fetch logo (silently ignore if fails)
  // You already have node-fetch available at top-level
  // we’ll inline a tiny helper here to keep this block self-contained:
  async function fetchBuf(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    } catch {
      return null;
    }
  }

  // Render header text and logo synchronously: we’ll kick off the logo fetch now
  const headerY = 20;
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(16).text('SITE SURVEY', L, headerY, {
    width: usableWidth,
    align: 'left'
  });
  doc.font('Helvetica').fontSize(10).text(new Date().toLocaleString(), L, headerY + 22);

  // Reserve space
  doc.moveDown(2.2);

  // Try drawing the logo on the right
  // Note: PDFKit is sync; we await inside an IIFE and then draw synchronously
  // by temporarily pausing layout (translate current y)
  const yAfterHeader = doc.y;
  (async () => {
    const logo = await fetchBuf(logoUrl);
    if (logo) {
      // Save the current page context by capturing page number and coordinates
      const currentPage = doc.page;
      const x = R - 140; // right side
      const y = 12; // inside the bar
      try {
        doc.switchToPage(currentPage.index);
        doc.image(logo, x, y, { fit: [120, 40], align: 'right', valign: 'center' });
      } catch {}
    }
  })().finally(() => {
    doc.y = yAfterHeader;
  });
})();

/* ---- Client Details card ---- */
(function clientCard() {
  sectionTitle('Client Details');

  // subtle card background
  const cardY = doc.y;
  const cardH = 92;
  doc.save().rect(L, cardY - 6, usableWidth, cardH + 12).fill(SUBTLE).restore();
  doc.save().rect(L, cardY - 6, usableWidth, cardH + 12).lineWidth(1).strokeColor(BORDER).stroke().restore();

  const col1X = L + 12;
  const col2X = L + Math.floor(usableWidth / 2) + 12;

  doc.y = cardY + 6;
  kvRow('Client',  survey.clientName || survey.client, col1X);
  kvRow('Company', survey.company, col1X);
  kvRow('Contact', survey.contact, col1X);

  doc.y = cardY + 6;
  kvRow('Phone',   survey.phone, col2X);
  kvRow('Email',   survey.email, col2X);
  kvRow('Address', survey.address, col2X, 80, Math.min(usableWidth / 2 - 60, 240));

  doc.moveDown(1.4);
})();

/* ---- Survey Notes ---- */
if (survey.description) {
  sectionTitle('Survey Notes');
  doc.font('Helvetica').fontSize(10).fillColor(TEXT).text(String(survey.description || ''), {
    width: usableWidth
  });
}

/* ---- small helper to ensure a block fits current page ---- */
function ensureSpace(needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

/* ---- fetch image helper (reuse) ---- */
async function fetchImageBuf(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/* ---- Survey Signs ---- */
const signsArr = Array.isArray(survey.signs) ? survey.signs : [];
if (signsArr.length) {
  sectionTitle('Survey Signs');

  for (let i = 0; i < signsArr.length; i++) {
    const s = signsArr[i] || {};
    const caption = s.name || `Sign ${i + 1}`;
    const desc = s.description || '';
    const imgUrl = s.annotatedImageUrl || s.originalImageUrl || '';

    // anticipated height for one block (title + desc + image)
    const blockH = 20 /*title*/ + (desc ? 36 : 0) + 260 /*image*/ + 18 /*spacer*/;
    ensureSpace(blockH);

    // block title
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT).text(caption);
    if (desc) {
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(10).fillColor(TEXT).text(desc, { width: usableWidth });
    }

    if (imgUrl) {
      const buf = await fetchImageBuf(imgUrl);
      if (buf) {
        // soft image frame
        const imgY = doc.y + 6;
        const imgH = 260;
        doc.save()
          .rect(L, imgY - 4, usableWidth, imgH + 8)
          .fill(SUBTLE)
          .restore();
        doc.save()
          .rect(L, imgY - 4, usableWidth, imgH + 8)
          .lineWidth(1).strokeColor(BORDER).stroke()
          .restore();

        try {
          doc.image(buf, L + 6, imgY, { fit: [usableWidth - 12, imgH], align: 'left' });
        } catch {
          doc.font('Helvetica-Oblique').fontSize(10).fillColor('#b91c1c').text('Image could not be embedded.', L + 12, imgY + 6);
        }
        doc.moveDown(imgH / 14 + 0.5);
      } else {
        doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED).text('Image unavailable.');
      }
    } else {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED).text('No image provided.');
    }

    doc.moveDown(0.6);
  }
}

/* ---- Reference Photos (grid) ---- */
const refs = Array.isArray(survey.referencePhotos) ? survey.referencePhotos : [];
if (refs.length) {
  sectionTitle('Reference Photos');

  const cellW = Math.floor((usableWidth - 20) / 3); // 3 columns + 10px gaps
  const cellH = 120;
  const gap = 10;

  let col = 0;
  let x = L;
  let yTop = doc.y;

  for (let i = 0; i < refs.length; i++) {
    ensureSpace(cellH + 16);
    const buf = await fetchImageBuf(refs[i]);

    // light card
    doc.save()
      .rect(x, doc.y, cellW, cellH)
      .fill(SUBTLE)
      .restore();
    doc.save()
      .rect(x, doc.y, cellW, cellH)
      .lineWidth(1).strokeColor(BORDER).stroke()
      .restore();

    if (buf) {
      try {
        doc.image(buf, x + 4, doc.y + 4, { fit: [cellW - 8, cellH - 8], align: 'center', valign: 'center' });
      } catch {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#b91c1c').text('Photo error', x + 6, doc.y + 6);
      }
    } else {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('Unavailable', x + 6, doc.y + 6);
    }

    // advance grid
    col++;
    if (col === 3) {
      col = 0;
      doc.moveDown(cellH / 14 + 0.6);
      x = L;
    } else {
      x += cellW + gap;
    }
  }
}

// finalize
drawFooter();
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
        attachments: [{
          content: pdfBuf.toString('base64'),
          filename: fileName,
          type: 'application/pdf',
          disposition: 'attachment',
        }],
      });

      console.log('✅ Survey PDF sent', { surveyId });
      return res.status(200).send('OK');
    } catch (err) {
      console.error('❌ sendSurveyPdf failed', {
        message: err?.message, code: err?.code, body: err?.response?.body
      });
      const details = err?.response?.body?.errors?.map(e => e.message).join('; ')
        || err?.message || 'Unknown error';
      return res.status(500).send(`Failed: ${details}`);
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
