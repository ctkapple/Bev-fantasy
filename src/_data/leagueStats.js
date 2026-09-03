import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const leaguesDir = path.join(__dirname, "..", "leagues");

/**
 * Global `leagueStats` data: { [slug]: { historical: SeasonData[], aggregates: AggregateData|null } },
 * read from the JSON that data-build/fetch-sleeper.js writes to
 * src/leagues/<slug>/data/*.json. Templates read this at build time to
 * render tables/lists with real numbers baked into the static HTML.
 *
 * historical/aggregates are `[]`/`null` if fetch-sleeper.js hasn't run yet
 * (e.g. local preview before `npm run fetch-data`, or this dev sandbox where
 * api.sleeper.app is network-blocked) - templates should render an empty/
 * "no data yet" state rather than crash in that case.
 *
 * Keyed by each config's own `slug` field (not its filename) so a league's
 * config file can live anywhere in this directory while its `slug` (and
 * therefore its data dir / URL) nests under a subpath, e.g. "unaffiliated/dd".
 */
export default function () {
  const slugs = readdirSync(leaguesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(leaguesDir, f), "utf-8")).slug);

  const result = {};
  for (const slug of slugs) {
    const dataDir = path.join(leaguesDir, slug, "data");
    const histPath = path.join(dataDir, "historical.json");
    const aggPath = path.join(dataDir, "aggregates.json");
    result[slug] = {
      historical: existsSync(histPath) ? JSON.parse(readFileSync(histPath, "utf-8")) : [],
      aggregates: existsSync(aggPath) ? JSON.parse(readFileSync(aggPath, "utf-8")) : null,
    };
  }
  return result;
}
