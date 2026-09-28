const crypto = require("node:crypto");
const sharp = require("sharp");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const applicationWorkflow = require("./application-workflow");
const { uploadPrivateImage, privateMetadata, validPrivateImageDimensions } = require("./private-upload");
const reviewWorkflow = require("./review-workflow");
const retentionWorkflow = require("./retention-workflow");
const protection = require("./application-protection");
const recordRetention = require("./record-retention");
const auditRetention = require("./audit-retention");
const adminSecurity = require("./admin-security");
const { createMaintenanceHandler, maintenanceInvoker } = require("./maintenance-http");
const { runtimeConfig } = require("./runtime-config");

initializeApp();
setGlobalOptions({ region: runtimeConfig().region, maxInstances: 10 });

const db = getFirestore();
const auth = getAuth();
const storage = getStorage();
const initialAdminUid = "39W2VXumSlcBHja4Wjv5QPBp2ek1";
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxUploadBytes = 2 * 1024 * 1024;
const allowedPaymentMethods = new Set(["M-Pesa", "Cash on Delivery"]);
const applicationDocumentFields = applicationWorkflow.fieldsByType;
const applicationFieldRules = {
  cook: {
    allowed: ["fullName", "businessName", "phone", "email", "location", "serviceArea", "foodType", "experience"],
    required: ["fullName", "businessName", "phone", "email", "location", "serviceArea", "foodType", "experience"]
  },
  rider: {
    allowed: ["fullName", "phone", "email", "location", "vehicleType", "registrationPlate", "experience", "availability"],
    required: ["fullName", "phone", "email", "location", "vehicleType", "registrationPlate", "availability"]
  }
};

function requiredRetentionPolicy() {
  let policy;
  try {
    policy = retentionWorkflow.configuredRetentionDays();
  } catch {
    throw new HttpsError("failed-precondition", "Application document retention policy is invalid.");
  }
  if (retentionWorkflow.missingRetentionClasses(policy).length) {
    throw new HttpsError("failed-precondition", "Application document retention policy is not configured.");
  }
  return policy;
}

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in to continue.");
  }
  return request.auth;
}

function requireRole(request, role) {
  const caller = requireAuth(request);
  if (caller.token?.[role] !== true) {
    throw new HttpsError("permission-denied", `${role} access is required.`);
  }
  if (role === "admin" && caller.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your admin email before reviewing applications.");
  }
  return caller;
}

async function requireApprovedPartner(request, role) {
  const caller = requireRole(request, role);
  const collectionName = role === "vendor" ? "vendors" : "riders";
  const snapshot = await db.doc(`${collectionName}/${caller.uid}`).get();
  if (!snapshot.exists || snapshot.data().status !== "approved") {
    throw new HttpsError("permission-denied", `An approved ${role} profile is required.`);
  }
  return caller;
}

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new HttpsError("invalid-argument", "Application fields are required.");
  }
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key]) => /^[a-zA-Z][a-zA-Z0-9]{0,49}$/.test(key))
      .map(([key, value]) => [key, typeof value === "boolean" ? value : cleanText(value, 1000)])
  );
}

function validateApplicationFields(type, fields, caller) {
  const rules = applicationFieldRules[type];
  const cleaned = cleanFields(fields);
  if (!rules || Object.keys(cleaned).some((key) => !rules.allowed.includes(key))) {
    throw new HttpsError("invalid-argument", "Application fields are not valid for this role.");
  }
  if (rules.required.some((key) => cleanText(cleaned[key], 1000).length < 2)) {
    throw new HttpsError("invalid-argument", "Complete every required application field.");
  }
  if (cleanText(cleaned.phone, 40).replace(/\D/g, "").length < 7) {
    throw new HttpsError("invalid-argument", "Enter a valid application phone number.");
  }
  if (cleanText(cleaned.email, 320).toLowerCase() !== cleanText(caller.token.email, 320).toLowerCase()) {
    throw new HttpsError("invalid-argument", "Use the verified email address on your Mama Meals account.");
  }
  cleaned.email = cleanText(caller.token.email, 320).toLowerCase();
  return cleaned;
}

