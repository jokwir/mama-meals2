// Documentation-only Firebase Web SDK example for Mama Meals.
// The build creates dist/assets/js/firebase-config.js from Netlify environment values.
// This file is never imported or copied to the production build.

export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};

export const firebaseCollections = {
  users: "users",
  vendors: "vendors",
  riders: "riders",
  orders: "orders",
  menuItems: "menuItems",
  applications: "applications",
  systemCounters: "systemCounters"
};
