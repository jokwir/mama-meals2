const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, Timestamp, updateDoc, where } = require("firebase/firestore");
const { deleteObject, getBytes, getDownloadURL, getMetadata, listAll, ref, uploadBytes } = require("firebase/storage");

const projectId = "demo-mama-meals-storage-rules";
const image = new Uint8Array([1, 2, 3, 4]);
let env;

function applicationId() {
  return `App${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function storageFor(userId, verified = true) {
  const context = userId
    ? env.authenticatedContext(userId, { email_verified: verified })
    : env.unauthenticatedContext();
  return context.storage();
}

async function draft(userId = "alice", type = "cook", status = "draft", expired = false) {
  const id = applicationId();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "applications", id), {
      userId, type, status,
      expiresAt: Timestamp.fromMillis(Date.now() + (expired ? -60000 : 3600000))
    });
  });
  return id;
}

function object(storage, userId, id, type, field) {
  return ref(storage, `applications/${userId}/${id}/${type}/${field}`);
}

function upload(storage, userId, id, type, field, bytes = image, contentType = "image/jpeg") {
  return uploadBytes(object(storage, userId, id, type, field), bytes, {
    contentType,
    customMetadata: { ownerId: userId, applicationId: id, field }
  });
}

before(async () => {
  const [firestoreHost, firestorePort] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:18080").split(":");
  const [storageHost, storagePort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:19199").split(":");
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestoreHost,
      port: Number(firestorePort),
      rules: fs.readFileSync(path.join(__dirname, "../firebase/firestore.rules"), "utf8")
    },
    storage: {
      host: storageHost,
      port: Number(storagePort),
      rules: fs.readFileSync(path.join(__dirname, "../firebase/storage.rules"), "utf8")
    }
  });
});

after(async () => {
  await env?.cleanup();
});

test("even verified owners cannot create private application images through Storage", async () => {
  for (const [type, fields] of [
    ["cook", ["identityDocument", "foodSafetyDocument", "foodPhoto"]],
    ["rider", ["identityPhoto", "vehiclePhoto"]]
  ]) {
    const id = await draft("alice", type);
    const storage = storageFor("alice");
    for (const field of fields) {
      await assertFails(upload(storage, "alice", id, type, field));
    }
  }
});

test("private application Storage rejects direct PNG, WebP, and 2 MB uploads", async () => {
  const id = await draft();
  const storage = storageFor("alice");
  await assertFails(upload(storage, "alice", id, "cook", "identityDocument", image, "image/png"));
  await assertFails(upload(storage, "alice", id, "cook", "foodSafetyDocument", image, "image/webp"));
  await assertFails(upload(storage, "alice", id, "cook", "foodPhoto", new Uint8Array(2 * 1024 * 1024)));
});

test("unauthenticated and unverified users cannot upload", async () => {
  const id = await draft();
  await assertFails(upload(storageFor(null), "alice", id, "cook", "identityDocument"));
  await assertFails(upload(storageFor("alice", false), "alice", id, "cook", "identityDocument"));
});

test("one user cannot upload into another user's application", async () => {
  const id = await draft();
  await assertFails(upload(storageFor("bob"), "alice", id, "cook", "identityDocument"));
  await assertFails(upload(storageFor("bob"), "bob", id, "cook", "identityDocument"));
});

test("unregistered, closed, and wrongly typed applications cannot receive files", async () => {
  const storage = storageFor("alice");
  await assertFails(upload(storage, "alice", applicationId(), "cook", "identityDocument"));
  const closed = await draft("alice", "cook", "pending");
  await assertFails(upload(storage, "alice", closed, "cook", "identityDocument"));
  const cook = await draft();
  await assertFails(upload(storage, "alice", cook, "rider", "identityPhoto"));
  const expired = await draft("alice", "cook", "draft", true);
  await assertFails(upload(storage, "alice", expired, "cook", "identityDocument"));
});

test("wrong fields and old or extra paths are denied", async () => {
  const id = await draft();
  const storage = storageFor("alice");
  await assertFails(upload(storage, "alice", id, "cook", "vehiclePhoto"));
  await assertFails(upload(storage, "alice", id, "cook", "otherDocument"));
  await assertFails(uploadBytes(ref(storage, `applications/alice/${id}/identityDocument-id.jpg`), image, { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(storage, `applications/alice/${id}/cook/identityDocument/extra`), image, { contentType: "image/jpeg" }));
});

test("invalid MIME types and oversized files are denied", async () => {
  const id = await draft();
  const storage = storageFor("alice");
  await assertFails(upload(storage, "alice", id, "cook", "identityDocument", image, "application/pdf"));
  await assertFails(upload(storage, "alice", id, "cook", "identityDocument", new Uint8Array(0)));
  await assertFails(upload(storage, "alice", id, "cook", "identityDocument", new Uint8Array(2 * 1024 * 1024 + 1)));
  await assertFails(uploadBytes(object(storage, "alice", id, "cook", "identityDocument"), image, {
    contentType: "image/jpeg", customMetadata: { ownerId: "bob", applicationId: id, field: "identityDocument" }
  }));
});

test("clients cannot create applications or alter owner, type, status, reviewer role, or slots", async () => {
  const id = await draft();
  const owner = env.authenticatedContext("alice", { email: "alice@example.com", email_verified: true }).firestore();
  const other = env.authenticatedContext("bob", { email: "bob@example.com", email_verified: true }).firestore();
  await assertFails(setDoc(doc(owner, "applications", applicationId()), { userId: "alice", type: "cook", status: "draft" }));
  for (const changes of [
    { userId: "bob" }, { type: "rider" }, { status: "approved" }, { status: "pending" }, { reviewedBy: "alice" }
  ]) {
    await assertFails(updateDoc(doc(owner, "applications", id), changes));
  }
  await assertFails(updateDoc(doc(other, "applications", id), { status: "approved" }));
  await assertFails(setDoc(doc(owner, "applicationSlots", "fake"), { userId: "alice", status: "approved" }));
  await assertFails(setDoc(doc(owner, "applicationClaimLocks", "fake"), { token: "mine" }));
  await assertFails(setDoc(doc(owner, "applicationDocumentAccess", "fake"), { reviewedBy: "alice" }));
  await assertFails(setDoc(doc(owner, "applicationUsage", "fake"), { drafts: 0, uploads: 0 }));
  await assertFails(getDoc(doc(owner, "applicationUsage", "fake")));
  await assertFails(getDoc(doc(owner, "applicationDocumentAccess", "fake")));
  await assertFails(setDoc(doc(owner, "users", "alice"), { email: "alice@example.com", roles: ["admin"] }));
  await assertSucceeds(setDoc(doc(owner, "users", "alice"), { email: "alice@example.com", fullName: "Alice" }));
  await assertFails(updateDoc(doc(owner, "users", "alice"), { roles: ["admin"] }));
  await assertFails(updateDoc(doc(owner, "users", "alice"), { roles: ["vendor", "rider"] }));
  await assertSucceeds(getDoc(doc(owner, "applications", id)));
  await assertFails(getDoc(doc(other, "applications", id)));
  await assertSucceeds(getDocs(query(collection(owner, "applications"), where("userId", "==", "alice"), limit(100))));
  await assertFails(getDocs(query(collection(other, "applications"), where("userId", "==", "alice"), limit(100))));
  const unverifiedAdmin = env.authenticatedContext("unverified-admin", { admin: true, email_verified: false }).firestore();
  await assertFails(getDocs(query(collection(unverifiedAdmin, "applications"), limit(10))));
});

test("public menu images remain usable while private application images are unreadable", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "vendors", "vendor1"), { status: "approved", ownerId: "vendor1" });
  });
  const vendor = env.authenticatedContext("vendor1", { vendor: true, email_verified: true }).storage();
  const menu = ref(vendor, "vendors/vendor1/menu/MenuItem123/photo.jpg");
  await assertSucceeds(uploadBytes(menu, image, {
    contentType: "image/jpeg", customMetadata: { ownerId: "vendor1", menuItemId: "MenuItem123" }
  }));
  await assertSucceeds(getMetadata(ref(storageFor(null), menu.fullPath)));
  await assertSucceeds(deleteObject(menu));
  await assertFails(uploadBytes(ref(storageFor("alice"), "vendors/vendor1/menu/MenuItem123/other.jpg"), image, {
    contentType: "image/jpeg", customMetadata: { ownerId: "vendor1", menuItemId: "MenuItem123" }
  }));
});

test("public marketplace queries expose only available items and approved kitchens", async () => {
  const vendorId = `vendor${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const itemId = applicationId();
  const hiddenId = applicationId();
  await env.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "vendors", vendorId), { ownerId: vendorId, status: "approved" });
    await setDoc(doc(firestore, "menuItems", itemId), { vendorOwnerId: vendorId, available: true, name: "Pilau" });
    await setDoc(doc(firestore, "menuItems", hiddenId), { vendorOwnerId: vendorId, available: false, name: "Hidden" });
  });
  const publicDb = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(query(collection(publicDb, "menuItems"), where("available", "==", true), limit(100))));
  await assertSucceeds(getDocs(query(collection(publicDb, "vendors"), where("status", "==", "approved"), limit(100))));
  await assertFails(getDoc(doc(publicDb, "menuItems", hiddenId)));
  await assertFails(getDocs(query(collection(publicDb, "menuItems"), limit(100))));
  const owner = env.authenticatedContext(vendorId, { vendor: true, email_verified: true }).firestore();
  await assertFails(updateDoc(doc(owner, "menuItems", itemId), { price: 1, vendorOwnerId: "other" }));
  await assertFails(setDoc(doc(owner, "menuItems", applicationId()), { vendorOwnerId: vendorId, available: true }));
});