function formatDateKey(date = new Date()) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function applicationReference(type, date = new Date()) {
  return `APP-${type === "cook" ? "CK" : "RD"}-${formatDateKey(date)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

function validImageDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 800 || height < 600) return false;
  const ratio = width / height;
  return Math.abs(ratio - 1) < 0.04 || Math.abs(ratio - (4 / 3)) < 0.04;
}

async function verifiedDocuments(uid, applicationId, type) {
  const expectedFields = applicationDocumentFields[type] || [];
  return Promise.all(expectedFields.map(async (field) => {
    const path = applicationWorkflow.objectPath(uid, applicationId, type, field);
    const file = storage.bucket().file(path);
    const [metadata] = await file.getMetadata().catch(() => {
      throw new HttpsError("not-found", "A required application image was not found. Upload it again.");
    });
    const size = Number(metadata.size || 0);
    if (!allowedImageTypes.has(metadata.contentType) || size <= 0 || size > maxUploadBytes) {
      throw new HttpsError("invalid-argument", "Application files must be JPG, PNG, or WebP images under 2MB.");
    }
    if (metadata.metadata?.ownerId !== uid || metadata.metadata?.applicationId !== applicationId || metadata.metadata?.field !== field) {
      throw new HttpsError("permission-denied", "Application upload ownership could not be verified.");
    }
    if (!privateMetadata(metadata) || !/^\d+$/.test(String(metadata.generation || ""))) {
      throw new HttpsError("failed-precondition", "Application document metadata is unsafe or incomplete.");
    }
    const [buffer] = await file.download();
    if (buffer.length !== size
        || metadata.metadata?.sha256 !== crypto.createHash("sha256").update(buffer).digest("hex")) {
      throw new HttpsError("failed-precondition", "Application document integrity check failed.");
    }
    const image = await sharp(buffer, { failOn: "warning" }).metadata().catch(() => {
      throw new HttpsError("invalid-argument", "A selected application file is not a readable JPG, PNG, or WebP image.");
    });
    if (!new Set(["jpeg", "png", "webp"]).has(image.format)
        || metadata.contentType !== `image/${image.format}`
        || !validPrivateImageDimensions(image, runtimeConfig().imageMaxPixels)) {
      throw new HttpsError("invalid-argument", "Application images must be at least 800x600px and use a 1:1 or 4:3 aspect ratio.");
    }
    return {
      field,
      name: cleanText(metadata.metadata?.originalName, 150) || field,
      path,
      type: metadata.contentType,
      size,
      generation: String(metadata.generation || ""),
      width: image.width,
      height: image.height
    };
  }));
}

exports.bootstrapAdmin = onCall(async (request) => {
  const caller = requireAuth(request);
  await adminSecurity.requireBootstrapAccess(db, caller, initialAdminUid);
  const intent = db.doc(`claimAuditEvents/bootstrap-${caller.uid}-intent`);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(intent);
    if (!existing.exists) transaction.create(intent, {
      affectedUid: caller.uid, role: "admin", operation: "grant", actorUid: caller.uid,
      source: "bootstrap-allowlist", result: "reconciliation-pending",
      reasonCode: "initial-bootstrap", at: FieldValue.serverTimestamp()
    });
  });
  await reviewWorkflow.withClaimLock(db, caller.uid, async () => {
    await adminSecurity.requireBootstrapAccess(db, caller, initialAdminUid);
    const current = await auth.getUser(caller.uid);
    if (current.customClaims?.admin !== true) {
      await auth.setCustomUserClaims(caller.uid, { ...(current.customClaims || {}), customer: true, admin: true });
    }
  });
  await db.runTransaction(async (transaction) => {
    const applied = db.doc(`claimAuditEvents/bootstrap-${caller.uid}-applied`);
    const existing = await transaction.get(applied);
    if (!existing.exists) transaction.create(applied, {
      affectedUid: caller.uid, role: "admin", operation: "grant", actorUid: caller.uid,
      source: "bootstrap-allowlist", result: "applied", reasonCode: "initial-bootstrap",
      at: FieldValue.serverTimestamp()
    });
    transaction.set(db.doc(`users/${caller.uid}`), {
      roles: FieldValue.arrayUnion("customer", "admin"),
      adminBootstrappedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return { ok: true, roles: ["customer", "admin"] };
});

exports.startPartnerApplication = onCall(async (request) => {
  const caller = requireAuth(request);
  if (caller.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email before starting an application.");
  }
  requiredRetentionPolicy();
  const type = request.data?.type;
  const fields = validateApplicationFields(type, request.data?.fields, caller);
  return applicationWorkflow.startDraft(db, storage.bucket(), caller, type, fields);
});

exports.submitPartnerApplication = onCall(async (request) => {
  const caller = requireAuth(request);
  if (caller.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email before submitting an application.");
  }
  requiredRetentionPolicy();
  const { applicationId } = request.data || {};
  if (!/^[A-Za-z0-9]{10,40}$/.test(String(applicationId || ""))) {
    throw new HttpsError("invalid-argument", "Invalid application identifier.");
  }
  const draft = await db.doc(`applications/${applicationId}`).get();
  if (!draft.exists || draft.data().userId !== caller.uid) {
    throw new HttpsError("permission-denied", "This application does not belong to your account.");
  }
  const reference = applicationReference(draft.data().type);
  return applicationWorkflow.submitDraft(db, caller, applicationId, (uid, id, type) => verifiedDocuments(uid, id, type), reference);
});

exports.uploadApplicationDocument = onCall(async (request) => {
  const caller = requireAuth(request);
  requiredRetentionPolicy();
  return uploadPrivateImage(db, storage.bucket(), caller, request.data);
});

exports.cancelPartnerApplication = onCall(async (request) => {
  const caller = requireAuth(request);
  const applicationId = cleanText(request.data?.applicationId, 80);
  if (!/^[A-Za-z0-9]{10,40}$/.test(applicationId)) throw new HttpsError("invalid-argument", "Invalid application identifier.");
  return applicationWorkflow.cancelDraft(db, storage.bucket(), caller, applicationId);
});

async function runApplicationMaintenance() {
  const tasks = [
    applicationWorkflow.cleanupAbandonedDrafts(db, storage.bucket()),
    applicationWorkflow.flagPendingApplications(db),
    protection.flagOverdueLegalHolds(db),
    retentionWorkflow.cleanupSubmittedDocuments(db, storage.bucket()),
    retentionWorkflow.minimizeApplicationRecords(db),
    recordRetention.purgeDueApplicationRecords(db),
    auditRetention.purgeDueDocumentAccessEvents(db),
    auditRetention.purgeDueClaimAuditEvents(db),
    auditRetention.purgeDueResolvedFailureEvents(db)
  ];
  try {
    const retentionDays = requiredRetentionPolicy();
    tasks.push(reviewWorkflow.reconcileReviews(db, auth, retentionDays));
  } catch (error) {
    tasks.push(Promise.reject(error));
  }
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((task) => task.status === "rejected");
  if (failures.length) {
    failures.forEach((task) => console.error("Scheduled application maintenance failed", task.reason));
    throw new Error(`${failures.length} application maintenance task(s) will require retry.`);
  }
}

// Cloud Scheduler is unavailable in africa-south1. A separately configured,
// IAM-authenticated HTTP job can invoke this private Johannesburg endpoint.
exports.cleanupAbandonedApplications = onRequest({
  invoker: maintenanceInvoker(), maxInstances: 1, concurrency: 1, timeoutSeconds: 120
}, createMaintenanceHandler(runApplicationMaintenance));

exports.getApplicationDocument = onCall(async (request) => {
  const caller = requireRole(request, "admin");
  await adminSecurity.requireAdminAccess(db, caller);
  return applicationWorkflow.readApplicationDocument(db, storage.bucket(), caller,
    request.data?.applicationId, request.data?.field);
});

exports.reviewPartnerApplication = onCall(async (request) => {
  const caller = requireRole(request, "admin");
  await adminSecurity.requireAdminAccess(db, caller);
  const retentionDays = requiredRetentionPolicy();
  const applicationId = cleanText(request.data?.applicationId, 80);
  const decision = request.data?.decision;
  await reviewWorkflow.reserveReview(db, caller, applicationId, decision, request.data?.reasonCode);
  return reviewWorkflow.finishReview(db, auth, applicationId, retentionDays);
});

exports.confirmApplicationNotice = onCall(async (request) => {
  const caller = requireRole(request, "admin");
  await adminSecurity.requireAdminAccess(db, caller);
  return protection.confirmNotice(db, caller, request.data?.applicationId, request.data?.methodCode);
});

exports.requestApplicationAppeal = onCall(async (request) => {
  const caller = requireAuth(request);
  return protection.requestAppeal(db, caller, request.data?.applicationId);
});

exports.resolveApplicationAppeal = onCall(async (request) => {
  const caller = requireRole(request, "admin");
  await adminSecurity.requireAdminAccess(db, caller);
  return protection.finishAppeal(db, caller, request.data?.applicationId, request.data?.outcomeCode);
});

exports.recommendApplicationReversal = onCall(async (request) => {
  const caller = requireRole(request, "admin");
  await adminSecurity.requireAdminAccess(db, caller);
  return reviewWorkflow.recommendAppealReversal(db, caller,
    request.data?.applicationId, request.data?.reasonCode);
});

exports.confirmApplicationReversal = onCall(async (request) => {
  const caller = requireRole(request, "admin");
  await adminSecurity.requireAdminAccess(db, caller);
  return reviewWorkflow.confirmAppealReversal(db, auth, caller,
    request.data?.applicationId, request.data?.reasonCode, requiredRetentionPolicy());
});

exports.setApplicationDispute = onCall(async (request) => {
  const caller = requireRole(request, "admin");
  await adminSecurity.requireAdminAccess(db, caller);
  return protection.setDispute(db, caller, request.data?.applicationId, request.data?.action, request.data?.reasonCode);
});

exports.setApplicationLegalHold = onCall(async (request) => {
  const caller = requireRole(request, "admin");
  await adminSecurity.requireAdminAccess(db, caller);
  return protection.setLegalHold(db, caller, request.data?.applicationId, request.data?.action, request.data?.options);
});

async function resolveOrderItems(items, transaction) {
  if (!Array.isArray(items) || !items.length || items.length > 20) {
    throw new HttpsError("invalid-argument", "An order must contain between 1 and 20 items.");
  }
  const resolved = [];
  const vendors = new Map();
  for (const item of items) {
    const quantity = Math.max(1, Math.min(50, Math.trunc(Number(item.quantity) || 1)));
    const menuItemId = cleanText(item.menuItemId, 80);
    const addOns = Array.isArray(item.addOns) ? item.addOns.map((value) => cleanText(value, 80)) : [];
    if (!/^[A-Za-z0-9_-]{10,80}$/.test(menuItemId) || addOns.length) {
      throw new HttpsError("invalid-argument", "Order items must be published by an approved vendor.");
    }
    const snapshot = await transaction.get(db.doc(`menuItems/${menuItemId}`));
    if (!snapshot.exists || snapshot.data().available !== true) {
      throw new HttpsError("failed-precondition", "A selected menu item is no longer available.");
    }
    const menuItem = snapshot.data();
    const name = cleanText(menuItem.name, 120);
    const price = Number(menuItem.price);
    const image = cleanText(menuItem.imageUrl || menuItem.imagePath, 500);
    const vendorOwnerId = cleanText(menuItem.vendorOwnerId, 128);
    if (!vendorOwnerId) throw new HttpsError("failed-precondition", "The selected menu item has no approved vendor.");
    if (!vendors.has(vendorOwnerId)) {
      const vendorSnapshot = await transaction.get(db.doc(`vendors/${vendorOwnerId}`));
      if (!vendorSnapshot.exists || vendorSnapshot.data().status !== "approved"
          || vendorSnapshot.data().ownerId !== vendorOwnerId || vendorSnapshot.data().acceptingOrders !== true) {
        throw new HttpsError("failed-precondition", "The selected vendor is not accepting orders right now.");
      }
      vendors.set(vendorOwnerId, true);
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new HttpsError("invalid-argument", `Price could not be verified for ${name || "an item"}.`);
    }
    resolved.push({ menuItemId, name, baseName: name, addOns: [], unitPrice: price, price, quantity, image, vendorOwnerId });
  }
  return resolved;
}

exports.createOrder = onCall(async (request) => {
  const caller = requireAuth(request);
  if (caller.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email before placing an order.");
  }
  const input = request.data?.order || {};
  const deliveryAddress = cleanText(input.deliveryAddress, 500);
  const phone = cleanText(input.phone, 40);
  if (deliveryAddress.length < 10 || phone.replace(/\D/g, "").length < 7) {
    throw new HttpsError("invalid-argument", "A complete delivery address and phone number are required.");
  }
  const deliveryFee = 30;
  const paymentMethod = cleanText(input.paymentMethod, 80) || "M-Pesa";
  if (!allowedPaymentMethods.has(paymentMethod)) {
    throw new HttpsError("invalid-argument", "Select a supported payment method.");
  }
  const dateKey = formatDateKey();
  const counterRef = db.doc(`systemCounters/orders-${dateKey}`);
  const order = await db.runTransaction(async (transaction) => {
    const items = await resolveOrderItems(input.items, transaction);
    const vendorIds = [...new Set(items.map((item) => item.vendorOwnerId))];
    if (vendorIds.length !== 1) {
      throw new HttpsError("invalid-argument", "Place separate orders for items from different vendors.");
    }
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const counterSnapshot = await transaction.get(counterRef);
    const sequence = Number(counterSnapshot.data()?.value || 0) + 1;
    const orderId = `MM-${dateKey}-${String(sequence).padStart(3, "0")}`;
    const orderRef = db.doc(`orders/${orderId}`);
    const record = {
      customerId: caller.uid,
      userId: caller.uid,
      items,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      deliveryAddress,
      phone,
      deliveryInstructions: cleanText(input.deliveryInstructions, 1000),
      notes: cleanText(input.notes, 1000),
      paymentMethod,
      paymentStatus: "pending",
      status: "Order Received - Preparing Soon",
      vendorOwnerId: vendorIds[0],
      assignedRiderId: null,
      dispatchOpen: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.set(counterRef, { value: sequence, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.create(orderRef, record);
    return { id: orderId, ...record, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  });
  return order;
});

exports.listAvailableDeliveries = onCall(async (request) => {
  const caller = requireRole(request, "rider");
  const riderSnapshot = await db.doc(`riders/${caller.uid}`).get();
  if (!riderSnapshot.exists || riderSnapshot.data().status !== "approved" || riderSnapshot.data().available !== true) {
    throw new HttpsError("failed-precondition", "Set your approved rider profile to available to view delivery offers.");
  }
  const snapshot = await db.collection("orders").where("dispatchOpen", "==", true).limit(50).get();
  const offers = snapshot.docs
    .filter((document) => !document.data().assignedRiderId
      && new Set(["Order Received - Preparing Soon", "Preparing Your Meal"]).has(document.data().status))
    .map((document) => ({ id: document.id, deliveryFee: document.data().deliveryFee || 30 }));
  return { offers };
});

exports.updateOrderStatus = onCall(async (request) => {
  const caller = requireAuth(request);
  if (caller.token?.admin === true) await adminSecurity.requireAdminAccess(db, caller);
  const orderId = cleanText(request.data?.orderId, 80);
  const action = request.data?.action;
  const orderRef = db.doc(`orders/${orderId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Order not found.");
    const order = snapshot.data();
    const admin = caller.token.admin === true;
    const vendorSnapshot = caller.token.vendor === true && order.vendorOwnerId === caller.uid
      ? await transaction.get(db.doc(`vendors/${caller.uid}`)) : null;
    const riderSnapshot = caller.token.rider === true
      ? await transaction.get(db.doc(`riders/${caller.uid}`)) : null;
    const vendor = vendorSnapshot?.data()?.status === "approved";
    const rider = riderSnapshot?.data()?.status === "approved";
    const updates = { updatedAt: FieldValue.serverTimestamp() };
    if (action === "preparing" && (vendor || admin) && order.status === "Order Received - Preparing Soon") {
      updates.status = "Preparing Your Meal";
    }
    else if (action === "accept" && rider && !order.assignedRiderId
        && new Set(["Order Received - Preparing Soon", "Preparing Your Meal"]).has(order.status)) {
      const userSnapshot = await transaction.get(db.doc(`users/${caller.uid}`));
      if (!riderSnapshot.exists || riderSnapshot.data().status !== "approved" || riderSnapshot.data().available !== true) {
        throw new HttpsError("failed-precondition", "Set your approved rider profile to available before accepting a delivery.");
      }
      updates.assignedRiderId = caller.uid;
      updates.dispatchOpen = false;
      updates.riderName = cleanText(userSnapshot.data()?.fullName || caller.token.name || "Mama Meals Rider", 150);
      updates.riderPhone = cleanText(userSnapshot.data()?.phone, 40);
      updates.riderVehicle = cleanText(riderSnapshot.data()?.vehicleType, 80);
      updates.status = "Rider Assigned - Pickup Pending";
      updates.assignedAt = FieldValue.serverTimestamp();
    } else if (action === "start" && rider && order.assignedRiderId === caller.uid
        && order.status === "Rider Assigned - Pickup Pending") {
      updates.status = "Out for Delivery";
      updates.outForDeliveryAt = FieldValue.serverTimestamp();
    } else if (action === "delivered" && ((rider && order.assignedRiderId === caller.uid) || admin)
        && order.status === "Out for Delivery") {
      updates.status = "Delivered";
      updates.deliveredAt = FieldValue.serverTimestamp();
    } else if (action === "cancelled" && admin && !new Set(["Delivered", "Cancelled"]).has(order.status)) {
      updates.status = "Cancelled";
      updates.dispatchOpen = false;
    }
    else throw new HttpsError("permission-denied", "This role cannot perform that order action.");
    transaction.update(orderRef, updates);
  });
  return { orderId, action };
});

