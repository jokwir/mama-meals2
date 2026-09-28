import { initializeApp } from "firebase/app";
import {
    browserLocalPersistence,
    createUserWithEmailAndPassword,
    getAuth,
    getIdTokenResult,
    onAuthStateChanged,
    reload,
    sendEmailVerification,
    sendPasswordResetEmail,
    setPersistence,
    signInWithEmailAndPassword,
    signOut,
    updateProfile as updateAuthProfile
} from "firebase/auth";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    limit,
    query,
    setDoc,
    where
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";

const runtimeConfig = window.__MAMA_MEALS_FIREBASE_CONFIG__ || {};
const firebaseConfig = runtimeConfig.firebase || {};
const functionsRegion = runtimeConfig.functionsRegion || "europe-west1";
const requiredConfigKeys = ["apiKey", "authDomain", "projectId", "storageBucket", "appId"];
const retiredBrowserKeys = [
    "mamaMealsActiveAccount",
    "mamaMealsAccountProfile",
    "mamaMealsUsers",
    "mamaMealsOrders",
    "mamaMealsPartnerApplications",
    "mamaMealsPasswordResetRequests",
    "mamaMealsLastApplicationConfirmation"
];

function clearRetiredPrototypeData() {
    try {
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
            const key = localStorage.key(index);
            if (retiredBrowserKeys.includes(key) || /^mamaMeals(VendorMenuItems|VendorProfile|RiderProfile):?/.test(key || "")) {
                localStorage.removeItem(key);
            }
        }
        sessionStorage.removeItem("mamaMealsLastApplicationConfirmation");
    } catch {
        // Private browsing can deny storage access; Auth still fails closed independently.
    }
}

const state = {
    configured: requiredConfigKeys.every((key) => Boolean(firebaseConfig[key])),
    error: "",
    user: null,
    profile: null,
    claims: {},
    roles: [],
    users: [],
    orders: [],
    deliveryOffers: [],
    applications: [],
    applicationsByUser: {},
    vendorMenu: [],
    vendorProfile: {},
    riderProfile: {},
    marketplaceVendors: []
};

let auth;
let db;
let functions;
let storage;

function requireConfigured() {
    if (!state.configured) {
        throw new Error("Firebase is not configured. Add the public Firebase Web App values to the Netlify environment before building.");
    }
}

function requireUser() {
    requireConfigured();
    if (!state.user) {
        throw new Error("Sign in to continue.");
    }
    return state.user;
}

function normaliseError(error) {
    const code = String(error?.code || "");
    const messages = {
        "auth/email-already-in-use": "An account already exists for this email address.",
        "auth/invalid-credential": "Please check your email and password and try again.",
        "auth/invalid-email": "Enter a valid email address.",
        "auth/too-many-requests": "Too many attempts. Please wait and try again.",
        "auth/weak-password": "Use a stronger password with at least six characters.",
        "functions/permission-denied": "You do not have permission to perform this action.",
        "functions/unauthenticated": "Sign in to continue."
    };
    return new Error(messages[code] || error?.message || "The secure service could not complete this request.");
}

function toPlainValue(value) {
    if (value?.toDate instanceof Function) {
        return value.toDate().toISOString();
    }
    if (Array.isArray(value)) {
        return value.map(toPlainValue);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlainValue(item)]));
    }
    return value;
}

function snapshotList(snapshot) {
    return snapshot.docs.map((item) => ({ id: item.id, ...toPlainValue(item.data()) }));
}

function rolesFromClaims(claims) {
    return ["customer", "vendor", "rider", "admin"].filter((role) => role === "customer" || claims?.[role] === true);
}

function rebuildApplicationIndex() {
    state.applicationsByUser = state.applications.reduce((result, application) => {
        if (["draft", "cancelled", "expired"].includes(application.status)) return result;
        const userId = application.userId;
        const type = application.type;
        if (!userId || !type) return result;
        result[userId] ||= {};
        result[userId][type] ||= application;
        return result;
    }, {});
}

async function getMany(collectionName, filters = [], max = 100) {
    const constraints = filters.map(([field, operator, value]) => where(field, operator, value));
    const result = await getDocs(query(collection(db, collectionName), ...constraints, limit(max)));
    return snapshotList(result);
}

