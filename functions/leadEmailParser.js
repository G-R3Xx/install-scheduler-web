const { onObjectFinalized } = require("firebase-functions/v2/storage");
const admin = require("firebase-admin");
const { Storage } = require("@google-cloud/storage");
const { simpleParser } = require("mailparser");
const crypto = require("crypto");

try {
  admin.app();
} catch {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = new Storage();
const region = "australia-southeast1";

function stripHtml(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSnippet(text, max = 220) {
  const s = (text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function pickAddresses(value) {
  const arr = value?.value || [];
  return arr.map((x) => x?.address || "").filter(Boolean);
}

function pickText(value) {
  return value?.text || "";
}

function safeFileName(name) {
  return (name || "attachment")
    .replace(/[^\w.\-()\s]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

async function findMatchingFileDoc(leadId, storagePath) {
  const snap = await db
    .collection("leads")
    .doc(leadId)
    .collection("files")
    .where("path", "==", storagePath)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ref: doc.ref, data: doc.data() || {} };
}

exports.parseLeadEmailOnUpload = onObjectFinalized(
  { region },
  async (event) => {
    const object = event.data || {};
    const bucket = object.bucket || "";
    const name = object.name || "";

    if (!name.startsWith("leads/")) return;
    if (!/\.eml$/i.test(name)) return;

    const parts = name.split("/");
    if (parts.length < 4) return;

    const leadId = parts[1];
    const category = parts[2];
    const fileName = parts.slice(3).join("/");

    if (category !== "email") return;

    const file = storage.bucket(bucket).file(name);
    const [buffer] = await file.download();

    const parsed = await simpleParser(buffer);
    const textBody = (parsed.text || "").trim();
    const htmlBody = (parsed.html || "").toString();
    const bodyForPreview = textBody || stripHtml(htmlBody);

    const emailDate =
      parsed.date instanceof Date
        ? admin.firestore.Timestamp.fromDate(parsed.date)
        : admin.firestore.FieldValue.serverTimestamp();

    const docId = crypto.createHash("sha1").update(name).digest("hex");
    const fileDoc = await findMatchingFileDoc(leadId, name);

    const attachments = [];
    if (Array.isArray(parsed.attachments) && parsed.attachments.length) {
      for (let i = 0; i < parsed.attachments.length; i += 1) {
        const a = parsed.attachments[i];
        const filename = safeFileName(a.filename || `attachment-${i + 1}`);
        const attachmentPath = `leads/${leadId}/email_attachments/${docId}/${filename}`;

        const attachmentFile = storage.bucket(bucket).file(attachmentPath);
        await attachmentFile.save(a.content, {
          resumable: false,
          metadata: {
            contentType: a.contentType || "application/octet-stream",
          },
        });

        attachments.push({
          filename,
          contentType: a.contentType || "",
          size: Number(a.size || 0),
          checksum: a.checksum || "",
          storagePath: attachmentPath,
        });
      }
    }

    const emailDoc = {
      leadId,
      fileName,
      storagePath: name,
      fileId: fileDoc?.id || "",
      fileUrl: fileDoc?.data?.url || "",
      bucket,
      subject: parsed.subject || "(No subject)",
      fromText: pickText(parsed.from),
      fromAddresses: pickAddresses(parsed.from),
      toText: pickText(parsed.to),
      toAddresses: pickAddresses(parsed.to),
      ccText: pickText(parsed.cc),
      ccAddresses: pickAddresses(parsed.cc),
      bccText: pickText(parsed.bcc),
      messageId: parsed.messageId || "",
      inReplyTo: parsed.inReplyTo || "",
      emailDate,
      snippet: makeSnippet(bodyForPreview),
      textBody,
      htmlBody,
      attachments,
      attachmentCount: attachments.length,
      parsedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db
      .collection("leads")
      .doc(leadId)
      .collection("emails")
      .doc(docId)
      .set(emailDoc, { merge: true });

    if (fileDoc?.ref) {
      await fileDoc.ref.set(
        {
          emailParsed: true,
          emailSubject: emailDoc.subject,
          emailFrom: emailDoc.fromText,
          emailSnippet: emailDoc.snippet,
          emailParsedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    console.log("Parsed lead email:", { leadId, fileName, docId, attachments: attachments.length });
  }
);