function validMenuItem(input) {
  const price = Number(input?.price);
  const category = cleanText(input?.category, 50);
  if (!cleanText(input?.name, 120) || cleanText(input?.description, 500).length < 10 || !Number.isFinite(price) || price <= 0) {
    throw new HttpsError("invalid-argument", "Name, description, and a valid price are required.");
  }
  if (!new Set(["Main Meals", "Sides", "Drinks", "Snacks"]).has(category)) {
    throw new HttpsError("invalid-argument", "Invalid menu category.");
  }
  return {
    name: cleanText(input.name, 120),
    description: cleanText(input.description, 500),
    price,
    category,
    available: input.available !== false,
    imagePath: cleanText(input.imagePath, 500),
    imageUrl: cleanText(input.imageUrl, 1000)
  };
}

function validStorageDownloadUrl(imageUrl, imagePath) {
  try {
    const url = new URL(imageUrl);
    return url.protocol === "https:"
      && url.hostname === "firebasestorage.googleapis.com"
      && decodeURIComponent(url.pathname) === `/v0/b/${storage.bucket().name}/o/${imagePath}`;
  } catch {
    return false;
  }
}

async function verifyVendorMenuImage(uid, itemId, imagePath, imageUrl) {
  const expectedPrefix = `vendors/${uid}/menu/${itemId}/`;
  if (!imagePath.startsWith(expectedPrefix) || imagePath.includes("..") || !validStorageDownloadUrl(imageUrl, imagePath)) {
    throw new HttpsError("permission-denied", "Invalid menu image reference.");
  }
  const file = storage.bucket().file(imagePath);
  const [metadata] = await file.getMetadata().catch(() => {
    throw new HttpsError("not-found", "The menu image was not found. Upload it again.");
  });
  const size = Number(metadata.size || 0);
  if (!allowedImageTypes.has(metadata.contentType) || size <= 0 || size > maxUploadBytes
      || metadata.metadata?.ownerId !== uid || metadata.metadata?.menuItemId !== itemId) {
    throw new HttpsError("invalid-argument", "Menu images must be owned JPG, PNG, or WebP files under 2MB.");
  }
  const [buffer] = await file.download();
  const image = await sharp(buffer, { failOn: "warning" }).metadata().catch(() => {
    throw new HttpsError("invalid-argument", "The menu image is not a readable JPG, PNG, or WebP file.");
  });
  if (!new Set(["jpeg", "png", "webp"]).has(image.format)
      || metadata.contentType !== `image/${image.format}`
      || !validImageDimensions(image.width, image.height)) {
    throw new HttpsError("invalid-argument", "Menu images must be at least 800x600px and use a 1:1 or 4:3 aspect ratio.");
  }
}