async function loadMarketplace() {
    requireConfigured();
    const [menuItems, vendorProfiles] = await Promise.all([
        getMany("menuItems", [["available", "==", true]], 100),
        getMany("vendors", [["status", "==", "approved"]], 100)
    ]);
    const vendors = new Map(vendorProfiles.map((vendor) => [vendor.id, vendor]));
    const grouped = new Map();
    for (const item of menuItems) {
        const ownerId = item.vendorOwnerId;
        const vendor = vendors.get(ownerId);
        if (!vendor || !item.imageUrl || !item.name || !Number.isFinite(Number(item.price)) || Number(item.price) <= 0) continue;
        if (!grouped.has(ownerId)) {
            grouped.set(ownerId, { ...vendor, items: [] });
        }
        grouped.get(ownerId).items.push(item);
    }
    state.marketplaceVendors = [...grouped.values()]
        .sort((left, right) => String(left.kitchenName || "").localeCompare(String(right.kitchenName || "")));
    return state.marketplaceVendors;
}

async function refreshSessionData(forceToken = false) {
    const user = auth.currentUser;
    state.user = user;
    if (!user) {
        state.profile = null;
        state.claims = {};
        state.roles = [];
        state.users = [];
        state.orders = [];
        state.deliveryOffers = [];
        state.applications = [];
        state.applicationsByUser = {};
        state.vendorMenu = [];
        state.vendorProfile = {};
        state.riderProfile = {};
        return state;
    }

    if (forceToken) await reload(user);

    const token = await getIdTokenResult(user, forceToken);
    state.claims = token.claims || {};
    state.roles = rolesFromClaims(state.claims);

    const profileSnapshot = await getDoc(doc(db, "users", user.uid));
    state.profile = profileSnapshot.exists()
        ? { userId: user.uid, ...toPlainValue(profileSnapshot.data()), emailVerified: user.emailVerified, roles: state.roles }
        : {
            userId: user.uid,
            fullName: user.displayName || "Mama Meals Customer",
            email: user.email || "",
            phone: user.phoneNumber || "",
            location: "",
            addresses: [],
            emailVerified: user.emailVerified,
            roles: state.roles
        };

    const admin = state.claims.admin === true;
    const [applications, customerOrders] = await Promise.all([
        admin ? getMany("applications", [], 250) : getMany("applications", [["userId", "==", user.uid]], 100),
        admin ? getMany("orders", [], 250) : getMany("orders", [["customerId", "==", user.uid]], 100)
    ]);
    state.applications = applications.sort((a, b) => String(b.submittedAt || b.createdAt || "").localeCompare(String(a.submittedAt || a.createdAt || "")));
    rebuildApplicationIndex();

    const orderMap = new Map(customerOrders.map((order) => [order.id, order]));
    if (state.claims.vendor === true) {
        (await getMany("orders", [["vendorOwnerId", "==", user.uid]], 100)).forEach((order) => orderMap.set(order.id, order));
        state.vendorMenu = await getMany("menuItems", [["vendorOwnerId", "==", user.uid]], 100);
        const vendorSnapshot = await getDoc(doc(db, "vendors", user.uid));
        state.vendorProfile = vendorSnapshot.exists() ? toPlainValue(vendorSnapshot.data()) : {};
    } else {
        state.vendorMenu = [];
        state.vendorProfile = {};
    }
    if (state.claims.rider === true) {
        (await getMany("orders", [["assignedRiderId", "==", user.uid]], 100)).forEach((order) => orderMap.set(order.id, order));
        const riderSnapshot = await getDoc(doc(db, "riders", user.uid));
        state.riderProfile = riderSnapshot.exists() ? toPlainValue(riderSnapshot.data()) : {};
        state.deliveryOffers = state.riderProfile.available === true
            ? toPlainValue((await httpsCallable(functions, "listAvailableDeliveries")()).data.offers || [])
            : [];
    } else {
        state.riderProfile = {};
        state.deliveryOffers = [];
    }
    state.orders = [...orderMap.values()].sort((a, b) => String(b.createdAt || b.timestamp || "").localeCompare(String(a.createdAt || a.timestamp || "")));
    state.users = admin ? await getMany("users", [], 250) : [];
    return state;
}

async function refreshAfterWrite(forceToken = false) {
    try {
        await refreshSessionData(forceToken);
    } catch (error) {
        state.error = normaliseError(error).message;
    }
}

