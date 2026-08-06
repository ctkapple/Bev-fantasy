/**
 * fetch-sleeper.js
 *
 * Build-time orchestration: for every league config in src/leagues/*.json,
 * walks the previous_league_id chain, fetches every HISTORICAL (completed)
 * season's raw Sleeper data, runs it through season-processor.mjs, and writes
 * two static JSON artifacts per league that the site then ships as-is:
 *   - src/leagues/<slug>/data/historical.json  (array of SeasonData, oldest first)
 *   - src/leagues/<slug>/data/aggregates.json  (AggregateData, "throughSeason": last completed season)
 *
 * The current in-progress season is deliberately NOT fetched here - it's
 * fetched live client-side (src/scripts/sleeper-client.js) and merged on top
 * of aggregates.json at render time (src/scripts/merge.js). See
 * data-build/SCHEMA.md and the porting notes atop season-processor.mjs.
 *
 * NOT RUNNABLE FROM THE SANDBOX THIS WAS WRITTEN IN: api.sleeper.app is
 * network-blocked in that dev environment. This script has only been
 * `node --check`ed for syntax, not executed against live data. First real run
 * should happen in GitHub Actions (or any environment with normal internet
 * access) - watch that first run's logs closely, in particular the
 * `status === 'complete'` freeze-condition warning below.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "./fetch-with-retry.js";
import { processSeason, aggregateSeasons, buildPrimaryUserIdMap } from "../src/scripts/season-processor.mjs";
import {
  scoringFormatFromLeagueObj,
  adpProjectionsUrl,
  parseAdpRows,
  findCompletedDraft,
  parseDraftPicks,
  parseRostersByOwner,
} from "../src/scripts/keeper-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const leaguesDir = path.join(__dirname, "..", "src", "leagues");
const SLEEPER_BASE = "https://api.sleeper.app/v1";
const MAX_REGULAR_SEASON_WEEK = 18;

async function loadLeagueConfigs() {
  const files = (await readdir(leaguesDir)).filter((f) => f.endsWith(".json"));
  return Promise.all(
    files.map(async (f) => JSON.parse(await readFile(path.join(leaguesDir, f), "utf-8")))
  );
}

/** Walk previous_league_id backward from currentLeagueId. Returns leagueObj[], oldest first. */
async function walkSeasonChain(currentLeagueId) {
  const seasons = [];
  let id = currentLeagueId;
  while (id) {
    const leagueObj = await fetchWithRetry(`${SLEEPER_BASE}/league/${id}`);
    seasons.unshift(leagueObj);
    id = leagueObj.previous_league_id;
  }
  return seasons;
}

async function fetchWeeklyMap(leagueId, endpoint, maxWeek) {
  const result = {};
  for (let week = 1; week <= maxWeek; week++) {
    try {
      const data = await fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/${endpoint}/${week}`);
      if (data && data.length > 0) result[week] = data;
    } catch {
      // A missing week (season ended before week 18, or endpoint 404s for an
      // unplayed week) is expected, not an error - matches the original
      // sb3.html/bb.html's silent-catch-per-week behavior.
    }
  }
  return result;
}

async function fetchHistoricalSeasonRaw(leagueObj) {
  const leagueId = String(leagueObj.league_id);
  const [users, rosters, winnersBracket, losersBracket] = await Promise.all([
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/users`),
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/winners_bracket`).catch(() => null),
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/losers_bracket`).catch(() => null),
  ]);
  const [matchupsByWeek, transactionsByWeek] = await Promise.all([
    fetchWeeklyMap(leagueId, "matchups", MAX_REGULAR_SEASON_WEEK),
    fetchWeeklyMap(leagueId, "transactions", MAX_REGULAR_SEASON_WEEK),
  ]);
  return { users, rosters, matchupsByWeek, transactionsByWeek, winnersBracket, losersBracket };
}

/**
 * Fetch one season's draft picks + end-of-season rosters for the Keeper
 * Assistant tab. Returns null if that season's draft hasn't completed yet
 * (expected for a pre-draft/mid-draft current season, not an error).
 *
 * NOTE: no ADP here. Keeper cost for an undrafted player is priced off the
 * UPCOMING draft's ADP (current market value), not the ADP of a season that
 * already happened - see fetchUpcomingAdp().
 */
