// functions/index.js
const { onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const { Storage } = require('@google-cloud/storage');

try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();
const storage = new Storage();

const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Compute hours from entry (manual hours or start/end)
 */
function hoursFromEntry(d) {
  if (typeof d.hours === 'number' && Number.isFinite(d.hours)) return d.hours;

  const hasEnd = typeof d.end !== 'undefined' && d.end !== null;
  if (!hasEnd) return 0;

  const start = d.start?.toDate?.() || null;
  const end = d.end?.toDate?.() || null;
  if (!start || !end) return 0;

  return (end.getTime() - start.getTime()) / 3600000;
}

/**
 * Parse GCS URL
 */
function parseGsFromDownloadUrl(urlString) {
  try {
    const u = new URL(urlString);
    if (u.hostname.includes('firebasestorage.googleapis.com')) {
      const parts = u.pathname.split('/');
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

/**
 * Download file from GCS for attachments
 */
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

// ----------------------------------------
// HOURS RECALC: runs on any timeEntries write
// ----------------------------------------
exports.recalcJobHoursOnTimeEntryWrite = onDocumentWritten(
  { document: 'jobs/{jobId}/timeEntries/{entryId}' },
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

// ----------------------------------------
// EMAIL ON COMPLETION
// ----------------------------------------
exports.sendCompletionEmail = onDocumentUpdated(
  { document: 'jobs/{jobId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const jobId = event.params.jobId;

    const wasCompleted = String(before.status || '').toLowerCase() === 'completed';
    const nowCompleted = String(after.status || '').toLowerCase() === 'completed';
    if (wasCompleted || !nowCompleted) return;

    sgMail.setApiKey(SENDGRID_API_KEY.value());

    const job = after;
    const client = job.clientName || 'Unknown Client';

    // --- User map
    const usersSnap = await db.collection('users').get();
    const userMap = {};
    usersSnap.forEach((d) => {
      const u = d.data() || {};
      userMap[d.id] = {
        shortName: u.shortName,
        displayName: u.displayName,
        email: u.email,
      };
    });

    // --- Time entries
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
      const when = e.createdAt?.toDate?.()?.toLocaleString() || '—';
      return `<tr><td>${user}</td><td>${hrs}</td><td>${when}</td></tr>`;
    });
    const totalRounded = round2(total);

    // --- Photos
    const completedSnap = await db.collection(`jobs/${jobId}/completedPhotos`).get();
    const photos = completedSnap.docs.map((d) => d.data());
    const photoHtml = photos.length
      ? photos
          .map(
            (p) => `
          <a href="${p.url}" target="_blank">
            <img src="${p.url}" style="width:120px; height:auto; border:1px solid #ccc; border-radius:4px; margin:4px;" />
          </a>`
          )
          .join('')
      : `<p style="color:#888;">No completed photos.</p>`;

    // --- Signature
    const signatureHtml = job.signatureURL
      ? `<a href="${job.signatureURL}" target="_blank">
           <img src="${job.signatureURL}" style="max-width:300px; border:1px solid #ccc; border-radius:4px;" />
         </a>`
      : '';

    // --- Assigned names
    const assignedNames = Array.isArray(job.assignedTo)
      ? job.assignedTo.map(
          (uid) =>
            userMap[uid]?.shortName ||
            userMap[uid]?.displayName ||
            userMap[uid]?.email ||
            uid
        ).join(', ')
      : '—';

    // --- Build HTML
    const installDate = job.installDate?.toDate?.() || null;
    const dateStr = installDate
      ? installDate.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—';
    const timeStr = installDate && job.installTime
      ? installDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '';

    const notesHtml = (job.installerNotes || '—')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    const html = `
      <div style="font-family: system-ui, Arial, sans-serif; line-height:1.5; color:#333;">
        <h2 style="color:#2e7d32;">✅ Job Completed</h2>

        <table cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:14px; margin-bottom:16px;">
          <tr style="background:#f5f5f5;"><td><strong>Client</strong></td><td>${client}</td></tr>
          <tr><td><strong>Company</strong></td><td>${job.company || ''}</td></tr>
          <tr style="background:#f5f5f5;"><td><strong>Address</strong></td><td>${job.address || ''}</td></tr>
          <tr><td><strong>Install Date</strong></td><td>${dateStr} ${timeStr}</td></tr>
          <tr style="background:#f5f5f5;"><td><strong>Assigned To</strong></td><td>${assignedNames}</td></tr>
        </table>

        <h3>Installer Notes</h3>
        <div style="background:#fafafa; border:1px solid #ddd; padding:10px; border-radius:4px;">
          ${notesHtml}
        </div>

        <h3>Hours</h3>
        <table cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:13px; border:1px solid #eee; margin-bottom:16px;">
          <thead>
            <tr style="background:#efefef;">
              <th align="left">User</th>
              <th align="left">Hours</th>
              <th align="left">Logged At</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('')}
            <tr style="background:#f5f5f5; font-weight:600;">
              <td>Total</td><td>${totalRounded}</td><td></td>
            </tr>
          </tbody>
        </table>

        <h3>Completed Photos</h3>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">${photoHtml}</div>

        ${signatureHtml ? `<h3 style="margin-top:16px;">Signature</h3>${signatureHtml}` : ''}
      </div>
    `;

    const msg = {
      to: 'printroom@tenderedge.com.au',
      from: 'printroom@tenderedge.com.au',
      subject: `Job Completed — ${client}`,
      html,
      trackingSettings: { clickTracking: { enable: false, enable_text: false } },
    };

    try {
      await sgMail.send(msg);
      console.log(`Completion email sent for job ${jobId}`);
    } catch (err) {
      console.error('SendGrid send failed:', err?.response?.body || err.message || err);
      throw err;
    }
  }
);

// ----------------------------------------
// Optional one-off repair (kept as before)
// ----------------------------------------
exports.repairDownloadUrls = onRequest(async (req, res) => {
  res.send({ ok: true, message: 'Not changed in this snippet' });
});
