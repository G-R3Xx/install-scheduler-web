// functions/index.js
const { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();
const bucket = admin.storage().bucket();

const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');

/* --------------------------- Aggregates (unchanged) ------------------------ */
exports.completedPhotoAdded = onDocumentCreated('jobs/{jobId}/completedPhotos/{photoId}', async (event) => {
  const { jobId } = event.params;
  await db.doc(`jobs/${jobId}`).update({
    completedPhotoCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
});

exports.completedPhotoDeleted = onDocumentDeleted('jobs/{jobId}/completedPhotos/{photoId}', async (event) => {
  const { jobId } = event.params;
  await db.doc(`jobs/${jobId}`).update({
    completedPhotoCount: admin.firestore.FieldValue.increment(-1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
});

exports.timeEntryAdded = onDocumentCreated('jobs/{jobId}/timeEntries/{entryId}', async (event) => {
  const { jobId } = event.params;
  const hours = Number(event.data?.data()?.hours || 0);
  if (!hours) return;
  await db.doc(`jobs/${jobId}`).update({
    hoursTotal: admin.firestore.FieldValue.increment(hours),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
});

exports.timeEntryUpdated = onDocumentUpdated('jobs/{jobId}/timeEntries/{entryId}', async (event) => {
  const { jobId } = event.params;
  const before = Number(event.data.before.data()?.hours || 0);
  const after = Number(event.data.after.data()?.hours || 0);
  const diff = after - before;
  if (!diff) return;
  await db.doc(`jobs/${jobId}`).update({
    hoursTotal: admin.firestore.FieldValue.increment(diff),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
});

exports.timeEntryDeleted = onDocumentDeleted('jobs/{jobId}/timeEntries/{entryId}', async (event) => {
  const { jobId } = event.params;
  const hours = Number(event.data?.data()?.hours || 0);
  if (!hours) return;
  await db.doc(`jobs/${jobId}`).update({
    hoursTotal: admin.firestore.FieldValue.increment(-hours),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
});

/* ----------------------- Send completion email trigger --------------------- */
exports.sendCompletionEmail = onDocumentUpdated(
  { document: 'jobs/{jobId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const before = event.data.before.data() || {};
    const after  = event.data.after.data()  || {};
    const jobId  = event.params.jobId;

    // Only fire on first transition to 'completed'
    const becameCompleted =
      String(before.status || '').toLowerCase() !== 'completed' &&
      String(after.status  || '').toLowerCase() === 'completed';
    if (!becameCompleted) return;

    // If we already sent one, don't send again
    if (after.completionEmailSent) return;

    sgMail.setApiKey(SENDGRID_API_KEY.value());

    // ------- Prepare data -------
    const job = after;
    const client = job.clientName || 'Unknown Client';

    // Hours (prefer aggregate; fall back to summing)
    let totalHours = Number(job.hoursTotal || 0);
    if (!totalHours) {
      const ts = await db.collection(`jobs/${jobId}/timeEntries`).get();
      totalHours = ts.docs.reduce((s, d) => s + Number(d.data().hours || 0), 0);
    }
    const allowed = Number(job.allowedHours || 0);
    const hoursHtml = `
      <p><strong>Total Hours:</strong> ${totalHours.toFixed(2)}</p>
      ${allowed ? `<p><strong>Quoted/Allowed Hours:</strong> ${allowed} <span style="color:${totalHours<=allowed?'#2e7d32':'#c62828'}">(vs ${totalHours.toFixed(2)})</span></p>` : ''}
    `;

    // Per-user breakdown (optional)
    let breakdownHtml = '';
    try {
      const ts = await db.collection(`jobs/${jobId}/timeEntries`).get();
      const per = {};
      ts.forEach(d => {
        const e = d.data();
        const uid = e.userId || 'unknown';
        per[uid] = (per[uid] || 0) + Number(e.hours || 0);
      });
      if (Object.keys(per).length) {
        breakdownHtml = '<ul>' + Object.entries(per)
          .map(([uid, hrs]) => `<li>${uid}: ${hrs.toFixed(2)} h</li>`).join('') + '</ul>';
      }
    } catch (_) {}

    // Build links to photos/signature (no attachment permission issues)
    const photosSnap = await db.collection(`jobs/${jobId}/completedPhotos`).get();
    const photoLinks = [];
    for (const d of photosSnap.docs) {
      const url = d.data()?.url;
      if (!url) continue;
      // Use the URL directly; if it's a Storage URL we can also create a signed URL for 7 days:
      try {
        // If URL belongs to our bucket, produce a signed URL (optional)
        const u = new URL(url);
        const m = u.pathname.match(/\/o\/(.+)\?/); // matches encoded object path
        if (m && m[1]) {
          const filePath = decodeURIComponent(m[1]);
          const [signed] = await bucket.file(filePath).getSignedUrl({
            action: 'read',
            expires: Date.now() + 7*24*60*60*1000, // 7 days
          });
          photoLinks.push(signed);
          continue;
        }
      } catch (_) {}
      photoLinks.push(url);
    }
    const photosHtml = photoLinks.length
      ? `<p><strong>Completed Photos:</strong></p><ol>${photoLinks.map(u => `<li><a href="${u}">${u}</a></li>`).join('')}</ol>`
      : '<p><strong>Completed Photos:</strong> —</p>';

    let signatureHtml = '';
    if (job.signatureURL) {
      let sigUrl = job.signatureURL;
      try {
        const u = new URL(job.signatureURL);
        const m = u.pathname.match(/\/o\/(.+)\?/);
        if (m && m[1]) {
          const filePath = decodeURIComponent(m[1]);
          const [signed] = await bucket.file(filePath).getSignedUrl({
            action: 'read',
            expires: Date.now() + 7*24*60*60*1000,
          });
          sigUrl = signed;
        }
      } catch (_) {}
      signatureHtml = `<p><strong>Signature:</strong> <a href="${sigUrl}">View</a></p>`;
    }

    const notes = (job.installerNotes || '').replace(/\n/g, '<br/>');

    const msg = {
      to: 'printroom@tenderedge.com.au',                 // <-- change if needed
      from: 'printroom@tenderedge.com.au',         // your verified sender
      subject: `Job Completed — ${client}`,
      html: `
        <h2>Job Completed</h2>
        <p><strong>Client:</strong> ${client}</p>
        <p><strong>Address:</strong> ${job.address || '—'}</p>
        <p><strong>Description:</strong> ${job.description || '—'}</p>
        ${hoursHtml}
        ${breakdownHtml}
        <p><strong>Installer Notes:</strong></p>
        <p>${notes || '—'}</p>
        ${photosHtml}
        ${signatureHtml}
      `,
    };

    // ------- Send & mark sent -------
    await sgMail.send(msg);
    await db.doc(`jobs/${jobId}`).update({
      completionEmailSent: true,
      completionEmailedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
);
