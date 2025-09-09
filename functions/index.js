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
// Survey PDF + Email (polished design, safe streaming)
// --------------------------------------------------------------------
// ---------- Email a Survey PDF (client-generated) ----------
exports.sendSurveyPdf = onRequest(
  { secrets: [SENDGRID_API_KEY], region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    // ---- CORS FIRST ----
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

      // Load survey doc
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

      // ---------- PDF BUILD (robust) ----------
      const title = `Site Survey — ${survey.clientName || survey.client || survey.company || 'Untitled'}`;
      const fileName = `Survey_${(survey.clientName || survey.client || survey.company || surveyId)
        .toString()
        .replace(/\s+/g, '_')}.pdf`;

      // Safe fetch with timeout
      const safeFetchBuf = async (url, ms = 15000) => {
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
      };

      // Normalize input arrays
      const signs = Array.isArray(survey.signs) ? survey.signs : [];
      const refs  = Array.isArray(survey.referencePhotos) ? survey.referencePhotos : [];

      // Start PDF
      const buffers = [];
      const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: title } });
      doc.on('data', (b) => buffers.push(b));
      doc.on('error', (e) => console.error('PDF error', e));

      // Styles & helpers
      const ACCENT = '#0E2A47';
      const MUTED  = '#6b7280';
      const BORDER = '#e5e7eb';
      const TEXT   = '#111827';
      const SUBTLE = '#f3f4f6';
      const pageWidth = doc.page.width;
      const L = doc.page.margins.left;
      const R = pageWidth - doc.page.margins.right;
      const usableWidth = R - L;

      const hr = (y = doc.y, color = BORDER) => {
        doc.save().moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(color).stroke().restore();
      };
      const sectionTitle = (text) => {
        doc.moveDown(0.7);
        doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXT).text(text);
        hr(doc.y + 4);
        doc.moveDown(0.7);
      };
      const kvRow = (label, value, colX, labelW = 80, valueW = 190) => {
        const yStart = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(String(label), colX, yStart, { width: labelW });
        doc.font('Helvetica').fontSize(10).fillColor('#111').text(String(value || '—'), colX + labelW + 8, yStart, { width: valueW });
      };
      const ensureSpace = (needed) => {
        const bottom = doc.page.height - doc.page.margins.bottom;
        if (doc.y + needed > bottom) doc.addPage();
      };
      const drawFooter = () => {
        const str = `Page ${doc.page.number}`;
        doc.font('Helvetica').fontSize(9).fillColor(MUTED);
        doc.text(str, L, doc.page.height - doc.page.margins.bottom + 10, { width: usableWidth, align: 'right' });
      };
      doc.on('pageAdded', drawFooter);

      // Header band (no async logo fetch to keep PDF fully sync)
      doc.save();
      doc.rect(0, 0, pageWidth, 70).fill(ACCENT);
      doc.restore();
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(16).text('SITE SURVEY', L, 20, { width: usableWidth, align: 'left' });
      doc.font('Helvetica').fontSize(10).text(new Date().toLocaleString(), L, 42);
      doc.moveDown(2.2);

      // Client card
      sectionTitle('Client Details');
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
      kvRow('Phone',   survey.phone,   col2X);
      kvRow('Email',   survey.email,   col2X);
      kvRow('Address', survey.address, col2X, 80, Math.min(usableWidth / 2 - 60, 240));
      doc.moveDown(1.4);

      if (survey.description) {
        sectionTitle('Survey Notes');
        doc.font('Helvetica').fontSize(10).fillColor(TEXT).text(String(survey.description || ''), { width: usableWidth });
      }

      // Signs
      if (signs.length) {
        sectionTitle('Survey Signs');
        for (let i = 0; i < signs.length; i++) {
          const s = signs[i] || {};
          const caption = s.name || `Sign ${i + 1}`;
          const desc = s.description || '';
          const imgUrl = s.annotatedImageUrl || s.originalImageUrl || '';

          const blockH = 20 + (desc ? 36 : 0) + 260 + 18;
          ensureSpace(blockH);

          doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT).text(caption);
          if (desc) {
            doc.moveDown(0.15);
            doc.font('Helvetica').fontSize(10).fillColor(TEXT).text(desc, { width: usableWidth });
          }

          if (imgUrl) {
            const buf = await safeFetchBuf(imgUrl);
            const imgY = doc.y + 6;
            const imgH = 260;

            // light frame
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
            doc.moveDown(imgH / 14 + 0.5);
          } else {
            doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED).text('No image provided.');
          }
          doc.moveDown(0.6);
        }
      }

      // Reference photos grid
      if (refs.length) {
        sectionTitle('Reference Photos');
        const cellW = Math.floor((usableWidth - 20) / 3);
        const cellH = 120;
        const gap = 10;

        let col = 0;
        let x = L;

        for (let i = 0; i < refs.length; i++) {
          ensureSpace(cellH + 16);
          const y = doc.y;

          // light card
          doc.save().rect(x, y, cellW, cellH).fill(SUBTLE).restore();
          doc.save().rect(x, y, cellW, cellH).lineWidth(1).strokeColor(BORDER).stroke().restore();

          const buf = await safeFetchBuf(refs[i]);
          if (buf) {
            try {
              doc.image(buf, x + 4, y + 4, { fit: [cellW - 8, cellH - 8], align: 'center', valign: 'center' });
            } catch {
              doc.font('Helvetica-Oblique').fontSize(9).fillColor('#b91c1c').text('Photo error', x + 6, y + 6);
            }
          } else {
            doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('Unavailable', x + 6, y + 6);
          }

          // advance
          col++;
          if (col === 3) {
            col = 0;
            x = L;
            doc.moveDown(cellH / 14 + 0.6);
          } else {
            x += cellW + gap;
          }
        }
      }

      drawFooter();
      // IMPORTANT: wait for PDF to finish streaming
      const pdfBuf = await new Promise((resolve, reject) => {
        const chunks = [];
        doc.removeAllListeners('data'); // ensure single listener
        doc.on('data', (b) => chunks.push(b));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
      });

      // Email
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
