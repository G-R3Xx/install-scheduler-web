// functions/index.js

const { onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { Storage } = require('@google-cloud/storage');

try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();
const storage = new Storage();

const region = 'australia-southeast1';

// === Secrets ===
const GMAIL_USER = defineSecret('GMAIL_USER');                 // e.g. installscheduler@tenderedge.com.au
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD'); // 16-char app password
const MGMT_EMAIL = defineSecret('MGMT_EMAIL');                 // e.g. printroom@tenderedge.com.au (comma-separated OK)
const MAIL_TEST_KEY = defineSecret('MAIL_TEST_KEY');           // for the HTTPS test endpoint

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

/** Parse bucket/path from a Firebase download URL or gs:// URL. */
function parseGsFromDownloadUrl(urlString) {
  try {
    const u = new URL(urlString);
    if (u.hostname.includes('firebasestorage.googleapis.com')) {
      const parts = u.pathname.split('/');
      // format: /v0/b/<bucket>/o/<encodedPath>
      const bucket = parts[4];
      const encoded = parts[6] || '';
      const path = decodeURIComponent(encoded);
      return { bucket, path };
    }
    if (urlString.startsWith('gs://')) {
      const rest = urlString.replace('gs://', '');
      const bucket = rest.split('/')[0];
      const path = rest.slice(bucket.length + 1);
      return { bucket, path };
    }
  } catch (_) {}
  return null;
}

/** Download a GCS object and return base64/mime/meta (useful if you later decide to attach files). */
async function downloadAsBase64({ bucket, path, filenameHint }) {
  try {
    const file = storage.bucket(bucket).file(path);
    const [meta] = await file.getMetadata().catch(() => [null]);
    const mime = meta?.contentType || 'application/octet-stream';
    const [buf] = await file.download();
    const base64 = buf.toString('base64');
    const last = path.split('/').pop() || filenameHint || 'file';
    const filename = filenameHint || last;
    return { base64, mime, filename, bytes: buf.length };
  } catch (err) {
    console.warn('downloadAsBase64 failed:', err.message);
    return null;
  }
}

// ------------------------------------------------------------------
// HOURS RECALC: runs on any timeEntries write (unchanged)
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
// Fires only when status transitions TO "completed" (unchanged)
// ------------------------------------------------------------------
exports.sendCompletionEmail = onDocumentUpdated(
  { region, document: 'jobs/{jobId}', secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, MGMT_EMAIL] },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after  = event.data?.after?.data()  || {};
    const jobId  = event.params.jobId;

    const wasCompleted = String(before.status || '').toLowerCase() === 'completed';
    const nowCompleted = String(after.status  || '').toLowerCase() === 'completed';
    if (wasCompleted || !nowCompleted) return; // Only on the transition TO completed

    const job = after;
    const client = job.clientName || 'Unknown Client';

    // Build user map
    const usersSnap = await db.collection('users').get();
    const userMap = {};
    usersSnap.forEach((d) => {
      const u = d.data() || {};
      userMap[d.id] = { shortName: u.shortName, displayName: u.displayName, email: u.email };
    });

    // Time entries table
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

    // Completed photos (expects docs in jobs/{jobId}/completedPhotos with {url})
    const completedSnap = await db.collection(`jobs/${jobId}/completedPhotos`).get();
    const photos = completedSnap.docs.map((d) => d.data());
    const photoHtml = photos.length
      ? photos.map((p) => `
          <a href="${p.url}" target="_blank" rel="noopener">
            <img src="${p.url}" style="width:120px;height:auto;border:1px solid #ccc;border-radius:4px;margin:4px;" />
          </a>`).join('')
      : `<p style="color:#888;">No completed photos.</p>`;

    // Signature (URL stored on job doc as signatureURL)
    const signatureHtml = job.signatureURL
      ? `<a href="${job.signatureURL}" target="_blank" rel="noopener">
           <img src="${job.signatureURL}" style="max-width:300px;border:1px solid #ccc;border-radius:4px;" />
         </a>`
      : '';

    // Assigned names
    const assignedNames = Array.isArray(job.assignedTo)
      ? job.assignedTo.map(uid =>
          userMap[uid]?.shortName || userMap[uid]?.displayName || userMap[uid]?.email || uid
        ).join(', ')
      : '—';

    // Date/time
    const installDate = job.installDate?.toDate?.() || null;
    const dateStr = installDate
      ? installDate.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })
      : '—';
    const timeStr = installDate && job.installTime
      ? installDate.toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' })
      : '';

    // Notes (basic HTML escape + newlines to <br/>)
    const notesHtml = (job.installerNotes || '—')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5;color:#333;">
        <h2 style="color:#2e7d32;margin:0 0 12px;">✅ Job Completed</h2>

        <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:16px;">
          <tr style="background:#f5f5f5;"><td><strong>Client</strong></td><td>${client}</td></tr>
          <tr><td><strong>Company</strong></td><td>${job.company || ''}</td></tr>
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

    // Gmail transport (SMTP + App Password)
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
    });

    // Recipients: MGMT_EMAIL (comma-separated OK). Use Reply-To for job contact if present.
    const toList = (MGMT_EMAIL.value() || '').split(',').map(s => s.trim()).filter(Boolean);
    const replyTo = (job.email && String(job.email).includes('@'))
      ? `${job.contactName || job.clientName || 'Client'} <${job.email}>`
      : `"Install Scheduler" <${GMAIL_USER.value()}>`;

    try {
      const info = await transporter.sendMail({
        from: `"Install Scheduler" <${GMAIL_USER.value()}>`,   // keep From = authenticated mailbox
        to: toList,
        replyTo,
        subject: `Job Completed — ${client}${job.jobNumber ? ` [${job.jobNumber}]` : ''}`,
        html,
        text: `Job Completed — ${client}\n\n(HTML version includes details, hours, photos and signature.)`,
      });
      console.log(`Completion email sent for job ${jobId}`, info.messageId);
    } catch (err) {
      console.error('Gmail send failed:', err?.response || err?.message || err);
      throw err;
    }
  }
);

