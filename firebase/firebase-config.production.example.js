// Documentation-only Firebase Web SDK template.
// The production build reads these public identifiers from Netlify environment variables.
// Never add Firebase Admin credentials or other server secrets here.

export const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

export const productionFirebaseChecks = {
  authUsesEmailPassword: true,
  emailVerificationRequired: true,
  firestoreRulesRequired: true,
  storageRulesRequired: true,
  emulatorMode: false
};
