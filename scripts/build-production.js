const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const localEnvironmentFile = path.join(root, ".env.local");
if (fs.existsSync(localEnvironmentFile)) {
  process.loadEnvFile(localEnvironmentFile);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(source, target) {
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifyCopiedImages() {
  const sourceDir = path.join(root, "images");
  const outputDir = path.join(dist, "images");
  for (const file of fs.readdirSync(sourceDir)) {
    const source = path.join(sourceDir, file);
    const output = path.join(outputDir, file);
    if (!fs.statSync(source).isFile()) continue;
    if (!fs.existsSync(output) || fileHash(source) !== fileHash(output)) {
      throw new Error(`Production image copy verification failed for ${file}`);
    }
  }
}

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

const requiredFirebaseEnvironment = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID"
];

function publicFirebaseConfig() {
  return {
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY || "",
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
      projectId: process.env.FIREBASE_PROJECT_ID || "",
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
      appId: process.env.FIREBASE_APP_ID || "",
      measurementId: process.env.FIREBASE_MEASUREMENT_ID || ""
    },
    functionsRegion: require("../functions/runtime-config").runtimeConfig().region
  };
}

function write(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

function copyHtmlFiles() {
  for (const file of fs.readdirSync(root).filter((name) => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(root, file), "utf8")
      .replace("assets/css/style.css", "assets/css/style.min.css")
      .replace(
        '<script src="assets/js/app.js"></script>',
        '<script defer src="assets/js/firebase-config.js"></script>\n    <script defer src="assets/js/firebase-client.min.js"></script>\n    <script defer src="assets/js/app.min.js"></script>'
      );
    write(path.join(dist, file), html);
  }
}

function buildAssets() {
  write(path.join(dist, "assets/css/style.min.css"), minifyCss(fs.readFileSync(path.join(root, "assets/css/style.css"), "utf8")));
  esbuild.buildSync({
    entryPoints: [path.join(root, "assets/js/firebase-client.js")],
    outfile: path.join(dist, "assets/js/firebase-client.min.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    legalComments: "none"
  });
  esbuild.buildSync({
    entryPoints: [path.join(root, "assets/js/app.js")],
    outfile: path.join(dist, "assets/js/app.min.js"),
    bundle: false,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    legalComments: "none"
  });
  write(
    path.join(dist, "assets/js/firebase-config.js"),
    `window.__MAMA_MEALS_FIREBASE_CONFIG__=${JSON.stringify(publicFirebaseConfig())};\n`
  );
  copyDir(path.join(root, "images"), path.join(dist, "images"));
  fs.copyFileSync(path.join(root, "config.json"), path.join(dist, "config.json"));
  for (const optionalFile of ["_redirects", "_headers"]) {
    const source = path.join(root, optionalFile);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(dist, optionalFile));
    }
  }
  fs.copyFileSync(path.join(root, "netlify.prebuilt.toml"), path.join(dist, "netlify.toml"));
}

function main() {
  const missingEnvironment = requiredFirebaseEnvironment.filter((name) => !process.env[name]);
  if (process.env.CONTEXT === "production" && missingEnvironment.length) {
    throw new Error(`Production Firebase configuration is incomplete: ${missingEnvironment.join(", ")}`);
  }
  if (path.resolve(dist) !== path.resolve(root, "dist")) {
    throw new Error("Refusing to clean an unexpected build directory.");
  }
  fs.rmSync(dist, { recursive: true, force: true });
  ensureDir(dist);
  copyHtmlFiles();
  buildAssets();
  verifyCopiedImages();
  console.log("Production build ready in mama-meals/dist");
  const configured = missingEnvironment.length === 0;
  console.log(configured
    ? "Firebase public web configuration embedded from environment variables."
    : "Firebase public web configuration is incomplete; authentication will fail closed until Netlify environment variables are set.");
  console.log("Images copied with original names.");
}

main();