test("only the approved owner can read a vendor order queue", async () => {
  const ownerId = `owner${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const otherId = `other${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const orderId = applicationId();
  await env.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "vendors", ownerId), { status: "approved", ownerId });
    await setDoc(doc(firestore, "vendors", otherId), { status: "approved", ownerId: otherId });
    await setDoc(doc(firestore, "orders", orderId), { vendorOwnerId: ownerId, customerId: "customer" });
  });
  const ownerDb = env.authenticatedContext(ownerId, { vendor: true, email_verified: true }).firestore();
  const otherDb = env.authenticatedContext(otherId, { vendor: true, email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(ownerDb, "orders", orderId)));
  await assertSucceeds(getDocs(query(collection(ownerDb, "orders"), where("vendorOwnerId", "==", ownerId), limit(100))));
  await assertFails(getDoc(doc(otherDb, "orders", orderId)));
  await assertFails(getDocs(query(collection(otherDb, "orders"), where("vendorOwnerId", "==", ownerId), limit(100))));
  await assertFails(updateDoc(doc(ownerDb, "orders", orderId), { status: "Delivered" }));
});

test("a vendor cannot overwrite another approved vendor's menu object", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "vendors", "vendor-owner"), { status: "approved", ownerId: "vendor-owner" });
    await setDoc(doc(context.firestore(), "vendors", "vendor-other"), { status: "approved", ownerId: "vendor-other" });
  });
  const owner = env.authenticatedContext("vendor-owner", { vendor: true, email_verified: true }).storage();
  const other = env.authenticatedContext("vendor-other", { vendor: true, email_verified: true }).storage();
  const path = "vendors/vendor-owner/menu/MenuItemOwner123/photo.jpg";
  await assertSucceeds(uploadBytes(ref(owner, path), image, {
    contentType: "image/jpeg", customMetadata: { ownerId: "vendor-owner", menuItemId: "MenuItemOwner123" }
  }));
  await assertFails(uploadBytes(ref(other, path), image, {
    contentType: "image/jpeg", customMetadata: { ownerId: "vendor-other", menuItemId: "MenuItemOwner123" }
  }));
  await assertSucceeds(getMetadata(ref(owner, path)));
});

