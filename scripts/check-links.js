const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const missing = [];
const htmlFiles = fs.readdirSync(root).filter((file) => file.endsWith(".html"));
const assetPattern = /\b(?:href|src)="([^"]+)"/g;

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of html.matchAll(assetPattern)) {
    const target = match[1];
    if (!target || /^(https?:|mailto:|tel:|#)/.test(target)) {
      continue;
    }

    const cleanTarget = target.split(/[?#]/)[0];
    if (!cleanTarget) {
      continue;
    }

    if (!fs.existsSync(path.join(root, cleanTarget))) {
      missing.push(`${file} -> ${target}`);
    }
  }
}

if (missing.length) {
  console.error("Missing internal links or assets:");
  missing.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}

console.log("Internal links/assets OK");
