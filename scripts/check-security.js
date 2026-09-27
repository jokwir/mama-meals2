const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const frontendFiles = [
  "assets/js/app.js",
  "assets/js/firebase-client.js",
  "config.json",
  ...fs.readdirSync(root).filter((file) => file.endsWith(".html"))
];
const frontend = frontendFiles.map(read).join("\n");
const app = read("assets/js/app.js");
const uiWithoutFirebaseClient = frontendFiles.filter((file) => file !== "assets/js/firebase-client.js").map(read).join("\n");
const firestoreRules = read("firebase/firestore.rules");
const storageRules = read("firebase/storage.rules");
const netlify = read("netlify.toml");

for (const forbidden of [
  "mamaMealsActiveAccount",
  "mamaMealsAccountProfile",
  "mamaMealsUsers",
  "mamaMealsOrders",
  "mamaMealsPartnerApplications"
]) {
  if (uiWithoutFirebaseClient.includes(forbidden)) failures.push(`UI contains retired local auth/data key: ${forbidden}`);
}
if (!read("assets/js/firebase-client.js").includes("clearRetiredPrototypeData()")) {
  failures.push("Retired sensitive browser records are not cleared during Firebase bootstrap.");
}

for (const secretPattern of [/BEGIN PRIVATE KEY/i, /firebase-adminsdk/i, /consumerSecret/i, /39W2VXumSlcBHja4Wjv5QPBp2ek1/]) {
  if (secretPattern.test(frontend)) failures.push(`Frontend contains forbidden server-only value matching ${secretPattern}`);
}

const localStorageLines = app.split(/\r?\n/).filter((line) => line.includes("localStorage"));
if (localStorageLines.some((line) => !line.includes("cartStorageKey") && !line.includes("selectedLocationStorageKey"))) {
  failures.push("localStorage is used for data other than the anonymous cart or selected location.");
}

if (!firestoreRules.includes("allow create, update, delete: if false;") || !firestoreRules.includes("request.auth.token[role] == true")) {
  failures.push("Firestore rules are missing deny-by-default protected writes or custom-claim role checks.");
}
if (!storageRules.includes("request.resource.size <= 2 * 1024 * 1024") || !storageRules.includes("request.auth.token[role] == true")) {
  failures.push("Storage rules are missing upload limits or custom-claim role checks.");
}
if (!netlify.includes('command = "npm run build"') || !netlify.includes('publish = "dist"')) {
  failures.push("Netlify is not configured to build and publish dist.");
}

if (failures.length) {
  console.error("Security foundation checks failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Security foundation checks OK");
