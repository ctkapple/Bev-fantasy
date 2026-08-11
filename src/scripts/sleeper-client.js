/**
 * sleeper-client.js
 *
 * Browser-side fetch for the ONE current in-progress season, cached in
 * localStorage for ~1hr so repeat visits within that window skip the network
 * entirely. This deliberately does NOT walk previous_league_id - historical
 * seasons are pre-built and shipped as static JSON (see data-build/fetch-sleeper.js);
 * this only ever touches the single league id the caller passes in.
 *
 * Usage (see merge.js for how the result combines with static aggregates):
 *   import { getCurrentSeasonData } from './sleeper-client.js';
 *   const live = await getCurrentSeasonData(leagueConfig); // leagueConfig = the same shape as src/leagues/<slug>.json
 */
import { fetchWithRetry } from "../../data-build/fetch-with-retry.js";
import { processSeason, buildPrimaryUserIdMap } from "./season-processor.mjs";

const SLEEPER_BASE = "https://api.sleeper.app/v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
// Bumped to v2: v1 payloads were cached with a playerInfoLookup built only
// from matchup weeks, which is empty in the off-season (see season-processor.mjs
// step 5b). Without a bump those stale entries keep resolving every player to
// "Unknown Player" for up to CACHE_TTL_MS after this ships.
const CACHE_VERSION = "v2";

function cacheKey(slug, leagueId) {
  return `bf:${slug}:current:${leagueId}:${CACHE_VERSION}`;
}

function readCache(slug, leagueId) {
  try {
    const raw = localStorage.getItem(cacheKey(slug, leagueId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // localStorage unavailable (private mode, quota, etc.) - treat as no cache.
  }
}

function writeCache(slug, leagueId, payload) {
  try {
    localStorage.setItem(cacheKey(slug, leagueId), JSON.stringify({ fetchedAt: Date.now(), payload }));
  } catch {
    // Storage full/unavailable - non-fatal, just means every load re-fetches.
  }
}

async function fetchCompletedWeekCutoff() {
  const state = await fetchWithRetry(`${SLEEPER_BASE}/state/nfl`);
  if (state.season_type === "regular" || state.season_type === "post") {
    return state.week > 0 ? state.week - 1 : 0;
  }
  return 0; // pre-season / off-season - no completed weeks to fetch yet
}

async function fetchWeeklyMap(leagueId, endpoint, maxWeek) {
  const result = {};
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
  await Promise.all(
    weeks.map(async (week) => {
      try {
        const data = await fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/${endpoint}/${week}`);
        if (data && data.length > 0) result[week] = data;
      } catch {
        // Missing/unplayed week - expected, not an error.
      }
    })
  );
  return result;
}

async function fetchLiveSeason(leagueConfig) {
  const leagueId = leagueConfig.currentLeagueId;
  const [leagueObj, users, rosters, cutoff] = await Promise.all([
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}`),
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/users`),
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
    fetchCompletedWeekCutoff(),
  ]);

  const primaryUserIdMap = buildPrimaryUserIdMap(leagueConfig.coOwnerConfig, users);

  const [matchupsByWeek, transactionsByWeek, winnersBracket, losersBracket, nflPlayers] = await Promise.all([
    fetchWeeklyMap(leagueId, "matchups", cutoff),
    fetchWeeklyMap(leagueId, "transactions", cutoff),
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/winners_bracket`).catch(() => null),
    fetchWithRetry(`${SLEEPER_BASE}/league/${leagueId}/losers_bracket`).catch(() => null),
    // Only the (large, ~5000-entry) player DB, on demand, for the live season only.
    // Cached separately with a longer TTL since it changes rarely (roster moves aside).
    getNflPlayers(),
  ]);

  return processSeason({
    leagueObj,
    users,
    rosters,
    matchupsByWeek,
    transactionsByWeek,
    winnersBracket,
    losersBracket,
    nflPlayers,
    managerInfoMap: leagueConfig.managerInfoMap || {},
    primaryUserIdMap,
    // Not wired up: `lastSeasonRosterSnapshots` (from aggregates.json) uses
    // canonicalized ownerId, not the raw owner_id previousSeasonRosters needs -
    // the two shapes don't line up cleanly enough for a same-session adapter.
    // Practical effect: the live season's newly-kept players won't appear in
    // "Loyalty Club" until the next full rebuild re-derives it from scratch.
    previousSeasonRosters: null,
  });
}

const PLAYERS_CACHE_KEY = `bf:nflplayers:${CACHE_VERSION}`;
const PLAYERS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours - the player DB barely changes day to day

async function getNflPlayers() {
  try {
    const raw = localStorage.getItem(PLAYERS_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (Date.now() - cached.fetchedAt < PLAYERS_CACHE_TTL_MS) return cached.payload;
    }
  } catch {
    // fall through to a live fetch
  }
  const players = await fetchWithRetry(`${SLEEPER_BASE}/players/nfl`);
  try {
    localStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), payload: players }));
  } catch {
    // Quota exceeded (this payload is multi-MB) - non-fatal, just re-fetches next time.
  }
  return players;
}

/**
 * @param {object} leagueConfig - Same shape as src/leagues/<slug>.json.
 * @returns {Promise<import('./season-processor.mjs').SeasonData|null>} null if both the live fetch AND any cached fallback are unavailable.
 */
export async function getCurrentSeasonData(leagueConfig) {
  const cached = readCache(leagueConfig.slug, leagueConfig.currentLeagueId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.payload;
  }

  try {
    const payload = await fetchLiveSeason(leagueConfig);
    writeCache(leagueConfig.slug, leagueConfig.currentLeagueId, payload);
    return payload;
  } catch (err) {
    console.warn(`[sleeper-client] Live fetch failed for ${leagueConfig.slug}, serving stale cache if any:`, err);
    return cached ? cached.payload : null; // stale-on-failure beats a blank page
  }
}
