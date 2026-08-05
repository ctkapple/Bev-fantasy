import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const leaguesDir = path.join(__dirname, "..", "leagues");

/**
 * Global `leagues` data: an array of every league's config, loaded from
 * src/leagues/<slug>.json. Adding a new league is adding one file here -
 * no template changes required. Config shape (see data-build/SCHEMA.md
 * for the full contract):
 *   { slug, name, tagline, currentLeagueId, colorAccent, tabs: [{id, label, template}],
 *     managerInfoMap: {...}, punishmentGalleries: {...} }
 */
export default function () {
  return readdirSync(leaguesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(leaguesDir, f), "utf-8")))
    .sort((a, b) => a.name.localeCompare(b.name));
}