async function register(profile, password) {
    requireConfigured();
    try {
        const credential = await createUserWithEmailAndPassword(auth, profile.email.trim().toLowerCase(), password);
        await updateAuthProfile(credential.user, { displayName: profile.fullName });
        const record = {
            fullName: profile.fullName,
            phone: profile.phone,
            email: profile.email.trim().toLowerCase(),
            location: profile.location,
            addresses: [profile.location].filter(Boolean),
            notifications: true,
            language: "English",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        await setDoc(doc(db, "users", credential.user.uid), record);
        await sendEmailVerification(credential.user);
        await refreshSessionData(true);
        return state.profile;
    } catch (error) {
        throw normaliseError(error);
    }
}

async function login(email, password) {
    requireConfigured();
    try {
        await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
        await refreshSessionData(true);
        return state.profile;
    } catch (error) {
        throw normaliseError(error);
    }
}

async function logout() {
    requireConfigured();
    await signOut(auth);
    await refreshSessionData();
}

async function requestPasswordReset(email) {
    requireConfigured();
    try {
        await sendPasswordResetEmail(auth, email.trim().toLowerCase());
    } catch (error) {
        throw normaliseError(error);
    }
}

async function resendVerification() {
    const user = requireUser();
    await sendEmailVerification(user);
}

async function updateProfileDetails(updates) {
    const user = requireUser();
    const allowed = {
        fullName: String(updates.fullName || state.profile?.fullName || "").trim(),
        phone: String(updates.phone || state.profile?.phone || "").trim(),
        email: user.email || "",
        location: String(updates.location || state.profile?.location || "").trim(),
        addresses: Array.isArray(updates.addresses) ? updates.addresses.map(String).slice(0, 10) : (state.profile?.addresses || []),
        notifications: updates.notifications ?? state.profile?.notifications ?? true,
        language: String(updates.language || state.profile?.language || "English"),
        updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, "users", user.uid), allowed, { merge: true });
    if (allowed.fullName && allowed.fullName !== user.displayName) {
        await updateAuthProfile(user, { displayName: allowed.fullName });
    }
    await refreshSessionData();
    return state.profile;
}

function safeFileName(name) {
    return String(name || "upload").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100);
}

async function submitApplication(type, fields, uploadBlocks) {
    const user = requireUser();
    const requiredFields = type === "cook"
        ? ["identityDocument", "foodSafetyDocument", "foodPhoto"]
        : type === "rider" ? ["identityPhoto", "vehiclePhoto"] : [];
    const files = uploadBlocks.map((block) => {
        const input = block.querySelector('input[type="file"]');
        return { field: input?.name, file: input?.files?.[0] };
    });
    if (files.length !== requiredFields.length
        || requiredFields.some((field) => files.filter((item) => item.field === field).length !== 1)
        || files.some(({ file }) => !file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)
            || file.size < 1 || file.size > 2 * 1024 * 1024)) {
        throw new Error("Choose every required JPG, PNG, or WebP image under 2MB.");
    }
    let applicationId;
    try {
        const draft = await httpsCallable(functions, "startPartnerApplication")({ type, fields });
        applicationId = draft.data.applicationId;
        for (const { field, file } of files) {
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
                reader.onerror = () => reject(new Error("The selected image could not be read."));
                reader.readAsDataURL(file);
            });
            await httpsCallable(functions, "uploadApplicationDocument")({
                applicationId, field, contentType: file.type, originalName: file.name, base64
            });
        }
        const response = await httpsCallable(functions, "submitPartnerApplication")({ applicationId });
        await refreshSessionData().catch(() => undefined);
        return toPlainValue(response.data);
    } catch (error) {
        if (applicationId) {
            try {
                const outcome = await httpsCallable(functions, "cancelPartnerApplication")({ applicationId });
                if (outcome.data.status === "pending") {
                    await refreshSessionData().catch(() => undefined);
                    return toPlainValue(outcome.data);
                }
            } catch (cleanupError) {
                console.error("Private draft cleanup was deferred", cleanupError);
                throw new Error("Your application draft is private, but cleanup could not finish. Please retry or contact support before uploading again.");
            }
        }
        throw normaliseError(error);
    }
}

