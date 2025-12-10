// functions/index.js

const { onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { Storage } = require('@google-cloud/storage');

try {
  admin.app();
} catch {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = new Storage();
const region = 'australia-southeast1';

// === Secrets ===
const GMAIL_USER = defineSecret('GMAIL_USER');                 // e.g. installscheduler@tenderedge.com.au
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD'); // 16-char app password
const MGMT_EMAIL = defineSecret('MGMT_EMAIL');                 // e.g. printroom@tenderedge.com.au (comma-separated OK)
const MAIL_TEST_KEY = defineSecret('MAIL_TEST_KEY');           // for sendTestEmail endpoint
const FRONTEND_BASE_URL = defineSecret('FRONTEND_BASE_URL');   // e.g. https://installscheduler.web.app

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

/** Download a GCS object and return base64/mime/meta (if you later want attachments). */
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
// Fires only when status transitions TO "completed"
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
    const client = job.clientName || 'Unknown Job';

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
      ? installDate.toLocaleTimeString('en-AU', {
          timeZone: 'Australia/Sydney',
          hour: 'numeric',
          minute: '2-digit'
        })
      : '';

    // Notes (basic HTML escape + newlines to <br/>)
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
      ? `${job.contactName || job.clientName || 'Job'} <${job.email}>`
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
// CLIENT SUMMARY EMAIL — Firestore trigger (no CORS, photos as attachments)
// Fires when clientEmailRequestId changes on a job document
// ------------------------------------------------------------------
exports.sendClientSummaryEmail = onDocumentUpdated(
  { region, document: 'jobs/{jobId}', secrets: [GMAIL_USER, GMAIL_APP_PASSWORD] },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after  = event.data?.after?.data()  || {};
    const jobId  = event.params.jobId;

    const prevReqId = before.clientEmailRequestId || null;
    const reqId     = after.clientEmailRequestId  || null;

    // Only run when there's a *new* request id
    if (!reqId || prevReqId === reqId) return;

    const job = after;

    const targetEmail = (job.clientEmailTarget || job.email || '').toString().trim();
    if (!targetEmail || !targetEmail.includes('@')) {
      console.warn('Client summary email requested but no valid email', { jobId, targetEmail });
      return;
    }

    const clientName = job.clientName || job.contact || 'Valued client';

    const jobRef = db.collection('jobs').doc(jobId);

    // --- Completed photos as attachments ---
    const completedSnap = await jobRef.collection('completedPhotos').get();
    const photos = completedSnap.docs.map((d) => d.data() || {});

    const attachments = [];
    photos.forEach((p, index) => {
      if (!p.url) return;

      let filename = `photo-${index + 1}.jpg`;
      try {
        const u = new URL(p.url);
        const last = u.pathname.split('/').pop() || '';
        if (last) {
          filename = decodeURIComponent(last.split('?')[0] || filename);
        }
      } catch {
        // keep default
      }

      attachments.push({
        filename,
        path: p.url,           // Nodemailer will fetch public HTTPS URL
        contentType: 'image/jpeg',
      });
    });

    // --- Signature (inline image) ---
    const signatureHtml = job.signatureURL
      ? `<p><strong>Sign-off:</strong></p>
         <img src="${job.signatureURL}" style="max-width:300px;border:1px solid #ddd;border-radius:4px;" />`
      : '';

    // --- Date ---
    let dateStr = '';
    try {
      const installDate = job.installDate?.toDate?.() || null;
      dateStr = installDate
        ? installDate.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })
        : '';
    } catch (e) {
      console.warn('Unable to format installDate for job', jobId, e);
      dateStr = '';
    }

    // --- Notes ---
    const notesHtml = (job.installerNotes || '')
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');

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

        ${
          notesHtml
            ? `
            <h3 style="margin-top:16px;">Installer notes</h3>
            <div style="background:#fafafa;border:1px solid #ddd;padding:10px;border-radius:4px;">
              ${notesHtml}
            </div>
          `
            : ''
        }

        ${
          photos.length
            ? `<p style="margin-top:16px;">Completion photos have been attached to this email for your records.</p>`
            : `<p style="margin-top:16px;color:#777;">No completion photos were attached for this job.</p>`
        }

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
      `Job Name: ${job.clientName || ''}`,
      `Company: ${job.company || ''}`,
      `Address: ${job.address || ''}`,
      dateStr ? `Install date: ${dateStr}` : '',
      job.jobNumber ? `Job #: ${job.jobNumber}` : '',
      job.description ? `Description: ${job.description}` : '',
      '',
      photos.length
        ? 'Completion photos are attached to this email.'
        : 'No completion photos attached.',
      job.signatureURL ? 'A copy of the sign-off is included in this email.' : '',
      '',
      'Thanks,',
      'Tender Edge Install Team',
    ]
      .filter(Boolean)
      .join('\n');

    // --- SMTP send ---
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
    });

    const to = `${clientName} <${targetEmail}>`;

    try {
      const info = await transporter.sendMail({
        from: `"Tender Edge Install Team" <${GMAIL_USER.value()}>`,
        to,
        subject,
        html,
        text,
        attachments,
      });

      console.log(`Client summary email sent for job ${jobId}`, info.messageId);

      await jobRef.update({
        clientEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastClientEmailRequestId: reqId,
        lastClientEmailError: admin.firestore.FieldValue.delete(),
      });
    } catch (err) {
      console.error('sendClientSummaryEmail failed', jobId, err);
      await jobRef
        .update({
          lastClientEmailRequestId: reqId,
          lastClientEmailError: err?.message || String(err),
        })
        .catch(() => {});
    }
  }
);

