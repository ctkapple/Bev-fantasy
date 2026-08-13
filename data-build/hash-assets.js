/**
 * hash-assets.js
 *
 * Renames the built CSS/JS to `name.<contenthash>.ext` and rewrites every
 * reference to them in the generated HTML.
 *
 * Exists because GitHub Pages serves `/assets/js/ap-poll.js` with
 * `Cache-Control: max-age=600` and no content hash, so a deploy could leave a
 * browser holding stale JS against fresh HTML with no way to tell. A changed
 * file now has a changed URL, which no cache can confuse for the old one.
 * (`?v=` query strings were the manual workaround; this replaces them.)
 *
 * Runs after build:css and build:js, before validate. Deliberately skipped in
 * `npm run dev`: `eleventy --serve` re-renders HTML on change and would emit
 * unhashed paths pointing at files that no longer exist under that name.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.join(__dirname, "..", "_site");
const assetDirs = ["assets/css", "assets/js"];

if (!existsSync(siteDir)) {
  console.error("[hash-assets] _site/ does not exist - run the build first.");
  process.exit(1);
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function htmlFilesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFilesIn(full);
    return entry.isFile() && entry.name.endsWith(".html") ? [full] : [];
  });
}

// --- 1. Rename each built asset to include a hash of its contents -----------
const renames = new Map();

for (const assetDir of assetDirs) {
  const absoluteDir = path.join(siteDir, assetDir);
  if (!existsSync(absoluteDir)) continue;

  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name);
    if (extension !== ".css" && extension !== ".js") continue;

    // Re-running the build over a dirty _site/ must not hash an already-hashed name.
    const base = path.basename(entry.name, extension);
    if (/\.[0-9a-f]{8}$/.test(base)) continue;

    const contents = readFileSync(path.join(absoluteDir, entry.name));
    const hash = createHash("sha256").update(contents).digest("hex").slice(0, 8);
    const hashedName = `${base}.${hash}${extension}`;

    renameSync(path.join(absoluteDir, entry.name), path.join(absoluteDir, hashedName));
    renames.set(`/${assetDir}/${entry.name}`, `/${assetDir}/${hashedName}`);
  }
}

// --- 2. Point the generated HTML at the new names ---------------------------
const htmlFiles = htmlFilesIn(siteDir);
// Longest first so no asset path can be rewritten as a prefix of a longer one.
const originals = [...renames.keys()].sort((a, b) => b.length - a.length);
let rewriteCount = 0;

for (const file of htmlFiles) {
  const original = readFileSync(file, "utf-8");
  let updated = original;

  for (const from of originals) {
    // Also swallows any hand-rolled `?v=` cache-buster on the same reference.
    const pattern = new RegExp(`${escapeRegExp(from)}(\\?[^"'\\s>]*)?`, "g");
    updated = updated.replace(pattern, renames.get(from));
  }

  if (updated !== original) {
    writeFileSync(file, updated);
    rewriteCount += 1;
  }
}

// --- 3. Fail loudly if any CSS/JS reference no longer resolves --------------
const errors = [];

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf-8");
  for (const [, reference] of html.matchAll(/["'](\/assets\/(?:css|js)\/[^"'?\s>]+)/g)) {
    if (!existsSync(path.join(siteDir, reference))) {
      errors.push(`${path.relative(siteDir, file)} references ${reference}, which does not exist.`);
    }
  }
}

if (errors.length > 0) {
  console.error(`\n[hash-assets] FAILED with ${errors.length} unresolved reference(s):\n`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error("");
  process.exit(1);
}

console.log(
  `[hash-assets] OK - hashed ${renames.size} asset(s), rewrote ${rewriteCount} of ${htmlFiles.length} HTML file(s).`
);
