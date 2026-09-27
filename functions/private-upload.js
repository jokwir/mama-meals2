const crypto = require("node:crypto");
const sharp = require("sharp");
const { HttpsError } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const { objectPath, fieldsByType, requireDraft, slotRef, usageRef } = require("./application-workflow");
const { runtimeConfig } = require("./runtime-config");

const maxBytes = 2 * 1024 * 1024;
const types = new Map([["image/jpeg", "jpeg"], ["image/png", "png"], ["image/webp", "webp"]]);

function privateMetadata(metadata) {
  return !metadata?.downloadTokens && !metadata?.metadata?.firebaseStorageDownloadTokens;
}

function validPrivateImageDimensions(image, maxPixels) {
  const ratio = image.width / image.height;
  return Number.isSafeInteger(image.width) && Number.isSafeInteger(image.height)
    && image.width >= 800 && image.height >= 600
    && image.width * image.height <= maxPixels && (image.pages || 1) === 1
    && (Math.abs(ratio - 1) < 0.04 || Math.abs(ratio - 4 / 3) < 0.04);
}

async function uploadPrivateImage(db, bucket, caller, input) {
  if (!caller?.uid || caller.token?.email_verified !== true) {
    throw new HttpsError("permission-denied", "Sign in and verify your email before uploading.");
  }
  const { applicationId, field, contentType, base64 } = input || {};
  if (!/^[A-Za-z0-9]{10,40}$/.test(String(applicationId || ""))
      || typeof field !== "string" || !types.has(contentType)
      || typeof base64 !== "string" || base64.length > Math.ceil(maxBytes / 3) * 4 + 8
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new HttpsError("invalid-argument", "Choose a JPG, PNG, or WebP file under 2MB.");
  }
  const ref = db.doc(`applications/${applicationId}`);
  const usage = usageRef(db, caller.uid);
  const config = runtimeConfig();
  const day = new Date().toISOString().slice(0, 10);
  await db.runTransaction(async (transaction) => {
    const [snapshot, rateSnapshot] = await Promise.all([transaction.get(ref), transaction.get(usage)]);
    const application = snapshot.data();
    requireDraft(application, caller.uid, Date.now());
    if (!fieldsByType[application.type]?.includes(field)) {
      throw new HttpsError("invalid-argument", "This image is not required for this application.");
    }
    const slot = await transaction.get(slotRef(db, caller.uid, application.type));
    if (slot.data()?.applicationId !== applicationId || slot.data()?.status !== "draft") {
      throw new HttpsError("failed-precondition", "This application draft has been replaced.");
    }
    const rate = rateSnapshot.data()?.day === day ? rateSnapshot.data() : { drafts: 0, uploads: 0 };
    if (rate.uploads >= config.uploadsPerDay || (application.uploadAttempts || 0) >= config.uploadsPerDraft) {
      throw new HttpsError("resource-exhausted", "Too many upload attempts. Try again later or contact support.");
    }
    transaction.set(usage, { day, drafts: rate.drafts || 0, uploads: rate.uploads + 1,
      updatedAt: FieldValue.serverTimestamp() });
    transaction.update(ref, { uploadAttempts: FieldValue.increment(1) });
  });
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > maxBytes || buffer.toString("base64") !== base64) {
    throw new HttpsError("invalid-argument", "The selected file is invalid or over 2MB.");
  }
  const snapshot = await ref.get();
  const application = snapshot.data();
  requireDraft(application, caller.uid, Date.now());
  if (!fieldsByType[application.type]?.includes(field)) {
    throw new HttpsError("invalid-argument", "This image is not required for this application.");
  }
  const slot = await slotRef(db, caller.uid, application.type).get();
  if (slot.data()?.applicationId !== applicationId || slot.data()?.status !== "draft") {
    throw new HttpsError("failed-precondition", "This application draft has been replaced.");
  }

  const path = objectPath(caller.uid, applicationId, application.type, field);
  const file = bucket.file(path);
  const digest = crypto.createHash("sha256").update(buffer).digest("hex");
  const matchesExisting = (metadata) => privateMetadata(metadata)
    && metadata?.metadata?.sha256 === digest
    && metadata.metadata.ownerId === caller.uid
    && metadata.metadata.applicationId === applicationId
    && metadata.metadata.field === field;
  const existing = await file.getMetadata().then(([metadata]) => metadata).catch((error) => {
    if (error.code === 404) return null;
    throw error;
  });
  if (existing) {
    if (!matchesExisting(existing)) {
      throw new HttpsError("already-exists", "A different file is already saved for this field. Start a new application to replace it.");
    }
    return { applicationId, field, status: "uploaded" };
  }

  const image = await sharp(buffer, { failOn: "warning" }).metadata().catch(() => {
    throw new HttpsError("invalid-argument", "The selected image could not be read.");
  });
  if (image.format !== types.get(contentType) || !validPrivateImageDimensions(image, config.imageMaxPixels)) {
    throw new HttpsError("invalid-argument", "Use a clear image at least 800x600px with a 1:1 or 4:3 shape.");
  }

  const originalName = String(input.originalName || "").replace(/[\r\n]/g, " ").slice(0, 150);
  try {
    await file.save(buffer, {
      resumable: false,
      validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType,
        cacheControl: "private, no-store, max-age=0",
        metadata: { ownerId: caller.uid, applicationId, field, sha256: digest, originalName }
      }
    });
  } catch (error) {
    if (error.code === 412) {
      const winner = await file.getMetadata().then(([metadata]) => metadata);
      if (matchesExisting(winner)) return { applicationId, field, status: "uploaded" };
      throw new HttpsError("already-exists", "A different file is already saved for this field. Start a new application to replace it.");
    }
    throw error;
  }
  const [saved] = await file.getMetadata();
  if (!privateMetadata(saved)) {
    await bucket.file(path, { generation: saved.generation }).delete({ ignoreNotFound: true });
    throw new HttpsError("internal", "The private upload could not be secured.");
  }
  const [latest, latestSlot] = await Promise.all([ref.get(), slotRef(db, caller.uid, application.type).get()]);
  const current = latest.data();
  const stillDraft = current?.userId === caller.uid && current.status === "draft"
    && current.expiresAt?.toMillis() > Date.now()
    && latestSlot.data()?.applicationId === applicationId && latestSlot.data()?.status === "draft";
  const submitted = current?.userId === caller.uid && current.status === "pending"
    && current.documents?.some((document) => document.field === field && document.path === path
      && String(document.generation) === String(saved.generation));
  if (!stillDraft && !submitted) {
    await bucket.file(path, { generation: saved.generation }).delete({ ignoreNotFound: true });
    throw new HttpsError("failed-precondition", "This application draft closed during the upload. Start a new application.");
  }
  return { applicationId, field, status: "uploaded" };
}

module.exports = { uploadPrivateImage, privateMetadata, validPrivateImageDimensions };