async function fetchSeasonDraftData(leagueObj, primaryUserIdMap) {
  const leagueId = String(leagueObj.league_id);
  const [rosters, drafts] = await Promise.all([
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/drafts`),
  ]);
  const completed = findCompletedDraft(drafts);
  if (!completed) return null;

  const rosterIdToOwnerId = {};
  for (const r of rosters) {
    if (r.owner_id) rosterIdToOwnerId[r.roster_id] = r.owner_id;
  }
  const rawPicks = await fetchWithRetry(`${SLEEPER_BASE}/draft/${completed.draft_id}/picks`);

  return {
    season: String(leagueObj.season),
    teamCount: leagueObj.total_rosters || rosters.length,
    scoringFormat: scoringFormatFromLeagueObj(leagueObj),
    rounds: completed.settings?.rounds ?? null,
    picks: parseDraftPicks(rawPicks, rosterIdToOwnerId, primaryUserIdMap),
    // End-of-season rosters: how the engine tells a keeper ("was on my roster
    // in December AND drafted by me in August") apart from a plain re-draft.
    playersByOwner: parseRostersByOwner(rosters, primaryUserIdMap),
  };
}

/**
 * ADP for the UPCOMING draft, which is what rule 6 ("two rounds below their
 * ADP") actually needs - a player who went undrafted last year and broke out
 * is priced on what he'd cost NOW, not on his stale preseason ADP from the
 * season that just ended.
 *
 * Deliberately decoupled from the per-season draft records: the upcoming
 * season has no completed draft (that's the point), so there's no draft entry
 * to hang it off. Team count / round count are carried over from the most
 * recent real draft. Falls back to the latest completed season's ADP if the
 * upcoming year isn't published yet (Sleeper posts it in the spring).
 */
async function fetchUpcomingAdp(latestSeason) {
  if (!latestSeason) return null;
  const upcomingSeason = String(Number(latestSeason.season) + 1);

  for (const season of [upcomingSeason, latestSeason.season]) {
    try {
      const rawAdpRows = await fetchWithRetry(adpProjectionsUrl(season));
      const adpByPlayerId = parseAdpRows(rawAdpRows, latestSeason.scoringFormat);
      const count = Object.keys(adpByPlayerId).length;
      if (count === 0) {
        console.warn(`  [keepers] ${season} ADP came back empty, trying an earlier season...`);
        continue;
      }
      if (season !== upcomingSeason) {
        console.warn(`  [keepers] ${upcomingSeason} ADP not published yet - falling back to ${season}.`);
      }
      console.log(`  [keepers] upcoming ADP: ${count} entries from ${season} (${latestSeason.scoringFormat}).`);
      return {
        season,
        teamCount: latestSeason.teamCount,
        rounds: latestSeason.rounds,
        adpByPlayerId,
      };
    } catch (err) {
      console.warn(`  [keepers] ADP fetch failed for ${season}: ${err.message}`);
    }
  }
  console.warn(`  [keepers] No ADP available - undrafted-player keeper costs will show as unknown.`);
  return null;
}

/**
 * Build src/leagues/<slug>/data/drafts.json for a keeper league:
 * `{ seasons: SeasonDraftData[], upcomingAdp: UpcomingAdp|null }`, covering
 * every season in `chain` with a completed draft (INCLUDING the current one -
 * unlike historical.json, which deliberately excludes it, see file header).
 *
 * Recorded seasons are append-only so past keeper rounds stay stable across
 * rebuilds. `upcomingAdp` is the opposite - it's a live market snapshot and is
 * always re-fetched. (In CI the data dir is gitignored and starts empty, so
 * the append-only path only really benefits local iteration.)
 */
async function buildKeeperDraftHistory(slug, chain, primaryUserIdMap) {
  const outPath = path.join(leaguesDir, slug, "data", "drafts.json");
  let existingSeasons = [];
  try {
    const prior = JSON.parse(await readFile(outPath, "utf-8"));
    existingSeasons = Array.isArray(prior) ? prior : prior.seasons || [];
  } catch {
    // No prior drafts.json for this league yet - first run.
  }
  const recorded = new Set(existingSeasons.map((sd) => sd.season));

  const seasons = [...existingSeasons];
  for (const leagueObj of chain) {
    const season = String(leagueObj.season);
    if (recorded.has(season)) continue;

    const seasonDraftData = await fetchSeasonDraftData(leagueObj, primaryUserIdMap);
    if (!seasonDraftData) {
      console.log(`  [keepers] ${season}: no completed draft yet, skipping.`);
      continue;
    }
    seasons.push(seasonDraftData);
    console.log(
      `  [keepers] ${season}: recorded ${seasonDraftData.picks.length} draft picks, ${Object.keys(seasonDraftData.playersByOwner).length} end-of-season rosters.`
    );
  }

  seasons.sort((a, b) => Number(a.season) - Number(b.season));
  const upcomingAdp = await fetchUpcomingAdp(seasons[seasons.length - 1] || null);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({ seasons, upcomingAdp }));
  console.log(`  [keepers] drafts.json: ${seasons.length} season(s) on file.`);
}

async function buildLeague(config) {
  console.log(`\n=== ${config.slug} (${config.name}) ===`);
  const chain = await walkSeasonChain(config.currentLeagueId);
  if (chain.length === 0) {
    throw new Error(`[${config.slug}] No seasons found walking previous_league_id from ${config.currentLeagueId}`);
  }

  // UNVERIFIED (see file header): this dev sandbox cannot reach api.sleeper.app,
  // so `status === 'complete'` has not been confirmed against real league
  // objects. Check this on the very first real run's logs - if historical
  // seasons aren't being detected (or the current season IS being treated as
  // historical), this condition needs adjusting. season_type/leg/week or a
  // date-based cutoff may be a better/complementary signal - inspect a few
  // real `GET /v1/league/{id}` responses (one you know finished, one you know
  // is mid-season) before changing this.
  const historicalSeasons = chain.filter((l) => l.status === "complete");
  const currentSeason = chain[chain.length - 1];
  console.log(
    `  ${chain.length} season(s) in chain, ${historicalSeasons.length} marked "complete" (historical).` +
      (historicalSeasons.includes(currentSeason) ? "" : ` Current season (${currentSeason.season}, status="${currentSeason.status}") excluded - fetched live client-side instead.`)
  );

  // One /users call against the current season resolves co-owner primary ids
  // for the whole history (Sleeper user_id is stable across seasons/leagues).
  const currentUsers = await fetchWithRetry(`${SLEEPER_BASE}/league/${config.currentLeagueId}/users`);
  const primaryUserIdMap = buildPrimaryUserIdMap(config.coOwnerConfig, currentUsers);

  if (config.rulesContent?.keeperRules) {
    console.log(`  Keeper league detected - fetching draft/ADP history for the Keeper Assistant tab...`);
    await buildKeeperDraftHistory(config.slug, chain, primaryUserIdMap);
  }

  if (historicalSeasons.length === 0) {
    console.log(`  No historical seasons yet - writing empty historical.json/aggregates.json.`);
    await writeLeagueData(config.slug, [], aggregateSeasons([]));
    return;
  }

  console.log(`  Fetching NFL player database...`);
  const nflPlayers = await fetchWithRetry(`${SLEEPER_BASE}/players/nfl`);

  const seasonDataArray = [];
  let previousSeasonRosters = null;
  for (const leagueObj of historicalSeasons) {
    console.log(`  Fetching season ${leagueObj.season} (league ${leagueObj.league_id})...`);
    const raw = await fetchHistoricalSeasonRaw(leagueObj);
    const seasonData = processSeason({
      leagueObj,
      ...raw,
      nflPlayers,
      managerInfoMap: config.managerInfoMap || {},
      primaryUserIdMap,
      previousSeasonRosters,
    });
    seasonDataArray.push(seasonData);
    previousSeasonRosters = raw.rosters;
  }

  const aggregate = aggregateSeasons(seasonDataArray);
  await writeLeagueData(config.slug, seasonDataArray, aggregate);
  console.log(`  Done: ${seasonDataArray.length} season(s) frozen through ${aggregate.throughSeason}.`);
}

async function writeLeagueData(slug, historical, aggregates) {
  const outDir = path.join(leaguesDir, slug, "data");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "historical.json"), JSON.stringify(historical));
  await writeFile(path.join(outDir, "aggregates.json"), JSON.stringify(aggregates));
}

async function main() {
  const configs = await loadLeagueConfigs();
  console.log(`Found ${configs.length} league config(s): ${configs.map((c) => c.slug).join(", ")}`);
  for (const config of configs) {
    try {
      await buildLeague(config);
    } catch (err) {
      console.error(`\n[FATAL] Failed building "${config.slug}": ${err.message}`);
      console.error(err.stack);
      process.exitCode = 1;
    }
  }
}

main();
