const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createRequire } = require("node:module");
const { randomUUID } = require("node:crypto");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
const { getStorage } = functionsRequire("firebase-admin/storage");
const sharp = functionsRequire("sharp");
const workflow = require("../functions/application-workflow");
const { uploadPrivateImage, privateMetadata, validPrivateImageDimensions } = require("../functions/private-upload");
const { purgeSubmittedFiles } = require("../functions/retention-workflow");

const projectId = "demo-mama-meals-storage-rules";
let app;
let db;
let bucket;
let jpeg;

function caller() {
  return { uid: `private-${randomUUID().replace(/-/g, "")}`, token: { email_verified: true } };
}

before(async () => {
  app = initializeApp({ projectId, storageBucket: `${projectId}.firebasestorage.app` }, `private-${process.pid}`);
  db = getFirestore(app);
  bucket = getStorage(app).bucket();
  jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#ff6b35" } }).jpeg().toBuffer();
});

after(async () => {
  await deleteApp(app);
});

test("trusted upload has no public token URL and replay cannot replace bytes", async () => {
  const user = caller();
  const draft = await workflow.startDraft(db, bucket, user, "cook", { fullName: "Test" });
  const input = {
    applicationId: draft.applicationId, field: "identityDocument",
    contentType: "image/jpeg", originalName: "test-id.jpg", base64: jpeg.toString("base64")
  };
  assert.equal((await uploadPrivateImage(db, bucket, user, input)).status, "uploaded");
  assert.equal((await uploadPrivateImage(db, bucket, user, input)).status, "uploaded");
  const path = workflow.objectPath(user.uid, draft.applicationId, "cook", "identityDocument");
  const [metadata] = await bucket.file(path).getMetadata();
  assert.equal(privateMetadata(metadata), true);
  assert.equal(metadata.metadata.ownerId, user.uid);
  const url = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:19199"}/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=client-chosen-token`;
  assert.notEqual((await fetch(url)).status, 200);
  const different = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#4caf50" } }).jpeg().toBuffer();
  await assert.rejects(uploadPrivateImage(db, bucket, user, { ...input, base64: different.toString("base64") }), /different file/);
  await assert.rejects(uploadPrivateImage(db, bucket, { uid: "intruder", token: { email_verified: true } }, input), /does not belong/);
  await assert.rejects(uploadPrivateImage(db, bucket, { uid: "intruder", token: { email_verified: true } },
    { ...input, uid: user.uid, userId: user.uid }), /does not belong/);
  await assert.rejects(uploadPrivateImage(db, bucket, { uid: user.uid, token: { email_verified: false } }, input), /verify your email/);
  await assert.rejects(uploadPrivateImage(db, bucket, user, { ...input, field: "vehiclePhoto" }), /not required/);
  await workflow.submitDraft(db, user, draft.applicationId, async () => [], "REF-PRIVATE");
  await assert.rejects(uploadPrivateImage(db, bucket, user, input), /no longer open/);
  await db.doc(`applications/${draft.applicationId}`).update({
    status: "approved",
    documents: [{ field: "identityDocument", path, generation: String(metadata.generation) }],
    documentCleanupPending: true,
    noticeConfirmedAt: new Date(Date.now() - 20 * 86400000),
    documentsPurgeAt: new Date(Date.now() - 1000)
  });
  assert.equal(await purgeSubmittedFiles(db, bucket, draft.applicationId), true);
  await assert.rejects(bucket.file(path).getMetadata(), (error) => error.code === 404);
  await assert.rejects(uploadPrivateImage(db, bucket, user, input), /no longer open/);
  await assert.rejects(bucket.file(path).getMetadata(), (error) => error.code === 404);
});

