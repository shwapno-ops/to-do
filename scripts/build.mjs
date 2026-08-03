import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const files = [
  "index.html",
  "styles.css",
  "app.js",
  "data.js",
  "cloud-config.js",
  "favicon.svg",
  ".nojekyll",
];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) throw new Error(`Required site file is missing: ${file}`);
  fs.copyFileSync(source, path.join(output, file));
}

const builtHtml = fs.readFileSync(path.join(output, "index.html"), "utf8");
for (const asset of ["styles.css", "app.js", "data.js", "cloud-config.js", "favicon.svg"]) {
  if (!builtHtml.includes(asset)) throw new Error(`index.html does not reference ${asset}`);
}

console.log(`Built ${files.length} static site files in dist/.`);
