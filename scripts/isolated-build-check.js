const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const originalDist = path.join(root, "dist");
const scratch = fs.mkdtempSync(path.join(root, ".isolated-build-"));

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function snapshot(directory) {
  if (!fs.existsSync(directory)) return null;
  const result = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) result[path.relative(directory, full)] = hash(full);
    }
  }
  visit(directory);
  return result;
}

try {
  const before = snapshot(originalDist);
  assert.equal(path.dirname(scratch), root);
  assert.ok(path.basename(scratch).startsWith(".isolated-build-"));
  assert.notEqual(path.resolve(scratch), path.resolve(originalDist));
  for (const name of fs.readdirSync(root).filter((file) => file.endsWith(".html"))) {
    fs.copyFileSync(path.join(root, name), path.join(scratch, name));
  }
  for (const name of ["assets/css/style.css", "assets/js/app.js", "assets/js/firebase-client.js",
    "scripts/build-production.js", "functions/runtime-config.js", "config.json", "_headers", "_redirects", "netlify.prebuilt.toml"]) {
    const source = path.join(root, name);
    if (!fs.existsSync(source)) continue;
    const target = path.join(scratch, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  fs.cpSync(path.join(root, "images"), path.join(scratch, "images"), { recursive: true });
  assert.equal(fs.existsSync(path.join(scratch, "dist")), false);
  assert.equal(fs.existsSync(path.join(scratch, ".env.local")), false);
  const env = {
    ...process.env,
    CONTEXT: "production",
    FIREBASE_API_KEY: "demo-public-key",
    FIREBASE_AUTH_DOMAIN: "demo-mama-meals-build.firebaseapp.com",
    FIREBASE_PROJECT_ID: "demo-mama-meals-build",
    FIREBASE_STORAGE_BUCKET: "demo-mama-meals-build.firebasestorage.app",
    FIREBASE_MESSAGING_SENDER_ID: "123456789",
    FIREBASE_APP_ID: "1:123456789:web:demo",
    FIREBASE_MEASUREMENT_ID: "",
    FIREBASE_FUNCTIONS_REGION: "africa-south1"
  };
  const outcome = spawnSync(process.execPath, [path.join(scratch, "scripts/build-production.js")], {
    cwd: scratch, env, encoding: "utf8", timeout: 120000
  });
  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  assert.equal(outcome.status, 0, outcome.error?.message || "Isolated production build failed");
  const built = path.join(scratch, "dist");
  const htmlCount = fs.readdirSync(built).filter((name) => name.endsWith(".html")).length;
  const imageCount = fs.readdirSync(path.join(built, "images")).length;
  assert.ok(htmlCount > 0 && imageCount > 0, "Isolated output is incomplete");
  for (const name of fs.readdirSync(root).filter((file) => file.endsWith(".html"))) {
    const source = fs.readFileSync(path.join(root, name), "utf8");
    const output = fs.readFileSync(path.join(built, name), "utf8");
    if (source.includes('assets/css/style.css')) {
      assert.ok(output.includes('assets/css/style.min.css'), `${name}: production stylesheet missing`);
      assert.equal(output.includes('assets/css/style.css'), false, `${name}: source stylesheet remains`);
    }
    if (source.includes('<script src="assets/js/app.js"></script>')) {
      for (const asset of ["firebase-config.js", "firebase-client.min.js", "app.min.js"]) {
        assert.ok(output.includes(`assets/js/${asset}`), `${name}: ${asset} missing`);
      }
      assert.equal(output.includes('assets/js/app.js'), false, `${name}: source script remains`);
    }
  }
  const publicConfig = fs.readFileSync(path.join(built, "assets/js/firebase-config.js"), "utf8");
  assert.ok(publicConfig.includes('"functionsRegion":"africa-south1"'), "Production Functions region mismatch");
  assert.ok(publicConfig.includes('"projectId":"demo-mama-meals-build"'), "Demo build project mismatch");
  assert.deepEqual(snapshot(originalDist), before, "Working dist changed during isolated build");
  console.log(`Isolated build OK: ${htmlCount} HTML files, ${imageCount} original images; working dist unchanged.`);
} finally {
  if (path.dirname(scratch) === root && path.basename(scratch).startsWith(".isolated-build-")) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
