const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

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

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

function minifyJs(js) {
  return js
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .join("\n");
}

function write(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

function copyHtmlFiles() {
  for (const file of fs.readdirSync(root).filter((name) => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(root, file), "utf8")
      .replace("assets/css/style.css", "assets/css/style.min.css")
      .replace("assets/js/app.js", "assets/js/app.min.js");
    write(path.join(dist, file), html);
  }
}

function buildAssets() {
  write(path.join(dist, "assets/css/style.min.css"), minifyCss(fs.readFileSync(path.join(root, "assets/css/style.css"), "utf8")));
  write(path.join(dist, "assets/js/app.min.js"), minifyJs(fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8")));
  copyDir(path.join(root, "images"), path.join(dist, "images"));
  fs.copyFileSync(path.join(root, "config.json"), path.join(dist, "config.json"));
  for (const optionalFile of ["firebase.json", "netlify.toml", "_redirects"]) {
    const source = path.join(root, optionalFile);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(dist, optionalFile));
    }
  }
}

function copyFirebaseTemplates() {
  const source = path.join(root, "firebase");
  if (fs.existsSync(source)) {
    copyDir(source, path.join(dist, "firebase"));
  }
}

function main() {
  ensureDir(dist);
  copyHtmlFiles();
  buildAssets();
  copyFirebaseTemplates();
  console.log("Production build ready in mama-meals/dist");
  console.log("Images copied with original names. Install an image optimizer such as sharp or pngquant before deployment if smaller PNG files are required.");
}

main();