test("all client reads, listing, overwrites and deletes are denied", async () => {
  const id = await draft();
  const storage = storageFor("alice");
  const file = object(storage, "alice", id, "cook", "identityDocument");
  await env.withSecurityRulesDisabled(async (context) => {
    await upload(context.storage(), "alice", id, "cook", "identityDocument");
  });
  await assertFails(getMetadata(file));
  await assertFails(getBytes(file));
  await assertFails(getDownloadURL(file));
  await assertFails(getMetadata(object(storageFor("bob"), "alice", id, "cook", "identityDocument")));
  const admin = env.authenticatedContext("reviewer", { email_verified: true, admin: true }).storage();
  await assertFails(getMetadata(object(admin, "alice", id, "cook", "identityDocument")));
  await assertFails(getDownloadURL(object(admin, "alice", id, "cook", "identityDocument")));
  await assertFails(listAll(ref(storage, `applications/alice/${id}`)));
  await assertFails(upload(storage, "alice", id, "cook", "identityDocument"));
  await assertFails(deleteObject(file));
  assert.ok(file.fullPath.endsWith("cook/identityDocument"));
});

test("a client cannot plant a private download token during upload", async () => {
  const id = await draft();
  const storage = storageFor("alice");
  await assertFails(uploadBytes(object(storage, "alice", id, "cook", "identityDocument"), image, {
    contentType: "image/jpeg",
    customMetadata: {
      ownerId: "alice", applicationId: id, field: "identityDocument",
      firebaseStorageDownloadTokens: "attacker-chosen-token"
    }
  }));
  const file = object(storage, "alice", id, "cook", "identityDocument");
  const url = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:19199"}/v0/b/${file.bucket}/o/${encodeURIComponent(file.fullPath)}?alt=media&token=attacker-chosen-token`;
  const response = await fetch(url);
  assert.notEqual(response.status, 200, "A planted token must not expose a private document");
});

