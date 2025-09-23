// backfill.js
const admin = require('firebase-admin');

// 1) Load your service account JSON (path relative to THIS file)
const serviceAccount = require('./serviceAccountKey.json');

// 2) Initialize Admin SDK with explicit credentials
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function backfillPhotos() {
  console.log('Backfilling completedPhotoCount…');
  const jobsSnap = await db.collection('jobs').get();

  for (const jobDoc of jobsSnap.docs) {
    const jobId = jobDoc.id;
    const photosSnap = await db
      .collection('jobs')
      .doc(jobId)
      .collection('completedPhotos')
      .get();

    const count = photosSnap.size;
    await db.collection('jobs').doc(jobId).update({ completedPhotoCount: count });
    console.log(`  ✓ ${jobId}: completedPhotoCount = ${count}`);
  }
  console.log('✅ Photo backfill complete.');
}

async function backfillHours() {
  console.log('Backfilling hoursTotal…');
  const jobsSnap = await db.collection('jobs').get();

  for (const jobDoc of jobsSnap.docs) {
    const jobId = jobDoc.id;
    const timeSnap = await db
      .collection('jobs')
      .doc(jobId)
      .collection('timeEntries')
      .get();

    let total = 0;
    timeSnap.forEach(d => { total += Number(d.data()?.hours || 0); });

    // round to 2dp to match UI behaviour
    total = Math.round(total * 100) / 100;

    await db.collection('jobs').doc(jobId).update({ hoursTotal: total });
    console.log(`  ✓ ${jobId}: hoursTotal = ${total}`);
  }
  console.log('✅ Hours backfill complete.');
}

(async () => {
  await backfillPhotos();
  await backfillHours(); // optional but handy
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