// ------------------------------------------------------------------
// INSTALLER REMINDER EMAIL — from JobDetailPage popup (HTTP, with CORS)
// ------------------------------------------------------------------
exports.sendInstallerReminder = onRequest(
  { region, secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, FRONTEND_BASE_URL] },
  async (req, res) => {
    // CORS
    res.set('Access-Control-Allow-Origin', '*'); // tighten later if needed
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    let step = 'start';
    try {
      step = 'validate-method';
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      step = 'read-body';
      const body = req.body || {};
      const jobId = body.jobId;
      const userIds = Array.isArray(body.userIds) ? body.userIds : [];
      const fields = Array.isArray(body.fields) ? body.fields : [];
      const extraMessage = (body.message || '').toString().trim();

      if (!jobId) {
        res.status(400).send('Missing jobId');
        return;
      }
      if (!userIds.length) {
        res.status(400).send('No userIds provided');
        return;
      }

      step = 'load-job';
      const jobRef = db.collection('jobs').doc(jobId);
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) {
        res.status(404).send(`Job not found: ${jobId}`);
        return;
      }
      const job = jobSnap.data() || {};

      step = 'load-users';
      const userRefs = userIds.map((uid) => db.collection('users').doc(uid));
      const userSnaps = await db.getAll(...userRefs);
      const recipients = userSnaps
        .filter((snap) => snap.exists)
        .map((snap) => {
          const u = snap.data() || {};
          const email = (u.email || '').toString().trim();
          return {
            email,
            name: u.shortName || u.displayName || email,
          };
        })
        .filter((r) => r.email && r.email.includes('@'));

      if (!recipients.length) {
        res.status(400).send('No valid recipient emails found');
        return;
      }

      step = 'build-email';
      const friendlyFieldNames = {
        referencePhotos: 'Reference photos',
        completedPhotos: 'Completed photos',
        signature: 'Client signature',
        hours: 'Hours / timesheets',
        installerNotes: 'Installer notes',
      };

      const fieldLabels = fields.length
        ? fields.map((key) => friendlyFieldNames[key] || key)
        : ['Pending items'];

      const fieldHtml = fieldLabels.map((label) => `<li>${label}</li>`).join('');
      const fieldText = fieldLabels.map((label) => `• ${label}`).join('\n');

      const jobTitle =
        job.clientName || job.company || job.jobNumber || `Job ${jobId}`;

      const baseUrlRaw =
        (FRONTEND_BASE_URL.value && FRONTEND_BASE_URL.value()) ||
        'https://installscheduler.web.app';
      const baseUrl = baseUrlRaw.replace(/\/+$/, '');
      const jobUrl = `${baseUrl}/jobs/${jobId}`;

      const safeExtraHtml = extraMessage
        ? extraMessage
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br/>')
        : '';

      const subject = `Reminder: Update job – ${jobTitle}`;

      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111;line-height:1.5;">
          <p>Hi team,</p>
          <p>This is a reminder to finish the following items on job <strong>${jobTitle}</strong>.</p>
          <h3 style="margin-top:12px;">Items to update</h3>
          <ul>${fieldHtml}</ul>
          ${
            safeExtraHtml
              ? `<p><strong>Note from manager:</strong><br>${safeExtraHtml}</p>`
              : ''
          }
          <p style="margin-top:16px;">
            <a href="${jobUrl}">Open this job in InstallScheduler</a>
          </p>
        </div>
      `;

      const textLines = [
        'Hi team,',
        '',
        `This is a reminder to finish the following items on job "${jobTitle}":`,
        '',
        fieldText,
        '',
        extraMessage ? `Note from manager:\n${extraMessage}` : '',
        '',
        `Open this job: ${jobUrl}`,
      ].filter(Boolean);
      const text = textLines.join('\n');

      step = 'create-transporter';
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
      });

      const to = recipients.map((r) =>
        r.name ? `${r.name} <${r.email}>` : r.email
      );

      step = 'send-mail';
      const info = await transporter.sendMail({
        from: `"Install Scheduler" <${GMAIL_USER.value()}>`,
        to,
        subject,
        html,
        text,
      });

      step = 'log-reminder';
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
      console.error('sendInstallerReminder error at step', step, err);
      res.status(500).send(`Error at step "${step}": ${err?.message || err}`);
    }
  }
);

// ------------------------------------------------------------------
// HTTPS test endpoint — quick way to verify SMTP + secrets
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
// Optional one-off repair endpoint (stub)
// ------------------------------------------------------------------
exports.repairDownloadUrls = onRequest(async (req, res) => {
  res.send({ ok: true, message: 'Not changed in this snippet' });
});
