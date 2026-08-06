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
 */
export default function () {
  const slugs = readdirSync(leaguesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));

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
