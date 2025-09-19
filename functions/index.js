// functions/index.js

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

admin.initializeApp();
const db = admin.firestore();

const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');

// --------- when a job is marked complete ---------
exports.sendCompletionEmail = onDocumentUpdated(
  { document: 'jobs/{jobId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const jobId = event.params.jobId;

    if (before?.status === 'complete' || after?.status !== 'complete') return;

    sgMail.setApiKey(SENDGRID_API_KEY.value());
    const job = after;
    const client = job.clientName || 'Unknown Client';

    // ---- Load users map ----
    const usersSnap = await db.collection('users').get();
    const userMap = {};
    usersSnap.forEach((d) => {
      const u = d.data();
      userMap[d.id] = {
        shortName: u.shortName,
        displayName: u.displayName,
        email: u.email,
      };
    });

    // ---- Hours breakdown ----
    const timeEntriesSnap = await db.collection(`jobs/${jobId}/timeEntries`).get();
    const timeEntries = timeEntriesSnap.docs.map((d) => d.data());

    const perUser = {};
    let total = 0;
    for (const e of timeEntries) {
      const hrs = Number(e.hours || 0);
      if (!hrs) continue;
      total += hrs;
      const uid = e.userId || 'unknown';
      perUser[uid] = (perUser[uid] || 0) + hrs;
    }

    const allowed = job.allowedHours || null;
    let hoursSection = `<p><strong>Total Hours:</strong> ${total}</p>`;
    if (allowed) {
      const color = total <= allowed ? 'green' : 'red';
      hoursSection += `<p><strong>Quoted/Allowed Hours:</strong> ${allowed} <span style="color:${color}">(vs ${total})</span></p>`;
    }
    if (Object.keys(perUser).length) {
      hoursSection += `<ul>`;
      for (const [uid, hrs] of Object.entries(perUser)) {
        const display =
          userMap[uid]?.shortName ||
          userMap[uid]?.displayName ||
          userMap[uid]?.email ||
          uid;
        hoursSection += `<li>${display}: ${hrs} hrs</li>`;
      }
      hoursSection += `</ul>`;
    }

    // ---- Installer notes ----
    const notes = job.installerNotes || '—';

    // ---- Photos & signature ----
    const attachments = [];
    if (Array.isArray(job.completedPhotos)) {
      for (let i = 0; i < job.completedPhotos.length; i++) {
        try {
          const file = storage.file(
            decodeURIComponent(new URL(job.completedPhotos[i]).pathname.replace(/^\/+/, ''))
          );
          const [data] = await file.download();
          attachments.push({
            content: data.toString('base64'),
            filename: `photo_${i + 1}.jpg`,
            type: 'image/jpeg',
            disposition: 'attachment',
          });
        } catch (err) {
          console.warn('Photo download failed', err.message);
        }
      }
    }

    if (job.signatureURL) {
      try {
        const file = storage.file(
          decodeURIComponent(new URL(job.signatureURL).pathname.replace(/^\/+/, ''))
        );
        const [data] = await file.download();
        attachments.push({
          content: data.toString('base64'),
          filename: `signature.png`,
          type: 'image/png',
          disposition: 'attachment',
        });
      } catch (err) {
        console.warn('Signature download failed', err.message);
      }
    }

    // ---- Send email ----
    const msg = {
      to: 'management@example.com',
      from: 'noreply@installscheduler.app',
      subject: `Job Completed — ${client}`,
      html: `
        <h2>Job Completed</h2>
        <p><strong>Client:</strong> ${client}</p>
        <p><strong>Address:</strong> ${job.address || ''}</p>
        <p><strong>Description:</strong> ${job.description || ''}</p>
        <p><strong>Installer Notes:</strong></p>
        <p>${notes.replace(/\n/g, '<br/>')}</p>
        ${hoursSection}
      `,
      attachments,
    };

    await sgMail.send(msg);
    console.log(`Completion email sent for job ${jobId}`);
  }
);