test("private upload retries are atomically capped before image processing", async () => {
  const user = caller();
  const draft = await workflow.startDraft(db, bucket, user, "cook", {});
  const input = { applicationId: draft.applicationId, field: "identityDocument",
    contentType: "image/jpeg", base64: jpeg.toString("base64") };
  const original = process.env.APPLICATION_UPLOADS_PER_DRAFT;
  process.env.APPLICATION_UPLOADS_PER_DRAFT = "2";
  try {
    assert.equal((await uploadPrivateImage(db, bucket, user, input)).status, "uploaded");
    assert.equal((await uploadPrivateImage(db, bucket, user, input)).status, "uploaded");
    await assert.rejects(uploadPrivateImage(db, bucket, user, input), /Too many upload attempts/);
    assert.equal((await db.doc(`applications/${draft.applicationId}`).get()).data().uploadAttempts, 2);
    assert.equal((await workflow.usageRef(db, user.uid).get()).data().uploads, 2);
  } finally {
    if (original === undefined) delete process.env.APPLICATION_UPLOADS_PER_DRAFT;
    else process.env.APPLICATION_UPLOADS_PER_DRAFT = original;
  }
});

test("private image dimensions cap decompression size and reject multi-frame files", () => {
  assert.equal(validPrivateImageDimensions({ width: 800, height: 600, pages: 1 }, 40000000), true);
  assert.equal(validPrivateImageDimensions({ width: 20000, height: 15000, pages: 1 }, 40000000), false);
  assert.equal(validPrivateImageDimensions({ width: 800, height: 600, pages: 2 }, 40000000), false);
});