// ------------------------------------------------------------------
// NEW: CLIENT COMPLETION EMAIL (NO HOURS)
// Manual trigger from Job Detail – sends to job.email
// ------------------------------------------------------------------
exports.sendClientCompletionEmail = onRequest(
  { region, secrets: [GMAIL_USER, GMAIL_APP_PASSWORD] },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const jobId = req.body?.jobId || req.query?.jobId;
      if (!jobId) {
        res.status(400).send('Missing jobId');
        return;
      }

      const jobRef = db.collection('jobs').doc(jobId);
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) {
        res.status(404).send('Job not found');
        return;
      }

      const job = jobSnap.data() || {};
      if (!job.email || !String(job.email).includes('@')) {
        res.status(400).send('Job has no valid client email');
        return;
      }

      const clientName = job.clientName || job.contactName || 'Valued client';

      // Completed photos (same pattern as management email)
      const completedSnap = await jobRef.collection('completedPhotos').get();
      const photos = completedSnap.docs.map((d) => d.data());
      const photosHtml = photos.length
        ? photos.map((p) => `
            <div style="margin:4px 0;">
              <img src="${p.url}" style="max-width:100%;border-radius:4px;border:1px solid #ddd;" />
            </div>
          `).join('')
        : '<p>(No photos attached)</p>';

      // Signature if available
      const signatureHtml = job.signatureURL
        ? `<p><strong>Sign-off:</strong></p>
           <img src="${job.signatureURL}" style="max-width:300px;border:1px solid #ddd;border-radius:4px;" />`
        : '';

      // Date
      const installDate = job.installDate?.toDate?.() || null;
      const dateStr = installDate
        ? installDate.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })
        : '';

      // Notes – light cleanup
      const notesHtml = (job.installerNotes || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

      const subject = `Your install is complete — ${clientName}`;

      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111;line-height:1.5;">
          <p>Hi ${clientName},</p>
          <p>Your installation has been completed.</p>

          <h3 style="margin-top:16px;">Job summary</h3>
          <ul style="padding-left:18px;">
            <li><strong>Client:</strong> ${job.clientName || ''}</li>
            <li><strong>Company:</strong> ${job.company || ''}</li>
            <li><strong>Address:</strong> ${job.address || ''}</li>
            ${dateStr ? `<li><strong>Install date:</strong> ${dateStr}</li>` : ''}
            ${job.jobNumber ? `<li><strong>Job #:</strong> ${job.jobNumber}</li>` : ''}
            ${job.description ? `<li><strong>Description:</strong> ${job.description}</li>` : ''}
          </ul>

          ${notesHtml
            ? `
              <h3 style="margin-top:16px;">Installer notes</h3>
              <div style="background:#fafafa;border:1px solid #ddd;padding:10px;border-radius:4px;">
                ${notesHtml}
              </div>
            `
            : ''
          }

          <h3 style="margin-top:16px;">Completion photos</h3>
          ${photosHtml}

          ${signatureHtml}

          <p style="margin-top:24px;">
            If you have any questions or need any adjustments, please reply to this email.
          </p>

          <p>Thanks,<br/>Tender Edge Install Team</p>
        </div>
      `;

      const text = [
        `Hi ${clientName},`,
        '',
        'Your installation has been completed.',
        '',
        `Client: ${job.clientName || ''}`,
        `Company: ${job.company || ''}`,
        `Address: ${job.address || ''}`,
        dateStr ? `Install date: ${dateStr}` : '',
        job.jobNumber ? `Job #: ${job.jobNumber}` : '',
        job.description ? `Description: ${job.description}` : '',
        '',
        'To see photos or sign-off, please view the HTML version of this email.',
        '',
        'Thanks,',
        'Tender Edge Install Team',
      ].filter(Boolean).join('\n');

      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
      });

      const to = `${clientName} <${job.email}>`;

      const info = await transporter.sendMail({
        from: `"Tender Edge Install Team" <${GMAIL_USER.value()}>`,
        to,
        subject,
        html,
        text,
      });

      console.log(`Client completion email sent for job ${jobId}`, info.messageId);

      // Record that we sent a client email
      await jobRef.update({
        clientEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(200).json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error('sendClientCompletionEmail error', err?.response || err?.message || err);
      res.status(500).send('Internal error sending client email');
    }
  }
);

// ------------------------------------------------------------------
// HTTPS test endpoint — quick way to verify SMTP + secrets (unchanged)
// ------------------------------------------------------------------
exports.sendTestEmail = onRequest(
  { region, secrets: [MAIL_TEST_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, MGMT_EMAIL] },
  async (req, res) => {
    if (req.query.key !== MAIL_TEST_KEY.value()) return res.status(401).send('Unauthorized');

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
    });

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
// Optional one-off repair endpoint (kept as a stub) (unchanged)
// ------------------------------------------------------------------
exports.repairDownloadUrls = onRequest(async (req, res) => {
  res.send({ ok: true, message: 'Not changed in this snippet' });
});