exports.upsertVendorMenuItem = onCall(async (request) => {
  const caller = await requireApprovedPartner(request, "vendor");
  const itemId = cleanText(request.data?.item?.id, 80);
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(itemId)) throw new HttpsError("invalid-argument", "Invalid menu item identifier.");
  const itemRef = db.doc(`menuItems/${itemId}`);
  const item = validMenuItem(request.data.item);
  await verifyVendorMenuImage(caller.uid, itemId, item.imagePath, item.imageUrl);
  const previousImagePath = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(itemRef);
    if (existing.exists && existing.data().vendorOwnerId !== caller.uid) {
      throw new HttpsError("permission-denied", "You do not own this menu item.");
    }
    transaction.set(itemRef, {
      ...item,
      vendorOwnerId: caller.uid,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return cleanText(existing.data()?.imagePath, 500);
  });
  if (previousImagePath && previousImagePath !== item.imagePath && previousImagePath.startsWith(`vendors/${caller.uid}/menu/${itemId}/`)) {
    await storage.bucket().file(previousImagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
  }
  return { id: itemId };
});

exports.deleteVendorMenuItem = onCall(async (request) => {
  const caller = await requireApprovedPartner(request, "vendor");
  const itemId = cleanText(request.data?.itemId, 80);
  const itemRef = db.doc(`menuItems/${itemId}`);
  const snapshot = await itemRef.get();
  if (!snapshot.exists || snapshot.data().vendorOwnerId !== caller.uid) {
    throw new HttpsError("permission-denied", "You do not own this menu item.");
  }
  await itemRef.delete();
  const imagePath = cleanText(snapshot.data().imagePath, 500);
  if (imagePath.startsWith(`vendors/${caller.uid}/menu/${itemId}/`)) {
    await storage.bucket().file(imagePath).delete({ ignoreNotFound: true }).catch((error) => {
      console.error("Vendor menu image cleanup failed", { itemId, imagePath, error });
    });
  }
  return { id: itemId };
});

exports.updateVendorProfile = onCall(async (request) => {
  const caller = await requireApprovedPartner(request, "vendor");
  const input = request.data?.profile || {};
  await db.doc(`vendors/${caller.uid}`).set({
    ownerId: caller.uid,
    userId: caller.uid,
    kitchenName: cleanText(input.kitchenName, 150),
    serviceArea: cleanText(input.serviceArea, 300),
    about: cleanText(input.about, 1000),
    acceptingOrders: input.acceptingOrders === true,
    status: "approved",
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

exports.updateRiderProfile = onCall(async (request) => {
  const caller = await requireApprovedPartner(request, "rider");
  const input = request.data?.profile || {};
  await db.doc(`riders/${caller.uid}`).set({
    ownerId: caller.uid,
    userId: caller.uid,
    serviceArea: cleanText(input.serviceArea, 300),
    vehicleType: cleanText(input.vehicleType, 80),
    plate: cleanText(input.plate, 80),
    available: input.available === true,
    status: "approved",
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});