test("trusted upload validates type, bytes, dimensions and size before writing", async () => {
  const user = caller();
  const draft = await workflow.startDraft(db, bucket, user, "rider", {});
  const input = {
    applicationId: draft.applicationId, field: "identityPhoto",
    contentType: "image/jpeg", base64: jpeg.toString("base64")
  };
  await assert.rejects(uploadPrivateImage(db, bucket, user, { ...input, contentType: "application/pdf" }), /Choose a JPG/);
  await assert.rejects(uploadPrivateImage(db, bucket, user, { ...input, base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") }), /over 2MB/);
  await assert.rejects(uploadPrivateImage(db, bucket, user, { ...input, base64: Buffer.from("not an image").toString("base64") }), /could not be read/);
  const small = await sharp({ create: { width: 400, height: 300, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(uploadPrivateImage(db, bucket, user, { ...input, contentType: "image/png", base64: small.toString("base64") }), /at least 800x600/);
  await assert.rejects(uploadPrivateImage(db, bucket, user, { ...input, contentType: "image/png" }), /at least 800x600/);
  assert.equal((await bucket.getFiles({ prefix: `applications/${user.uid}/${draft.applicationId}/` }))[0].length, 0);
});

test("simultaneous identical upload retries resolve to one private object", async () => {
  const user = caller();
  const draft = await workflow.startDraft(db, bucket, user, "rider", {});
  const input = {
    applicationId: draft.applicationId, field: "identityPhoto",
    contentType: "image/jpeg", base64: jpeg.toString("base64")
  };
  const responses = await Promise.all([
    uploadPrivateImage(db, bucket, user, input),
    uploadPrivateImage(db, bucket, user, input)
  ]);
  assert.deepEqual(responses.map((response) => response.status), ["uploaded", "uploaded"]);
  const [files] = await bucket.getFiles({ prefix: `applications/${user.uid}/${draft.applicationId}/` });
  assert.equal(files.length, 1);
});

test("an upload finishing after draft cancellation is removed by exact generation", async () => {
  const user = caller();
  const draft = await workflow.startDraft(db, bucket, user, "rider", {});
  const path = workflow.objectPath(user.uid, draft.applicationId, "rider", "identityPhoto");
  const interruptedBucket = {
    file(name, options) {
      const file = bucket.file(name, options);
      if (options) return file;
      return {
        getMetadata: (...args) => file.getMetadata(...args),
        async save(...args) {
          await workflow.cancelDraft(db, bucket, user, draft.applicationId);
          return file.save(...args);
        }
      };
    }
  };
  await assert.rejects(uploadPrivateImage(db, interruptedBucket, user, {
    applicationId: draft.applicationId, field: "identityPhoto",
    contentType: "image/jpeg", base64: jpeg.toString("base64")
  }), /closed during the upload/);
  await assert.rejects(bucket.file(path).getMetadata(), (error) => error.code === 404);
});

test("verified admin preview reads only the submitted private object generation", async () => {
  const user = caller();
  const draft = await workflow.startDraft(db, bucket, user, "cook", {});
  const field = "identityDocument";
  await uploadPrivateImage(db, bucket, user, {
    applicationId: draft.applicationId, field,
    contentType: "image/jpeg", base64: jpeg.toString("base64")
  });
  const path = workflow.objectPath(user.uid, draft.applicationId, "cook", field);
  const [metadata] = await bucket.file(path).getMetadata();
  await workflow.submitDraft(db, user, draft.applicationId, async () => [{
    field, path, generation: String(metadata.generation)
  }], "REF-PREVIEW-REAL");
  const admin = { uid: "verified-admin", token: { admin: true, email_verified: true } };
  const response = await workflow.readApplicationDocument(db, bucket, admin, draft.applicationId, field);
  assert.deepEqual(Buffer.from(response.base64, "base64"), jpeg);
  await assert.rejects(workflow.readApplicationDocument(db, bucket, user, draft.applicationId, field), /Authorized admin/);
  const audits = await db.collection("applicationDocumentAccess").where("applicationId", "==", draft.applicationId).get();
  assert.equal(audits.size, 1);
});

test("concurrent vendors cannot claim the same public menu item", async () => {
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId, storageBucket: bucket.name });
  const callables = require("../functions/index.js");
  const itemId = `Menu${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const vendors = [caller().uid, caller().uid];
  const requests = [];
  for (const uid of vendors) {
    await db.doc(`vendors/${uid}`).set({ userId: uid, ownerId: uid, status: "approved" });
    const imagePath = `vendors/${uid}/menu/${itemId}/photo.jpg`;
    await bucket.file(imagePath).save(jpeg, {
      metadata: { contentType: "image/jpeg", metadata: { ownerId: uid, menuItemId: itemId } }
    });
    requests.push({ auth: { uid, token: { vendor: true, email_verified: true } },
      data: { item: { id: itemId, name: "Test dish", description: "Synthetic food photo for testing",
        price: 200, category: "Main Meals", imagePath,
        imageUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(imagePath)}?alt=media` } } });
  }
  const results = await Promise.allSettled(requests.map((request) => callables.upsertVendorMenuItem.run(request)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const saved = (await db.doc(`menuItems/${itemId}`).get()).data();
  assert.ok(vendors.includes(saved.vendorOwnerId));
  const loser = requests.find((request) => request.auth.uid !== saved.vendorOwnerId);
  await assert.rejects(callables.upsertVendorMenuItem.run(loser), /do not own this menu item/);
});

test("menu publishing validates image bytes and supports existing untagged menu photos", async () => {
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId, storageBucket: bucket.name });
  const callables = require("../functions/index.js");
  const uid = caller().uid;
  const itemId = `Menu${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await db.doc(`vendors/${uid}`).set({ userId: uid, ownerId: uid, status: "approved" });
  const imagePath = `vendors/${uid}/menu/${itemId}/photo.jpg`;
  const request = {
    auth: { uid, token: { vendor: true, email_verified: true } },
    data: { item: { id: itemId, name: "Test dish", description: "Synthetic food photo for testing",
      price: 200, category: "Main Meals", imagePath,
      imageUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(imagePath)}?alt=media` } }
  };
  // A client-provided food marker is not evidence of image content or even valid image bytes.
  await bucket.file(imagePath).save(Buffer.from("not an image"), {
    metadata: { contentType: "image/jpeg", metadata: { ownerId: uid, menuItemId: itemId, assetType: "food" } }
  });
  await assert.rejects(callables.upsertVendorMenuItem.run(request), /not a readable/);
  assert.equal((await db.doc(`menuItems/${itemId}`).get()).exists, false);
  await bucket.file(imagePath).save(jpeg, {
    metadata: { contentType: "image/jpeg", metadata: { ownerId: uid, menuItemId: itemId } }
  });
  await callables.upsertVendorMenuItem.run(request);
  request.data.item.price = 250;
  await callables.upsertVendorMenuItem.run(request);
  const saved = (await db.doc(`menuItems/${itemId}`).get()).data();
  assert.equal(saved.price, 250);
  assert.equal(saved.vendorOwnerId, uid);
});
