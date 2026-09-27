const path = require("path");
const esbuild = require("esbuild");

esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, "../assets/js/firebase-client.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  write: false,
  logLevel: "silent"
});

console.log("Firebase client bundle OK");
