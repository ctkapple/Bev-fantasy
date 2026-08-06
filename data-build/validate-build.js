/**
 * validate-build.js
 *
 * Post-build sanity checks against the generated _site/ directory. Exists
 * because two whole classes of bug shipped silently during the v2 rebuild:
 *   1. A tab in a league config whose URL had no corresponding generated page
 *      (tab id and template permalink drifted apart) -> dead nav link.
 *   2. A config/template referencing an asset path that doesn't exist on disk
 *      (e.g. after an asset rename) -> broken image.
 * Neither produces a build error on its own, so they're checked explicitly here.
 *
 * Run as the last step of `npm run build`. Exits non-zero on any failure so CI
 * fails loudly instead of deploying a broken site.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const siteDir = path.join(root, "_site");
const leaguesDir = path.join(root, "src", "leagues");

const errors = [];

if (!existsSync(siteDir)) {
  console.error("[validate-build] _site/ does not exist - run the build first.");
  process.exit(1);
}

const configs = readdirSync(leaguesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(leaguesDir, f), "utf-8")));

// --- 1. Every tab in every league config must resolve to a generated page ---
for (const league of configs) {
  for (const tab of league.tabs) {
    const urlPath = tab.id === "dashboard" ? `${league.slug}/` : `${league.slug}/${tab.id}/`;
    const filePath = path.join(siteDir, urlPath, "index.html");
    if (!existsSync(filePath)) {
      errors.push(
        `Dead nav link: "${league.slug}" tab "${tab.label}" (id "${tab.id}") points at /${urlPath} but no page was generated there. ` +
          `Check that the section template's permalink matches the tab id.`
      );
    }
  }
}

// --- 2. Every /assets/... path referenced in a league config must exist ------
for (const league of configs) {
  const referenced = new Set();
  for (const info of Object.values(league.managerInfoMap || {})) {
    if (info.avatar?.startsWith("/assets/")) referenced.add(info.avatar);
  }
  for (const images of Object.values(league.punishmentGalleries || {})) {
    for (const img of images) if (img.startsWith("/assets/")) referenced.add(img);
  }
  for (const ref of referenced) {
    if (!existsSync(path.join(siteDir, ref))) {
      errors.push(`Missing asset: "${league.slug}" references ${ref} but no such file exists in _site${ref}.`);
    }
  }
}

// --- 3. Core pages that must always exist -----------------------------------
const requiredPages = ["index.html", ...configs.map((l) => path.join(l.slug, "index.html"))];
for (const page of requiredPages) {
  if (!existsSync(path.join(siteDir, page))) errors.push(`Missing required page: _site/${page}`);
}

// --- 4. Data sanity: don't ship a live site full of empty states -------------
// The historical/current split keys off Sleeper's `league.status === 'complete'`,
// which has never been verified against real API responses. If that assumption
// is wrong, every league silently produces zero frozen seasons and the whole
// site deploys as "No completed seasons yet". Fail loudly instead.
// Set ALLOW_EMPTY_LEAGUE_DATA=1 to bypass (e.g. a genuinely brand-new league,
// or a structure-only preview build with no fetch step).
if (!process.env.ALLOW_EMPTY_LEAGUE_DATA) {
  for (const league of configs) {
    const histPath = path.join(leaguesDir, league.slug, "data", "historical.json");
    if (!existsSync(histPath)) {
      errors.push(
        `No data fetched for "${league.slug}" (${histPath} missing). Did the fetch-data step run?`
      );
      continue;
    }
    const seasons = JSON.parse(readFileSync(histPath, "utf-8"));
    if (seasons.length === 0) {
      errors.push(
        `"${league.slug}" froze 0 historical seasons - the site would deploy with empty standings/records. ` +
          `Most likely the 'league.status === "complete"' freeze condition in data-build/fetch-sleeper.js ` +
          `doesn't match what Sleeper actually returns; check the fetch step's logs for the per-season status values.`
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`\n[validate-build] FAILED with ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error("");
  process.exit(1);
}

const seasonCounts = configs
  .map((l) => {
    const p = path.join(leaguesDir, l.slug, "data", "historical.json");
    const n = existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")).length : 0;
    return `${l.slug}=${n}`;
  })
  .join(" ");

console.log(
  `[validate-build] OK - ${configs.length} league(s), ` +
    `${configs.reduce((n, l) => n + l.tabs.length, 0)} nav links, all assets resolve. ` +
    `Frozen seasons: ${seasonCounts}`
);
