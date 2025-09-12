// functions/index.js

/* -----------------------------------------------------------
 * Imports (Firebase Functions v2, Admin, SendGrid, PDF, Fetch)
 * ----------------------------------------------------------*/
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const PDFDocument = require('pdfkit');
const fetch = require('node-fetch'); // v2 only

/* --------------------
 * Admin initialization
 * -------------------*/
admin.initializeApp({ storageBucket: 'install-scheduler.appspot.com' });
const db = admin.firestore();

/* --------------
 * Secrets (v2+)
 * -------------*/
const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');

/* -------------------------
 * Small helpers / utilities
 * ------------------------*/
const lower = (s) => (s || '').toString().toLowerCase().trim();
const esc = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const isHttp = (u) => /^https?:\/\//i.test(u || '');
const isGs   = (u) => /^gs:\/\//i.test(u || '');
const bucket = admin.storage().bucket();

async function toHttpUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;

  // Allow gs:// or bare storage paths
  let objectPath = pathOrUrl;
  if (isGs(objectPath)) objectPath = objectPath.replace(/^gs:\/\/[^/]+\//i, '');
  try {
    const [signed] = await bucket
      .file(objectPath)
      .getSignedUrl({ action: 'read', expires: Date.now() + 1000 * 60 * 60 * 24 }); // 24h
    return signed;
  } catch (err) {
    console.warn('Could not sign URL', { objectPath, error: err?.message });
    return null;
  }
}

async function normalizeManyToHttp(list) {
  const arr = Array.isArray(list) ? list : [];
  const resolved = await Promise.all(arr.map(toHttpUrl));
  return resolved.filter(Boolean);
}
async function normalizeOneToHttp(value) {
  const u = await toHttpUrl(value);
  return u || null;
}