async function bootstrapAdmin() {
    requireUser();
    try {
        await httpsCallable(functions, "bootstrapAdmin")();
        await refreshAfterWrite(true);
        return state.claims;
    } catch (error) {
        throw normaliseError(error);
    }
}

async function reviewApplication(applicationId, decision) {
    requireUser();
    try {
        const response = await httpsCallable(functions, "reviewPartnerApplication")({ applicationId, decision });
        await refreshAfterWrite(true);
        return response.data;
    } catch (error) {
        throw normaliseError(error);
    }
}

async function createOrder(order) {
    requireUser();
    try {
        const response = await httpsCallable(functions, "createOrder")({ order });
        await refreshAfterWrite();
        return response.data;
    } catch (error) {
        throw normaliseError(error);
    }
}

async function updateOrderStatus(orderId, action) {
    requireUser();
    try {
        const response = await httpsCallable(functions, "updateOrderStatus")({ orderId, action });
        await refreshAfterWrite();
        return response.data;
    } catch (error) {
        throw normaliseError(error);
    }
}

async function saveMenuItem(item, file) {
    const user = requireUser();
    const itemId = item.id || doc(collection(db, "menuItems")).id;
    let imagePath = item.imagePath || "";
    let imageUrl = item.imageUrl || "";
    let uploadedImageRef = null;
    try {
        if (file) {
            imagePath = `vendors/${user.uid}/menu/${itemId}/${Date.now()}-${safeFileName(file.name)}`;
            uploadedImageRef = ref(storage, imagePath);
            await uploadBytes(uploadedImageRef, file, {
                contentType: file.type,
                customMetadata: { ownerId: user.uid, menuItemId: itemId }
            });
            imageUrl = await getDownloadURL(uploadedImageRef);
        }
        const response = await httpsCallable(functions, "upsertVendorMenuItem")({ item: { ...item, id: itemId, imagePath, imageUrl } });
        await refreshAfterWrite();
        return response.data;
    } catch (error) {
        if (uploadedImageRef) await deleteObject(uploadedImageRef).catch(() => undefined);
        throw normaliseError(error);
    }
}

async function deleteMenuItem(itemId) {
    requireUser();
    await httpsCallable(functions, "deleteVendorMenuItem")({ itemId });
    await refreshAfterWrite();
}

async function saveVendorProfile(profile) {
    requireUser();
    await httpsCallable(functions, "updateVendorProfile")({ profile });
    await refreshAfterWrite();
}

async function saveRiderProfile(profile) {
    requireUser();
    await httpsCallable(functions, "updateRiderProfile")({ profile });
    await refreshAfterWrite();
}

async function loadProtectedImage(applicationId, field) {
    requireUser();
    try {
        const response = await httpsCallable(functions, "getApplicationDocument")({ applicationId, field });
        const contentType = response.data?.contentType;
        const base64 = response.data?.base64;
        if (!["image/jpeg", "image/png", "image/webp"].includes(contentType) || typeof base64 !== "string") {
            throw new Error("The protected image response was invalid.");
        }
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const blob = new Blob([bytes], { type: contentType });
        return URL.createObjectURL(blob);
    } catch (error) {
        throw normaliseError(error);
    }
}

async function bootstrap() {
    clearRetiredPrototypeData();
    if (!state.configured) {
        state.error = "Firebase Web App configuration is missing.";
        return state;
    }
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        functions = getFunctions(app, functionsRegion);
        storage = getStorage(app);
        await setPersistence(auth, browserLocalPersistence);
        await new Promise((resolve, reject) => {
            const unsubscribe = onAuthStateChanged(auth, async () => {
                unsubscribe();
                try {
                    await refreshSessionData(true);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            }, reject);
        });
    } catch (error) {
        state.error = normaliseError(error).message;
    }
    return state;
}

const service = {
    state,
    ready: bootstrap(),
    refresh: refreshSessionData,
    loadMarketplace,
    register,
    login,
    logout,
    requestPasswordReset,
    resendVerification,
    updateProfile: updateProfileDetails,
    submitApplication,
    bootstrapAdmin,
    reviewApplication,
    createOrder,
    updateOrderStatus,
    saveMenuItem,
    deleteMenuItem,
    saveVendorProfile,
    saveRiderProfile,
    loadProtectedImage
};

window.mamaMealsFirebase = service;
window.dispatchEvent(new CustomEvent("mama-meals-firebase-client-ready"));