test("unapproved vendors cannot upload or read private application files", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "vendors", "unapproved"), { status: "pending", ownerId: "unapproved" });
  });
  const vendor = env.authenticatedContext("unapproved", { vendor: true, email_verified: true }).storage();
  await assertFails(uploadBytes(ref(vendor, "vendors/unapproved/menu/MenuItem123/photo.jpg"), image, {
    contentType: "image/jpeg", customMetadata: { ownerId: "unapproved", menuItemId: "MenuItem123" }
  }));
  const id = await draft();
  await env.withSecurityRulesDisabled(async (context) => {
    await upload(context.storage(), "alice", id, "cook", "identityDocument");
  });
  await assertFails(getBytes(object(vendor, "alice", id, "cook", "identityDocument")));
  await assertFails(listAll(ref(vendor, "applications/alice")));
});

test("admin claims need the server-owned emergency gate and cannot alter authoritative audit or notice", async () => {
  const id = await draft("alice", "cook", "pending");
  const reviewer = env.authenticatedContext("gate-reviewer", { admin: true, email_verified: true }).firestore();
  const applicant = env.authenticatedContext("alice", { email_verified: true }).firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), "adminSecurity", "global"));
  });
  await assertFails(getDoc(doc(reviewer, "applications", id)));
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "adminSecurity", "global"), {
      enabled: true, bootstrapEnabled: true, blockedUids: []
    });
  });
  await assertSucceeds(getDoc(doc(reviewer, "applications", id)));
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "adminSecurity", "global"), {
      enabled: true, bootstrapEnabled: false, blockedUids: ["gate-reviewer"]
    });
  });
  await assertFails(getDoc(doc(reviewer, "applications", id)));
  for (const client of [reviewer, applicant]) {
    await assertFails(setDoc(doc(client, "adminSecurity", "global"), { enabled: true }));
    await assertFails(setDoc(doc(client, "claimAuditEvents", "forged"), { role: "admin" }));
    await assertFails(setDoc(doc(client, "applicationNoticeReceipts", id), { channelCode: "verified-email" }));
    await assertFails(setDoc(doc(client, "applications", id, "events", "forged"), { decision: "approved" }));
  }
});

test("admin profile-image reads obey the emergency gate and UID block", async () => {
  const path = "users/alice/profile/emergency-check.jpg";
  await env.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), path), image, { contentType: "image/jpeg" });
    await setDoc(doc(context.firestore(), "adminSecurity", "global"), {
      enabled: false, bootstrapEnabled: false, blockedUids: []
    });
  });
  const owner = storageFor("alice");
  const admin = env.authenticatedContext("photo-reviewer", { admin: true, email_verified: true }).storage();
  const unverified = env.authenticatedContext("unverified-photo-reviewer", { admin: true, email_verified: false }).storage();
  await assertSucceeds(getMetadata(ref(owner, path)));
  await assertFails(getMetadata(ref(admin, path)));
  await assertFails(getMetadata(ref(unverified, path)));
  await assertFails(getMetadata(ref(storageFor(null), path)));

  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "adminSecurity", "global"), {
      enabled: true, bootstrapEnabled: false, blockedUids: []
    });
  });
  await assertSucceeds(getMetadata(ref(admin, path)));
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "adminSecurity", "global"), {
      enabled: true, bootstrapEnabled: false, blockedUids: ["photo-reviewer"]
    });
  });
  await assertFails(getMetadata(ref(admin, path)));
  await assertSucceeds(getMetadata(ref(owner, path)));
});

test("stale partner claims cannot read orders after trusted profile suspension", async () => {
  const orderId = `Order${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const vendorId = `vendor${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const riderId = `rider${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await env.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "vendors", vendorId), { status: "approved", ownerId: vendorId });
    await setDoc(doc(firestore, "riders", riderId), { status: "approved", ownerId: riderId });
    await setDoc(doc(firestore, "orders", orderId), {
      customerId: "other-customer", vendorOwnerId: vendorId, assignedRiderId: riderId
    });
  });
  const vendor = env.authenticatedContext(vendorId, { vendor: true }).firestore();
  const rider = env.authenticatedContext(riderId, { rider: true }).firestore();
  await assertSucceeds(getDoc(doc(vendor, "orders", orderId)));
  await assertSucceeds(getDoc(doc(rider, "orders", orderId)));
  await env.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await updateDoc(doc(firestore, "vendors", vendorId), { status: "suspended" });
    await updateDoc(doc(firestore, "riders", riderId), { status: "suspended" });
  });
  await assertFails(getDoc(doc(vendor, "orders", orderId)));
  await assertFails(getDoc(doc(rider, "orders", orderId)));
});