// Download a URL to Buffer (with timeout)
async function fetchBuf(url, timeoutMs = 15000) {
  if (!url) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
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

/* =====================================================================
 * COMPLETED JOB EMAIL (HTML + attachments for completed photos/signature)
 * =====================================================================*/
async function sendCompletionEmail({ jobId, job, toOverride, keyVal }) {
  sgMail.setApiKey(keyVal);

  const toAddress   = toOverride || process.env.SENDGRID_TO   || 'printroom@tenderedge.com.au';
  const fromAddress =              process.env.SENDGRID_FROM || 'printroom@tenderedge.com.au';

  // User map for names
  const usersSnap = await db.collection('users').get();
  const userMap = {};
  usersSnap.forEach((d) => {
    const u = d.data() || {};
    userMap[d.id] = u.shortName || u.displayName || u.email || d.id;
  });

  // Fields
  const clientName  = job.clientName || job.company || 'Unknown Client';
  const address     = job.address || 'No address supplied';
  const description = job.description || '';

  let installDateStr = 'N/A';
  try {
    const d = job.installDate?.toDate?.()
      ? job.installDate.toDate()
      : (job.installDate instanceof Date ? job.installDate : null);
    if (d) installDateStr = d.toLocaleString();
  } catch {}

  const assignedIds   = Array.isArray(job.assignedTo) ? job.assignedTo : (job.assignedTo ? [job.assignedTo] : []);
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

      <p style="color:#888;font-size:12px;margin-top:18px;">Job ID: ${esc(jobId)}</p>
      <p style="color:#666;font-size:13px;margin-top:6px;">Completed photos and signature are attached to this email.</p>
    </div>
  </div>
  `;

  // Build attachments (completed photos + signature)
  const attachments = [];
  // Normalize URLs first so gs:// / storage paths work
  const photoUrls = await normalizeManyToHttp(job.completedPhotos);
  const sigUrl    = await normalizeOneToHttp(job.signatureURL || job.signatureUrl);

  // NOTE: SendGrid message limit is ~30MB. We fetch and attach, skipping failures.
  // We’ll cap to 25 attachments total to stay on the safe side.
  const MAX_ATTACH = 25;

  let attachedCount = 0;
  for (let i = 0; i < photoUrls.length && attachedCount < MAX_ATTACH; i++) {
    const buf = await fetchBuf(photoUrls[i], 20000);
    if (!buf) continue;
    attachments.push({
      content: buf.toString('base64'),
      filename: `completed_photo_${i + 1}.jpg`,
      type: 'image/jpeg',
      disposition: 'attachment',
    });
    attachedCount++;
  }

  if (sigUrl && attachedCount < MAX_ATTACH) {
    const buf = await fetchBuf(sigUrl, 15000);
    if (buf) {
      attachments.push({
        content: buf.toString('base64'),
        filename: 'signature.png',
        type: 'image/png',
        disposition: 'attachment',
      });
    }
  }

  await sgMail.send({
    to: toAddress,
    from: fromAddress,
    subject: `Job Completed — ${clientName}`,
    html,
    attachments: attachments.length ? attachments : undefined,
  });

  console.log('✅ Completion email sent', {
    jobId, toAddress, attachments: attachments.length,
  });
}

/* -----------------------------------------------------------
 * Firestore trigger: send email when job transitions to done
 * ----------------------------------------------------------*/
exports.sendJobCompletedEmail = onDocumentWritten(
  { document: 'jobs/{jobId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const jobId = event.params.jobId;

    const before = event.data.before.exists ? (event.data.before.data() || {}) : null;
    const after  = event.data.after.exists  ? (event.data.after.data()  || {}) : null;

    const beforeStatus = before ? lower(before.status) : '';
    const afterStatus  = after  ? lower(after.status)  : '';

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
      console.error('❌ sendJobCompletedEmail failed', {
        jobId, error: err?.message, code: err?.code, body: err?.response?.body,
      });
    }
  }
);

/* -----------------------------------------
 * Manual test endpoint (SendGrid baseline)
 * ----------------------------------------*/
exports.testSendgridMail = onRequest(
  { secrets: [SENDGRID_API_KEY] },
  async (_req, res) => {
    try {
      sgMail.setApiKey(SENDGRID_API_KEY.value());
      const to   = process.env.SENDGRID_TO   || 'printroom@tenderedge.com.au';
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

/* =========================================================
 * Survey PDF (polished) + email (CORS-safe from your app)
 * ========================================================*/
// --------------------------------------------------------------------
// Survey PDF + Email (polished, single-stream collector, CORS-safe)
// --------------------------------------------------------------------
exports.sendSurveyPdf = onRequest(
  { secrets: [SENDGRID_API_KEY], region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    // ---- CORS (both local & prod) ----
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

      const snap = await db.collection('jobs').doc(String(surveyId)).get();
      if (!snap.exists) return res.status(404).send('Survey not found');

      const survey = snap.data() || {};
      if ((survey.jobType || 'survey') !== 'survey') {
        return res.status(400).send('Document is not a survey');
      }

      // SendGrid
      sgMail.setApiKey(SENDGRID_API_KEY.value());
      const to   = toOverride || process.env.SENDGRID_TO   || 'printroom@tenderedge.com.au';
      const from =              process.env.SENDGRID_FROM || 'printroom@tenderedge.com.au';

      const title = `Site Survey — ${survey.clientName || survey.client || survey.company || 'Untitled'}`;
      const fileName = `Survey_${(survey.clientName || survey.client || survey.company || surveyId)
        .toString()
        .replace(/\s+/g, '_')}.pdf`;

      // Normalize arrays
      const signsArr = Array.isArray(survey.signs) ? survey.signs : [];
      const refArr   = Array.isArray(survey.referencePhotos) ? survey.referencePhotos : [];

      // -------- helper to fetch image as Buffer (timeout) --------
      async function fetchBuf(url, timeoutMs = 15000) {
        if (!url) return null;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
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

      // ---------------- Build PDF (no extra 'data' listeners) ----------------
      const ACCENT = '#0E2A47';
      const MUTED  = '#6b7280';
      const BORDER = '#e5e7eb';
      const TEXT   = '#111827';
      const SUBTLE = '#f3f4f6';

      const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: title } });

      const pageWidth = doc.page.width;
      const L = doc.page.margins.left;
      const R = pageWidth - doc.page.margins.right;
      const usableWidth = R - L;

      const hr = (y = doc.y, color = BORDER) => {
        doc.save().moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(color).stroke().restore();
      };
      const drawFooter = () => {
        const str = `Page ${doc.page.number}`;
        doc.font('Helvetica').fontSize(9).fillColor(MUTED);
        doc.text(str, L, doc.page.height - doc.page.margins.bottom + 10, { width: usableWidth, align: 'right' });
      };
      doc.on('pageAdded', drawFooter);

      // Section pill
      function sectionPill(text) {
        const label = String(text || '').toUpperCase();
        const padX = 10, padY = 4, radius = 10;
        doc.font('Helvetica-Bold').fontSize(10);
        const w = doc.widthOfString(label);
        const h = doc.currentLineHeight();
        const pillW = w + padX * 2;
        const pillH = h + padY * 2;
        const x = L, y = doc.y;
        doc.save()
          .lineWidth(1)
          .fillColor('#e8eef8')
          .strokeColor('#c7d7f2')
          .roundedRect(x, y, pillW, pillH, radius)
          .fillAndStroke()
          .restore();
        doc.fillColor(ACCENT).text(label, x + padX, y + padY);
        doc.moveDown(1.2);
        doc.fillColor(TEXT);
      }

      const ensureSpace = (needed) => {
        const bottom = doc.page.height - doc.page.margins.bottom;
        if (doc.y + needed > bottom) doc.addPage();
      };

      // Header bar + chip
      doc.save();
      doc.rect(0, 0, pageWidth, 70).fill(ACCENT);
      doc.restore();
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(16).text('SITE SURVEY', L, 20, { width: usableWidth, align: 'left' });
      doc.font('Helvetica').fontSize(10).text(new Date().toLocaleString(), L, 42);

      const chipText = `SURVEY ID: ${String(surveyId)}`;
      doc.font('Helvetica-Bold').fontSize(9);
      const chipW = doc.widthOfString(chipText) + 18;
      const chipX = R - chipW;
      const chipY = 16;
      doc.save()
        .fillColor('#fef3c7')
        .strokeColor('#f59e0b')
        .roundedRect(chipX, chipY, chipW, 24, 12)
        .fillAndStroke()
        .restore();
      doc.fillColor('#92400e').text(chipText, chipX + 9, chipY + 6);
      doc.moveDown(2.4);
      drawFooter(); // page 1

      // Client details card
      sectionPill('Client Details');
      const cardY = doc.y;
      const cardH = 92;
      doc.save().rect(L, cardY - 6, usableWidth, cardH + 12).fill(SUBTLE).restore();
      doc.save().rect(L, cardY - 6, usableWidth, cardH + 12).lineWidth(1).strokeColor(BORDER).stroke().restore();

      const kv = (label, val, x, lw = 80, vw = 190) => {
        const yStart = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(String(label || ''), x, yStart, { width: lw });
        doc.font('Helvetica').fontSize(10).fillColor('#111').text(String(val || '—'), x + lw + 8, yStart, { width: vw });
      };
      const col1X = L + 12;
      const col2X = L + Math.floor(usableWidth / 2) + 12;

      doc.y = cardY + 6;
      kv('Client',  survey.clientName || survey.client, col1X);
      kv('Company', survey.company, col1X);
      kv('Contact', survey.contact, col1X);

      doc.y = cardY + 6;
      kv('Phone',   survey.phone,   col2X);
      kv('Email',   survey.email,   col2X);
      kv('Address', survey.address, col2X, 80, Math.min(usableWidth / 2 - 60, 240));
      doc.moveDown(1.2);

      // Notes
      if (survey.description) {
        sectionPill('Survey Notes');
        doc.font('Helvetica').fontSize(10).fillColor(TEXT).text(String(survey.description || ''), { width: usableWidth });
      }

      // Signs
      if (signsArr.length) {
        sectionPill('Survey Signs');
        for (let i = 0; i < signsArr.length; i++) {
          const s = signsArr[i] || {};
          const caption = s.name || `Sign ${i + 1}`;
          const desc = s.description || '';
          const imgUrl = s.annotatedImageUrl || s.originalImageUrl || '';

          const blockH = 20 + (desc ? 36 : 0) + 260 + 14;
          ensureSpace(blockH);

          doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT).text(caption);
          if (desc) {
            doc.moveDown(0.15);
            doc.font('Helvetica').fontSize(10).fillColor(TEXT).text(desc, { width: usableWidth });
          }

          if (imgUrl) {
            const buf = await fetchBuf(imgUrl);
            const imgY = doc.y + 6;
            const imgH = 260;
            doc.save().rect(L, imgY - 4, usableWidth, imgH + 8).fill(SUBTLE).restore();
            doc.save().rect(L, imgY - 4, usableWidth, imgH + 8).lineWidth(1).strokeColor(BORDER).stroke().restore();

            if (buf) {
              try {
                doc.image(buf, L + 6, imgY, { fit: [usableWidth - 12, imgH], align: 'left' });
              } catch {
                doc.font('Helvetica-Oblique').fontSize(10).fillColor('#b91c1c').text('Image could not be embedded.', L + 12, imgY + 6);
              }
            } else {
              doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED).text('Image unavailable.', L + 12, imgY + 6);
            }
            doc.moveDown(imgH / 14 + 0.4);
          } else {
            doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED).text('No image provided.');
          }
          doc.moveDown(0.4);
        }
      }

      // Reference photos (3-col grid with tiny captions)
      if (refArr.length) {
        sectionPill('Reference Photos');
        const cellW = Math.floor((usableWidth - 20) / 3);
        const cellH = 120;
        const gap = 10;

        let col = 0;
        let x = L;

        for (let i = 0; i < refArr.length; i++) {
          const blockH = cellH + 20;
          ensureSpace(blockH);

          const y = doc.y;

          doc.save().rect(x, y, cellW, cellH).fill(SUBTLE).restore();
          doc.save().rect(x, y, cellW, cellH).lineWidth(1).strokeColor(BORDER).stroke().restore();

          const buf = await fetchBuf(refArr[i]);
          if (buf) {
            try {
              doc.image(buf, x + 4, y + 4, { fit: [cellW - 8, cellH - 22], align: 'center', valign: 'center' });
            } catch {
              doc.font('Helvetica-Oblique').fontSize(9).fillColor('#b91c1c').text('Photo error', x + 6, y + 6);
            }
          } else {
            doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('Unavailable', x + 6, y + 6);
          }

          doc.font('Helvetica').fontSize(9).fillColor(MUTED)
            .text(`#${i + 1}`, x + 6, y + cellH - 14, { width: cellW - 12, align: 'left' });

          col++;
          if (col === 3) {
            col = 0;
            x = L;
            doc.moveDown(cellH / 14 + 0.9);
          } else {
            x += cellW + gap;
          }
        }
      }

      drawFooter();

      // ---- collect PDF in one place (single listener) ----
      const pdfBuf = await new Promise((resolve, reject) => {
        const chunks = [];
        doc.on('data', (b) => chunks.push(b));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
      });

      // Email the PDF
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

      console.log('✅ Survey PDF sent', { surveyId, to });
      return res.status(200).send('OK');
    } catch (err) {
      // keep CORS headers in error path too
      console.error('❌ sendSurveyPdf failed', {
        message: err?.message, code: err?.code, body: err?.response?.body,
      });
      const details =
        err?.response?.body?.errors?.map((e) => e.message).join('; ') ||
        err?.message || 'Unknown error';
      return res.status(500).send(`Failed: ${details}`);
    }
  }
);
