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

// ----------------------------
// Helpers
// ----------------------------
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** HTML-escape for attribute values (href/src) */
function htmlAttr(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Compute hours for a single time entry.
 * - If numeric `hours` present → use it (manual or precomputed).
 * - Else if `start` & `end` exist → (end - start) in hours.
 * - Else → 0 (running entries or incomplete).
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

// ----------------------------
// HOURS RECALC on timeEntries writes
// ----------------------------
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

// ----------------------------
// EMAIL ON COMPLETION (fancy + inline gallery)
// ----------------------------
exports.sendCompletionEmail = onDocumentUpdated(
  { document: 'jobs/{jobId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after  = event.data?.after?.data() || {};
    const jobId  = event.params.jobId;

    const wasCompleted = String(before.status || '').toLowerCase() === 'completed';
    const nowCompleted = String(after.status  || '').toLowerCase() === 'completed';
    if (wasCompleted || !nowCompleted) return;

    sgMail.setApiKey(SENDGRID_API_KEY.value());
    const job = after;
    const client = job.clientName || 'Unknown Client';

    // Users map
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

    // Time entries + per-user totals (ignore running)
    const timeEntriesSnap = await db.collection(`jobs/${jobId}/timeEntries`).get();
    const timeEntries = timeEntriesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

    const perUser = {};
    let total = 0;
    for (const e of timeEntries) {
      const hrs = hoursFromEntry(e);
      if (!hrs) continue;
      total += hrs;
      const uid = e.userId || 'unknown';
      perUser[uid] = (perUser[uid] || 0) + hrs;
    }
    const totalRounded = round2(total);
    const allowed = Number(job.allowedHours || 0);
    const hasAllowed = Number.isFinite(allowed) && allowed > 0;

    let hoursSection = `<p><strong>Total Hours:</strong> ${totalRounded}</p>`;
    if (hasAllowed) {
      const ok = totalRounded <= allowed;
      const color = ok ? '#2e7d32' : '#c62828';
      hoursSection += `
        <p><strong>Quoted/Allowed Hours:</strong> ${allowed}
        <span style="color:${color};font-weight:600"> (vs ${totalRounded})</span></p>`;
    }
    if (Object.keys(perUser).length) {
      hoursSection += `<ul style="margin-top:6px;margin-bottom:6px">`;
      for (const [uid, hrs] of Object.entries(perUser)) {
        const display =
          userMap[uid]?.shortName ||
          userMap[uid]?.displayName ||
          userMap[uid]?.email ||
          uid;
        hoursSection += `<li>${display}: ${round2(hrs)} hrs</li>`;
      }
      hoursSection += `</ul>`;
    }

    // Detailed time entries table with timestamps
    const timeEntriesHtml = timeEntries.length ? `
      <h3 style="font-size:16px;margin:12px 0 6px;border-bottom:2px solid #1976d2;display:inline-block;">Time Entries</h3>
      <table cellpadding="8" cellspacing="0" border="0" style="width:100%;border:1px solid #ddd;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
        <thead style="background:#f5f5f5;">
          <tr>
            <th align="left" style="border:1px solid #ddd;">User</th>
            <th align="left" style="border:1px solid #ddd;">Type</th>
            <th align="left" style="border:1px solid #ddd;">Date</th>
            <th align="left" style="border:1px solid #ddd;">Start</th>
            <th align="left" style="border:1px solid #ddd;">End / Logged At</th>
            <th align="left" style="border:1px solid #ddd;">Hours</th>
          </tr>
        </thead>
        <tbody>
          ${timeEntries.map((e, idx) => {
            const display =
              userMap[e.userId]?.shortName ||
              userMap[e.userId]?.displayName ||
              userMap[e.userId]?.email ||
              e.userId || '—';
            const type = (e.source || (e.start ? 'timer' : 'manual')).replace(/^\w/, c => c.toUpperCase());
            const start = e.start?.toDate?.() || null;
            const end = e.end?.toDate?.() || null;
            const created = e.createdAt?.toDate?.() || null;
            const dateRef = start || created;
            const dateStr = dateRef
              ? dateRef.toLocaleDateString(undefined, { day:'2-digit', month:'2-digit', year:'numeric' })
              : '—';
            const startStr = start ? start.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '—';
            const endStr = end
              ? end.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })
              : (created ? created.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '—');
            const hrs = round2(hoursFromEntry(e));
            return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#f9f9f9'};">
              <td style="border:1px solid #ddd;">${display}</td>
              <td style="border:1px solid #ddd;">${type}</td>
              <td style="border:1px solid #ddd;">${dateStr}</td>
              <td style="border:1px solid #ddd;">${startStr}</td>
              <td style="border:1px solid #ddd;">${endStr}</td>
              <td style="border:1px solid #ddd;">${hrs}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    ` : '';

    // Photos (inline gallery)
    let completedDocs = [];
    try {
      const snap = await db.collection(`jobs/${jobId}/completedPhotos`).orderBy('createdAt', 'asc').get();
      completedDocs = snap.docs;
    } catch {
      const snap = await db.collection(`jobs/${jobId}/completedPhotos`).get();
      completedDocs = snap.docs;
    }
    const photos = completedDocs.map((d) => (d.data() || {})).filter(p => !!p.url);
    const galleryHtml = photos.length
      ? `
        <h3 style="font-size:16px;margin:12px 0 6px;border-bottom:2px solid #1976d2;display:inline-block;">Completed Photos</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
          ${photos.map((p, idx) => {
            const url = htmlAttr(p.url);
            return `
              <a href="${url}" target="_blank" rel="noopener" style="display:inline-block;border:1px solid #ddd;border-radius:4px;overflow:hidden;text-decoration:none;">
                <img src="${url}" alt="photo ${idx+1}" style="display:block;width:160px;height:120px;object-fit:cover;">
              </a>
            `;
          }).join('')}
        </div>
      `
      : `<div style="color:#666"><em>No completed photos.</em></div>`;

    const signatureHtml = job.signatureURL
      ? (() => {
          const sigUrl = htmlAttr(job.signatureURL);
          return `
            <h3 style="font-size:16px;margin:12px 0 6px;border-bottom:2px solid #1976d2;display:inline-block;">Signature</h3>
            <a href="${sigUrl}" target="_blank" rel="noopener" style="display:inline-block;border:1px solid #ddd;border-radius:4px;overflow:hidden;">
              <img src="${sigUrl}" alt="signature" style="display:block;height:120px;background:#fff;">
            </a>
          `;
        })()
      : '';

    // Assigned (short names)
    const assignedDisplay = Array.isArray(job.assignedTo) && job.assignedTo.length
      ? job.assignedTo.map(uid =>
          userMap[uid]?.shortName ||
          userMap[uid]?.displayName ||
          userMap[uid]?.email ||
          uid
        ).join(', ')
      : '—';

    // Install date/time
    const installDate = job.installDate?.toDate?.() || null;
    const dateStr = installDate
      ? installDate.toLocaleDateString(undefined, { day:'2-digit', month:'2-digit', year:'numeric' })
      : '—';
    const timeStr = installDate && job.installTime
      ? installDate.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })
      : '';

    const notesHtml = (job.installerNotes || '—')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    // Fancy template
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height:1.5; color:#333;">
        <!-- Header -->
        <div style="background:#1976d2;color:#fff;padding:16px;border-radius:6px 6px 0 0;">
          <h2 style="margin:0;font-size:20px;">✅ Job Completed</h2>
        </div>

        <div style="padding:20px;border:1px solid #ddd;border-top:none;border-radius:0 0 6px 6px;">
          <!-- Job Info -->
          <table cellpadding="6" cellspacing="0" style="width:100%;font-size:14px;margin-bottom:20px;">
            <tr><td><strong>Client</strong></td><td>${client}</td></tr>
            <tr><td><strong>Company</strong></td><td>${job.company || ''}</td></tr>
            <tr><td><strong>Address</strong></td><td>${job.address || ''}</td></tr>
            <tr><td><strong>Install Date</strong></td><td>${dateStr} ${timeStr ? `&nbsp;${timeStr}` : ''}</td></tr>
            <tr><td><strong>Assigned To</strong></td><td>${assignedDisplay}</td></tr>
          </table>

          <!-- Installer Notes -->
          <h3 style="font-size:16px;margin:12px 0 6px;border-bottom:2px solid #1976d2;display:inline-block;">Installer Notes</h3>
          <div style="background:#f9f9f9;padding:12px;border-radius:4px;margin-bottom:20px;">
            ${notesHtml}
          </div>

          <!-- Hours -->
          <h3 style="font-size:16px;margin:12px 0 6px;border-bottom:2px solid #1976d2;display:inline-block;">Hours</h3>
          ${hoursSection}

          <!-- Time Entries -->
          ${timeEntriesHtml}

          <!-- Inline Gallery -->
          ${galleryHtml}

          <!-- Signature -->
          ${signatureHtml}

          <!-- Footer note -->
          <div style="margin-top:16px;color:#666;font-style:italic;">
            Images are shown as thumbnails — click any to open the original file.
          </div>
        </div>
      </div>
    `;

    const msg = {
      to: 'printroom@tenderedge.com.au',
      from: 'printroom@tenderedge.com.au',
      subject: `Job Completed — ${client}`,
      html,
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

// ----------------------------
// Repair URLs endpoint
// ----------------------------
// Detects whether a URL needs repair (missing token/signed query).
function needsRepair(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  if (u.includes('token=')) return false;           // Firebase download token
  if (u.includes('x-goog-signature')) return false; // GCS signed URL
  return u.includes('firebasestorage.googleapis.com') || u.startsWith('gs://');
}

// Parse Firebase Storage URL/path → { bucket, path }
function parseGs(urlOrPath) {
  try {
    if (!urlOrPath) return null;
    if (urlOrPath.startsWith('gs://')) {
      const rest = urlOrPath.slice(5);
      const i = rest.indexOf('/');
      if (i === -1) return null;
      return { bucket: rest.slice(0, i), path: rest.slice(i + 1) };
    }
    const u = new URL(urlOrPath);
    if (u.hostname.includes('firebasestorage.googleapis.com')) {
      // ["", "v0", "b", "<bucket>", "o", "<encodedPath>"]
      const parts = u.pathname.split('/');
      const bucket = parts[3];
      const encoded = parts[5] || '';
      if (!bucket || !encoded) return null;
      const path = decodeURIComponent(encoded);
      return { bucket, path };
    }
  } catch (_) {}
  return null;
}

// Create a long-lived signed read URL (v4)
async function createSignedReadUrl(bucket, path) {
  const [signed] = await storage
    .bucket(bucket)
    .file(path)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: '03-01-2491', // far future
    });
  return signed;
}

// GET /repairDownloadUrls?key=YOUR_KEY[&jobId=...][&dry=1]
exports.repairDownloadUrls = onRequest(async (req, res) => {
  try {
    const EXPECTED_KEY = process.env.REPAIR_KEY || 'PTRnYTt7iSYvJUe';
    if ((req.query.key || '') !== EXPECTED_KEY) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const onlyJobId = (req.query.jobId || '').trim();
    const dryRun = String(req.query.dry || '') === '1';

    const jobsSnap = onlyJobId
      ? [await db.collection('jobs').doc(onlyJobId).get()]
      : (await db.collection('jobs').get()).docs;

    let scanned = 0, repaired = 0, skipped = 0, errors = 0;

    for (const jobDoc of jobsSnap) {
      if (!jobDoc || !jobDoc.exists) continue;
      const jobId = jobDoc.id;
      const jobData = jobDoc.data() || {};

      // Signature
      if (jobData.signatureURL && needsRepair(jobData.signatureURL)) {
        const gs = parseGs(jobData.signatureURL);
        if (gs) {
          try {
            const url = await createSignedReadUrl(gs.bucket, gs.path);
            scanned++;
            if (dryRun) {
              console.log('[DRY] signatureURL', jobId, '->', url);
            } else {
              await jobDoc.ref.update({ signatureURL: url });
              repaired++;
            }
          } catch (e) {
            console.warn('signatureURL repair failed', jobId, e.message);
            errors++;
          }
        } else {
          skipped++;
        }
      }

      // Completed Photos
      try {
        const comp = await db.collection(`jobs/${jobId}/completedPhotos`).get();
        for (const d of comp.docs) {
          const data = d.data() || {};
          const url = data.url;
          if (!url || !needsRepair(url)) { scanned++; skipped++; continue; }
          const gs = parseGs(url) || (data.path ? { bucket: `${process.env.GCLOUD_PROJECT}.appspot.com`, path: data.path } : null);
          if (!gs) { scanned++; skipped++; continue; }
          try {
            const signed = await createSignedReadUrl(gs.bucket, gs.path);
            scanned++;
            if (dryRun) {
              console.log('[DRY] completedPhotos', jobId, d.id, '->', signed);
            } else {
              await d.ref.update({ url: signed });
              repaired++;
            }
          } catch (e) {
            console.warn('completedPhotos repair failed', jobId, d.id, e.message);
            errors++;
          }
        }
      } catch (e) {
        console.warn('completedPhotos list failed', jobId, e.message);
        errors++;
      }

      // Reference Photos
      try {
        const refp = await db.collection(`jobs/${jobId}/referencePhotos`).get();
        for (const d of refp.docs) {
          const data = d.data() || {};
          const url = data.url;
          if (!url || !needsRepair(url)) { scanned++; skipped++; continue; }
          const gs = parseGs(url) || (data.path ? { bucket: `${process.env.GCLOUD_PROJECT}.appspot.com`, path: data.path } : null);
          if (!gs) { scanned++; skipped++; continue; }
          try {
            const signed = await createSignedReadUrl(gs.bucket, gs.path);
            scanned++;
            if (dryRun) {
              console.log('[DRY] referencePhotos', jobId, d.id, '->', signed);
            } else {
              await d.ref.update({ url: signed });
              repaired++;
            }
          } catch (e) {
            console.warn('referencePhotos repair failed', jobId, d.id, e.message);
            errors++;
          }
        }
      } catch (_) {}
    }

    return res.json({ ok: true, scanned, repaired, skipped, errors, dryRun });
  } catch (err) {
    console.error('repairDownloadUrls failed', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ----------------------------
// One-off: recalc all jobs now
// ----------------------------
exports.recalcAllJobHoursOnce = onRequest(async (_req, res) => {
  try {
    const jobs = await db.collection('jobs').get();
    for (const job of jobs.docs) {
      const jobId = job.id;
      const entries = await db.collection('jobs').doc(jobId).collection('timeEntries').get();
      let total = 0;
      for (const e of entries.docs) total += hoursFromEntry(e.data() || {});
      await db.collection('jobs').doc(jobId).update({
        hoursTotal: round2(total),
        hoursUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed');
  }
});
