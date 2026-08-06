/**
 * season-processor.mjs
 *
 * Shared, isomorphic stats engine for the Bev-Fantasy v2 rebuild. This module
 * is a faithful port of the per-page `processSeason()` / `calculateAndSortRecords()`
 * / "My Team" derived-stat logic that is currently hand-duplicated across
 * jrwll.html (most complete, 11 tabs), sb3.html (9 tabs, adds Draft Odds,
 * co-owner merging), and bb.html (6 tabs, subset).
 *
 * DESIGN CONSTRAINTS (do not violate):
 *   - Zero Node-only globals (no `fs`, `process`, `Buffer`, ...).
 *   - Zero browser-only globals (no `document`, `window`, `localStorage`, ...).
 *   - Every exported function is PURE: given the same inputs it returns the
 *     same plain-JSON-serializable output, with no I/O and no hidden state.
 *     Network fetching lives in data-build/fetch-sleeper.js (Node, historical
 *     seasons) and src/scripts/sleeper-client.js (browser, live current season).
 *
 * WHY THIS SHAPE: `processSeason()` consumes exactly the raw payloads Sleeper
 * returns for ONE season (users, rosters, matchups per week, transactions per
 * week, winners/losers brackets) and returns a self-contained `SeasonData`
 * object. `aggregateSeasons()` then folds an array of `SeasonData` (one per
 * season, oldest first) into a single `AggregateData` object that powers every
 * "all-time" view (Dashboard, Records, My Team, Legacies). Because the fold is
 * expressed as an explicit accumulator step (`foldSeasonIntoAccumulator`) that
 * both `aggregateSeasons()` and `mergeAggregates()` (see merge.js) share, a
 * single freshly-fetched *current* season can be layered on top of a frozen
 * historical `AggregateData` without recomputing history from scratch.
 *
 * PORTING NOTES / DELIBERATE DEVIATIONS FROM THE ORIGINAL HTML FILES
 * (also called out inline near the relevant code, and repeated in the final
 * task summary):
 *
 *   1. Week selection is now the CALLER's responsibility. jrwll.html asks
 *      `/v1/state/nfl` to figure out which weeks of the *current* season are
 *      "completed" and only fetches those; sb3.html/bb.html just loop weeks
 *      1-18 unconditionally and swallow 404s. `processSeason()` doesn't care
 *      which strategy produced its input — it simply processes whatever weeks
 *      are present as keys of `matchupsByWeek` / `transactionsByWeek`. The
 *      week-selection policy now lives entirely in fetch-sleeper.js (uses the
 *      `state.nfl`-derived cutoff for historical builds) and sleeper-client.js
 *      (uses it for the live current season). This also means the playoff
 *      "championship week" matchup is read straight out of `matchupsByWeek`
 *      instead of being fetched again with a second network call.
 *
 *   2. `totalTeams` uses `rosters.length`, matching sb3.html rather than
 *      jrwll.html/bb.html's `users.length`. sb3 has co-owned teams where two
 *      Sleeper *user* accounts share one *roster* — `users.length` overcounts
 *      in that case. `rosters.length` is correct for all three leagues (it
 *      equals `users.length` whenever there are no co-owners), so it was
 *      adopted uniformly. See PRIMARY-ID NORMALIZATION below.
 *
 *   3. PRIMARY-ID NORMALIZATION (co-owner merging, sb3-only today but general
 *      to the engine): sb3.html merges two Sleeper accounts that jointly own
 *      one roster (e.g. 'cmcole17' + 'kpflats') into a single manager via a
 *      `primaryUserIdMap`. Rather than create a manager stub for the
 *      secondary account and filter it out of every render function (as the
 *      original does in renderPowerRankings/renderTrophyCase/
 *      setupMyTeamSelector...), this module simply never creates a stub for a
 *      secondary id: `managers` in `SeasonData` is keyed by canonical
 *      (primary) id only. Build a `primaryUserIdMap` once (secondary
 *      Sleeper `user_id` -> primary Sleeper `user_id`) and pass it into every
 *      `processSeason()` call for that league; pass `{}` for leagues with no
 *      co-owners.
 *
 *   4. `reigningChampionId` in `AggregateData` is defined as "the champion of
 *      the chronologically-last season in the input array whose championship
 *      was resolved" instead of the original
 *      `Object.values(managersData).find(m => m.stats.championship_years.includes(new Date().getFullYear() - 1))`.
 *      The original is wall-clock-dependent and silently produces nothing in
 *      the (common) case where the app is opened before the prior season's
 *      championship data has synced, or right after Jan 1. The new
 *      definition is deterministic given the same season data and needs no
 *      notion of "now" — a page rendered any day of the year gets the same
 *      answer. This is an intentional improvement, not a faithfulness bug.
 *
 *   5. Toilet Bowl (jrwll-only) and Draft Odds (sb3-only) are NOT baked into
 *      `SeasonData`/`AggregateData` as first-class computed sections beyond
 *      what's naturally available (`SeasonData.toiletBowl` from the losers
 *      bracket, and `SeasonData.rosterSnapshots` which carries everything
 *      Draft Odds needs: wins/losses/pf/ppts/rank per roster). Both tabs also
 *      lean on hand-curated, non-Sleeper data (punishment ledger photos,
 *      manual 2021 toilet bowl correction, "Toilet King" manual award list,
 *      championship score overrides for 2021/2022) that belongs in league
 *      config (`src/leagues/<slug>.json`), not in data fetched from Sleeper.
 *      Template code should treat both tabs as optional/conditional on the
 *      league config's `tabs` array, exactly like the original nav.
 *
 *   6. Earnings tabs are ENTIRELY hand-curated dollar figures in all three
 *      source files (jrwll: a fully manual year-by-year + props + high-score
 *      table; bb: computed from a `payouts` map keyed by year x championship
 *      count; sb3: no earnings tab at all). None of this is derivable from
 *      the Sleeper API, so it intentionally is NOT part of `SeasonData` /
 *      `AggregateData`. It belongs in league config as static data and is out
 *      of scope for this module. See SCHEMA.md.
 *
 *   7. Franchise Cornerstones (all-time per-player weeks/points/years on a
 *      manager's roster) and the underlying `pointsScoredByPlayer` (points
 *      scored by STARTERS only) exist only in jrwll.html. sb3.html/bb.html
 *      track `rosteredPlayers` (weeks-on-roster counts) but never
 *      `pointsScoredByPlayer` and have no Cornerstones UI. This module always
 *      computes both (`rosteredPlayerWeeks` and `startersPointsByPlayer`) for
 *      every league since it's cheap and jrwll's version is a strict
 *      superset — sb3/bb templates can simply choose not to render the
 *      Cornerstones table.
 *
 * See /home/user/Bev-fantasy/data-build/SCHEMA.md for the full field-by-field
 * reference of everything below, organized by which UI tab consumes it.
 */

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const PLACEHOLDER_AVATAR = "https://placehold.co/48x48/1f2937/a0aec0?text=%F0%9F%8F%88";

/** Parse Sleeper's split whole/decimal point representation, e.g. fpts=123, fpts_decimal=45 -> 123.45. */
function parseSleeperDecimal(whole, decimal) {
  const w = whole ?? 0;
  const d = decimal ?? 0;
  const parsed = parseFloat(`${w}.${d}`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function playerFullName(player) {
  if (!player) return "Unknown Player";
  return `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim() || "Unknown Player";
}

/** Resolve a raw Sleeper `user_id` to its canonical (primary, co-owner-merged) id. */
function canonicalManagerId(userId, primaryUserIdMap) {
  return primaryUserIdMap[userId] || userId;
}

/**
 * Build a `roster_id -> canonical manager user_id` lookup for one season.
 * @param {Array<object>} rosters - Raw Sleeper `/rosters` response.
 * @param {Object<string,string>} primaryUserIdMap
 */
function buildRosterIdToManagerId(rosters, primaryUserIdMap) {
  const map = {};
  for (const r of rosters) {
    if (r.owner_id) {
      map[r.roster_id] = canonicalManagerId(r.owner_id, primaryUserIdMap);
    }
  }
  return map;
}

/** Expand a starters array + players_points map into display-ready roster rows. */
function getRosterDetails(starters, playersPoints, nflPlayers) {
  if (!starters) return [];
  return starters.map((playerId) => {
    const player = nflPlayers[playerId];
    const score = playersPoints ? playersPoints[playerId] || 0 : 0;
    return player
      ? { playerId, name: playerFullName(player), position: player.position || "N/A", score }
      : { playerId, name: "Unknown Player", position: "N/A", score };
  });
}

/**
 * Create a fresh, empty per-season manager accumulator.
 * @param {string} userId - Canonical (primary) manager id.
 * @param {string} displayName
 * @param {string} avatar
 */
function newManagerSeasonEntry(userId, displayName, avatar) {
  return {
    userId,
    displayName,
    avatar,
    teamName: null,
    rosterId: null,
    wins: 0,
    losses: 0,
    ties: 0,
    pf: 0,
    pa: 0,
    rank: null,
    transactions: 0,
    trades: 0,
    isChampion: false,
    isRunnerUp: false,
    players: [],
    rosteredPlayerWeeks: {},
    startersPointsByPlayer: {},
    pointsAgainstByPlayer: {},
  };
}

// ---------------------------------------------------------------------------
// processSeason
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SeasonDataManager
 * Per-manager stats scoped to a single season. Keyed by canonical manager
 * `userId` inside `SeasonData.managers`.
 * @property {string} userId
 * @property {string} displayName - Resolved via league config's `managerInfoMap`, falls back to Sleeper `display_name`.
 * @property {string} avatar - Resolved via `managerInfoMap`, falls back to the Sleeper CDN avatar URL, falls back to a placeholder.
 * @property {string|null} teamName - This season's team display name (`user.metadata.team_name` or `display_name`).
 * @property {number|null} rosterId - Sleeper `roster_id` for this manager this season.
 * @property {number} wins
 * @property {number} losses
 * @property {number} ties
 * @property {number} pf - Points for, season total (regular season, per Sleeper roster settings).
 * @property {number} pa - Points against, season total.
 * @property {number|null} rank - Final standing (1 = best). From `roster.settings.rank` when Sleeper has assigned it;
 *   otherwise computed by sorting rosters by wins desc, then pf desc (mirrors the original's fallback). Will be `null`
 *   only if the roster has no owner at all.
 * @property {number} transactions - Count of ALL transactions (adds/drops/waivers/trades) touching this manager's roster this season.
 * @property {number} trades - Count of completed trades this manager participated in this season.
 * @property {boolean} isChampion - True if this manager won the championship game this season.
 * @property {boolean} isRunnerUp - True if this manager lost the championship game this season.
 * @property {string[]} players - Every distinct Sleeper `player_id` that appeared on this manager's roster (any week, bench or starter) this season. Used for keeper/cornerstone tenure tracking across seasons.
 * @property {Object<string,number>} rosteredPlayerWeeks - `player_id -> number of weeks rostered` (bench+starter, ALL weeks fetched including playoffs), this season only.
 * @property {Object<string,number>} startersPointsByPlayer - `player_id -> total fantasy points scored while a STARTER for this manager` (ALL weeks fetched including playoffs), this season only.
 * @property {Object<string,number>} pointsAgainstByPlayer - `player_id -> total fantasy points that player scored against this manager` (regular season only, opponent's players_points summed per matchup), this season only.
 */

/**
 * @typedef {object} SeasonDataMatchup
 * One regular-season head-to-head matchup, deduplicated (appears once, not once per side).
 * @property {number} week
 * @property {string} manager1Id
 * @property {string} manager2Id
 * @property {number} score1
 * @property {number} score2
 * @property {number} margin - abs(score1 - score2)
 * @property {number} totalScore - score1 + score2
 * @property {Object<string,number>|undefined} playerPoints1 - manager1's `players_points` map for this matchup (used by the H2H tab's "arch-nemesis" calc).
 * @property {Object<string,number>|undefined} playerPoints2
 */

/**
 * @typedef {object} SeasonDataTrade
 * @property {string} tradeId - Sleeper `transaction_id`.
 * @property {number} date - `status_updated` epoch ms.
 * @property {Object<string, Array<{type: 'player'|'pick'|'faab', playerId?: string, name?: string, position?: string, season?: string, round?: number, amount?: number}>>} pieces
 *   `managerId -> array of pieces that manager RECEIVED in the trade`. Mirrors `getTradePieces()` from the original
 *   HTML but pre-resolved (player names looked up against `nflPlayers` at build/fetch time) so templates never need
 *   the full NFL player database at render time.
 */

/**
 * @typedef {object} SeasonDataRosterEntry
 * Snapshot of one roster's raw standings-relevant fields, kept around for the (optional/conditional, sb3-only)
 * Draft Odds tab and for keeper/cornerstone diffing between seasons.
 * @property {number} rosterId
 * @property {string|null} ownerId - Canonical manager id, or null if the roster has no owner.
 * @property {string[]} players - All players on the roster at fetch time (bench + starters).
 * @property {number} wins
 * @property {number} losses
 * @property {number} ties
 * @property {number} pf
 * @property {number} ppts - "Potential points" (max possible starting lineup score), Sleeper's `ppts`/`ppts_decimal`.
 * @property {number|null} rank
 */

/**
 * @typedef {object} SeasonDataChampionshipResult
 * @property {string} winnerId
 * @property {Array<{playerId:string,name:string,position:string,score:number}>} winnerRoster - Starting lineup only.
 * @property {number} winnerScore
 * @property {string} loserId
 * @property {Array<{playerId:string,name:string,position:string,score:number}>} loserRoster
 * @property {number} loserScore
 */

/**
 * @typedef {object} SeasonData
 * Everything derived from ONE season's worth of raw Sleeper responses. Returned by `processSeason()`.
 * @property {string} season - Sleeper season year as a string, e.g. "2021".
 * @property {string} leagueId - Sleeper `league_id` for this season (each season is a distinct league object in Sleeper).
 * @property {string} leagueName - `leagueObj.name` for this season.
 * @property {string|null} leagueAvatar - `https://sleepercdn.com/avatars/${leagueObj.avatar}` or null.
 * @property {number} totalTeams - `rosters.length`. See file-level porting note #2 for why this beats `users.length`.
 * @property {boolean} championFound - True if the winners bracket final was resolved (both roster ids known) this season.
 * @property {Object<string, SeasonDataManager>} managers - Keyed by canonical manager `userId`.
 * @property {Array<{managerId:string, week:number, score:number}>} weeklyScores - One entry per manager per regular-season week.
 * @property {Array<{playerId:string,name:string,position:string,team:string|null,managerId:string,week:number,score:number}>} playerWeeklyScores -
 *   One entry per player per regular-season week they had a `players_points` entry for (bench + starters), attributed to whichever manager rostered them that week.
 * @property {SeasonDataMatchup[]} matchups - Deduplicated regular-season matchups.
 * @property {SeasonDataTrade[]} trades - Completed trades this season, most-recent-first.
 * @property {Array<{managerId:string,player:string,position:string,amount:number}>} faabBids - Completed waiver-budget acquisitions.
 * @property {SeasonDataChampionshipResult|null} championship - Null if the winners bracket final couldn't be resolved (e.g. season in progress).
 * @property {{punishedId:string, punishedRoster:Array<{playerId:string,name:string,position:string,score:number}>, punishedScore:number, safeId:string, safeRoster:Array<{playerId:string,name:string,position:string,score:number}>, safeScore:number}|null} toiletBowl -
 *   From the losers bracket final. Null if unavailable (bracket missing, or league doesn't run one). jrwll-only concept; harmless empty value for other leagues.
 * @property {Array<{playerId:string,name:string,position:string,managerId:string}>} keptPlayers - Players present on the same manager's roster in both this season and the immediately preceding one (per `previousSeasonRosters` input). Empty if `previousSeasonRosters` wasn't provided (e.g. the very first season in a league's history, or a live current-season fetch that didn't supply it).
 * @property {SeasonDataRosterEntry[]} rosterSnapshots - Raw roster/standings snapshot, one per Sleeper roster.
 */

/**
 * Process ONE season's raw Sleeper API responses into a self-contained `SeasonData` object.
 *
 * PURE FUNCTION: no network calls, no mutation of inputs, deterministic output.
 *
 * @param {object} args
 * @param {object} args.leagueObj - Raw response from `GET /v1/league/{league_id}` for this season.
 * @param {Array<object>} args.users - Raw response from `GET /v1/league/{league_id}/users`.
 * @param {Array<object>} args.rosters - Raw response from `GET /v1/league/{league_id}/rosters`.
 * @param {Object<number|string, Array<object>>} args.matchupsByWeek - `week -> raw /matchups/{week} response`, for
 *   every week the caller wants processed (regular season AND playoff weeks — the championship/toilet-bowl lookups
 *   read the playoff weeks straight out of this map, so include them or those sections come back null/incomplete).
 * @param {Object<number|string, Array<object>>} [args.transactionsByWeek] - `week -> raw /transactions/{week} response`. Optional; omit or pass `{}` to skip transaction/trade/FAAB processing (e.g. a quick partial refresh).
 * @param {Array<object>|null} [args.winnersBracket] - Raw `/winners_bracket` response, or null/empty if unavailable (season in progress, or fetch failed).
 * @param {Array<object>|null} [args.losersBracket] - Raw `/losers_bracket` response, or null/empty.
 * @param {Object<string,object>} args.nflPlayers - Raw `/v1/players/nfl` response (`player_id -> {first_name,last_name,position,team,...}`).
 * @param {Object<string,{name:string,avatar:string}>} [args.managerInfoMap] - League config's manager display overrides, keyed by lowercased Sleeper `display_name`.
 * @param {Object<string,string>} [args.primaryUserIdMap] - Canonical co-owner map: secondary Sleeper `user_id` -> primary `user_id`. Pass `{}` for leagues without co-owners. See file-level porting note #3.
 * @param {Array<object>|null} [args.previousSeasonRosters] - Raw `rosters` array (same shape as `args.rosters`) from the immediately preceding season, used to compute `keptPlayers`. Pass `null`/omit for a league's first season, or when the caller doesn't have it handy (keptPlayers will be `[]`).
 * @returns {SeasonData}
 */
export function processSeason({
  leagueObj,
  users,
  rosters,
  matchupsByWeek,
  transactionsByWeek = {},
  winnersBracket = null,
  losersBracket = null,
  nflPlayers,
  managerInfoMap = {},
  primaryUserIdMap = {},
  previousSeasonRosters = null,
}) {
  const season = String(leagueObj.season);
  const playoffWeekStart = leagueObj.settings?.playoff_week_start ?? 15;
  const managers = {};

  const rosterIdToManagerId = buildRosterIdToManagerId(rosters, primaryUserIdMap);

  // -- 1. Seed manager stubs from `users`, keyed by CANONICAL id only. --------
  // (See porting note #3: secondary co-owner accounts never get their own stub.)
  for (const user of users) {
    const canonicalId = canonicalManagerId(user.user_id, primaryUserIdMap);
    const usernameLower = (user.display_name || "").toLowerCase();
    const customInfo = managerInfoMap[usernameLower];
    const displayName = customInfo ? customInfo.name : user.display_name;
    const avatar = customInfo
      ? customInfo.avatar
      : user.avatar
        ? `https://sleepercdn.com/avatars/${user.avatar}`
        : PLACEHOLDER_AVATAR;

    if (!managers[canonicalId]) {
      managers[canonicalId] = newManagerSeasonEntry(canonicalId, displayName, avatar);
    }
    // First user encountered for a canonical id "wins" the team-name-for-this-season slot,
    // matching the original's `hasYear` de-dupe behavior for co-owned teams.
    if (managers[canonicalId].teamName === null) {
      managers[canonicalId].teamName = user.metadata?.team_name || user.display_name;
    }
  }

  // -- 2. Roster-level base stats (record, points, rank). ---------------------
  for (const r of rosters) {
    if (!r.owner_id) continue;
    const canonicalId = canonicalManagerId(r.owner_id, primaryUserIdMap);
    const m = managers[canonicalId];
    if (!m) continue;
    m.rosterId = r.roster_id;
    m.wins += r.settings?.wins ?? 0;
    m.losses += r.settings?.losses ?? 0;
    m.ties += r.settings?.ties ?? 0;
    const pf = parseSleeperDecimal(r.settings?.fpts, r.settings?.fpts_decimal);
    const pa = parseSleeperDecimal(r.settings?.fpts_against, r.settings?.fpts_against_decimal);
    m.pf += pf;
    m.pa += pa;
  }

  const ranksAssignedViaApi = rosters.some((r) => r.owner_id && r.settings?.rank);
  if (ranksAssignedViaApi) {
    for (const r of rosters) {
      if (!r.owner_id || !r.settings?.rank) continue;
      const canonicalId = canonicalManagerId(r.owner_id, primaryUserIdMap);
      if (managers[canonicalId]) managers[canonicalId].rank = r.settings.rank;
    }
  } else if (rosters.some((r) => r.owner_id)) {
    const standings = rosters
      .filter((r) => r.owner_id)
      .map((r) => ({
        canonicalId: canonicalManagerId(r.owner_id, primaryUserIdMap),
        wins: r.settings?.wins ?? 0,
        pf: parseSleeperDecimal(r.settings?.fpts, r.settings?.fpts_decimal),
      }))
      .sort((a, b) => b.wins - a.wins || b.pf - a.pf);
    standings.forEach((s, index) => {
      if (managers[s.canonicalId] && managers[s.canonicalId].rank === null) {
        managers[s.canonicalId].rank = index + 1;
      }
    });
  }

  // -- 3. Roster snapshots (Draft Odds inputs + cross-season keeper diffing). -
  const rosterSnapshots = rosters.map((r) => ({
    rosterId: r.roster_id,
    ownerId: r.owner_id ? canonicalManagerId(r.owner_id, primaryUserIdMap) : null,
    players: r.players || [],
    wins: r.settings?.wins ?? 0,
    losses: r.settings?.losses ?? 0,
    ties: r.settings?.ties ?? 0,
    pf: parseSleeperDecimal(r.settings?.fpts, r.settings?.fpts_decimal),
    ppts: parseSleeperDecimal(r.settings?.ppts, r.settings?.ppts_decimal),
    rank: r.settings?.rank ?? null,
  }));

  // -- 4. Kept players (this season's roster vs. previous season's roster). --
  const keptPlayers = [];
  if (previousSeasonRosters && previousSeasonRosters.length > 0) {
    for (const currentRoster of rosters) {
      if (!currentRoster.owner_id || !currentRoster.players) continue;
      const prevRoster = previousSeasonRosters.find((pr) => pr.owner_id === currentRoster.owner_id);
      if (!prevRoster || !prevRoster.players) continue;
      const canonicalId = canonicalManagerId(currentRoster.owner_id, primaryUserIdMap);
      const keptIds = currentRoster.players.filter((pId) => prevRoster.players.includes(pId));
      for (const playerId of keptIds) {
        const playerInfo = nflPlayers[playerId];
        if (!playerInfo) continue;
        keptPlayers.push({
          playerId,
          name: playerFullName(playerInfo),
          position: playerInfo.position || "N/A",
          managerId: canonicalId,
        });
      }
    }
  }

  // -- 5. Weekly matchups: rostered players (ALL weeks), scores (regular season only). --
  const weeklyScores = [];
  const playerWeeklyScores = [];
  const matchups = [];

  const weeks = Object.keys(matchupsByWeek)
    .map(Number)
    .sort((a, b) => a - b);

  for (const week of weeks) {
    const weekMatchups = matchupsByWeek[week] || [];

    // Rostered-player tenure + starters' points: tracked for EVERY week fetched,
    // including playoffs (matches the original, which does this ahead of the
    // `week < playoff_week_start` gate).
    for (const matchup of weekMatchups) {
      const canonicalId = rosterIdToManagerId[matchup.roster_id];
      const m = canonicalId && managers[canonicalId];
      if (!m || !matchup.players) continue;
      for (const pId of matchup.players) {
        m.rosteredPlayerWeeks[pId] = (m.rosteredPlayerWeeks[pId] || 0) + 1;
        if (!m.players.includes(pId)) m.players.push(pId);
      }
      if (matchup.players_points && matchup.starters) {
        for (const playerId of matchup.starters) {
          const pts = matchup.players_points[playerId];
          if (pts !== undefined) {
            m.startersPointsByPlayer[playerId] = (m.startersPointsByPlayer[playerId] || 0) + pts;
          }
        }
      }
    }

    if (week >= playoffWeekStart) continue; // Everything below this line is regular-season only.

    const processedMatchupIds = new Set();
    for (const matchup of weekMatchups) {
      const canonicalId = rosterIdToManagerId[matchup.roster_id];
      if (!canonicalId || !managers[canonicalId]) continue;

      if (matchup.players_points) {
        for (const pId in matchup.players_points) {
          const playerInfo = nflPlayers[pId];
          if (!playerInfo) continue;
          playerWeeklyScores.push({
            playerId: pId,
            name: playerFullName(playerInfo),
            position: playerInfo.position || "N/A",
            team: playerInfo.team || null,
            managerId: canonicalId,
            year: season,
            week,
          });
        }
      }
      weeklyScores.push({ managerId: canonicalId, year: season, week, score: matchup.points });

      const opponent = weekMatchups.find(
        (m) => m.matchup_id === matchup.matchup_id && m.roster_id !== matchup.roster_id
      );
      if (!opponent || processedMatchupIds.has(matchup.matchup_id)) continue;
      processedMatchupIds.add(matchup.matchup_id);

      const oppCanonicalId = rosterIdToManagerId[opponent.roster_id];
      if (!oppCanonicalId || !managers[oppCanonicalId]) continue;

      const m1 = managers[canonicalId];
      const m2 = managers[oppCanonicalId];

      if (opponent.players_points) {
        for (const [pId, pts] of Object.entries(opponent.players_points)) {
          m1.pointsAgainstByPlayer[pId] = (m1.pointsAgainstByPlayer[pId] || 0) + pts;
        }
      }
      if (matchup.players_points) {
        for (const [pId, pts] of Object.entries(matchup.players_points)) {
          m2.pointsAgainstByPlayer[pId] = (m2.pointsAgainstByPlayer[pId] || 0) + pts;
        }
      }

      matchups.push({
        week,
        manager1Id: canonicalId,
        manager2Id: oppCanonicalId,
        score1: matchup.points,
        score2: opponent.points,
        margin: Math.abs(matchup.points - opponent.points),
        totalScore: matchup.points + opponent.points,
        playerPoints1: matchup.players_points,
        playerPoints2: opponent.players_points,
      });
    }
  }

  // -- 6. Transactions: totals, trades (resolved), FAAB bids. -----------------
  const trades = [];
  const faabBids = [];

  for (const week of Object.keys(transactionsByWeek)
    .map(Number)
    .sort((a, b) => a - b)) {
    const weekTransactions = transactionsByWeek[week] || [];
    for (const t of weekTransactions) {
      const primaryRosterId = t.roster_ids?.[0];
      const primaryOwnerId = rosterIdToManagerId[primaryRosterId];
      if (primaryOwnerId && managers[primaryOwnerId]) {
        managers[primaryOwnerId].transactions++;
      }

      if (t.type === "trade" && t.status === "complete") {
        const pieces = {};
        for (const rosterId of t.roster_ids || []) {
          const canonicalId = rosterIdToManagerId[rosterId];
          if (canonicalId && managers[canonicalId]) managers[canonicalId].trades++;
        }
        for (const rosterId of t.roster_ids || []) {
          const canonicalId = rosterIdToManagerId[rosterId];
          if (!canonicalId) continue;
          const giverRosterId = (t.roster_ids || []).find((id) => id !== rosterId);
          const receivedPieces = [];
          if (t.adds) {
            for (const [pId, rId] of Object.entries(t.adds)) {
              if (rId !== rosterId) continue;
              const player = nflPlayers[pId];
              receivedPieces.push(
                player
                  ? { type: "player", playerId: pId, name: playerFullName(player), position: player.position || "N/A" }
                  : { type: "player", playerId: pId, name: "Unknown Player", position: "N/A" }
              );
            }
          }
          if (t.draft_picks) {
            for (const pick of t.draft_picks) {
              if (pick.owner_id === rosterId && pick.previous_owner_id === giverRosterId) {
                receivedPieces.push({ type: "pick", season: pick.season, round: pick.round });
              }
            }
          }
          if (t.waiver_budget) {
            for (const budget of t.waiver_budget) {
              if (budget.receiver === rosterId && budget.sender === giverRosterId) {
                receivedPieces.push({ type: "faab", amount: budget.amount });
              }
            }
          }
          pieces[canonicalId] = receivedPieces;
        }
        trades.push({
          tradeId: t.transaction_id,
          date: t.status_updated,
          pieces,
        });
      }

      if (t.type === "waiver" && t.status === "complete" && t.settings?.waiver_bid) {
        const ownerId = rosterIdToManagerId[primaryRosterId];
        const playerId = t.adds ? Object.keys(t.adds)[0] : undefined;
        const player = playerId ? nflPlayers[playerId] : null;
        if (ownerId && managers[ownerId] && player) {
          faabBids.push({
            managerId: ownerId,
            player: playerFullName(player),
            position: player.position || "N/A",
            amount: t.settings.waiver_bid,
          });
        }
      }
    }
  }
  trades.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  // -- 7. Championship (winners bracket final) + toilet bowl (losers bracket final). --
  let championFound = false;
  let championship = null;
  if (winnersBracket && winnersBracket.length > 0) {
    const finalRound = Math.max(...winnersBracket.map((m) => m.r));
    const championshipMatch = winnersBracket.find((m) => m.r === finalRound && m.p === 1);
    if (championshipMatch) {
      const wId = rosterIdToManagerId[championshipMatch.w];
      const lId = rosterIdToManagerId[championshipMatch.l];
      if (wId && managers[wId] && lId && managers[lId]) {
        championFound = true;
        managers[wId].isChampion = true;
        managers[lId].isRunnerUp = true;

        const championshipWeek = playoffWeekStart + finalRound - 1;
        const championshipMatchups = matchupsByWeek[championshipWeek] || [];
        const winnerMatchup = championshipMatchups.find((m) => m.roster_id === championshipMatch.w);
        const loserMatchup = championshipMatchups.find((m) => m.roster_id === championshipMatch.l);

        championship = {
          winnerId: wId,
          winnerRoster: getRosterDetails(winnerMatchup?.starters, winnerMatchup?.players_points, nflPlayers),
          winnerScore: winnerMatchup?.points ?? null,
          loserId: lId,
          loserRoster: getRosterDetails(loserMatchup?.starters, loserMatchup?.players_points, nflPlayers),
          loserScore: loserMatchup?.points ?? null,
        };
      }
    }
  }
  // Fallback used by the original when the bracket fetch fails/is unavailable:
  // fall back to roster.settings.rank 1/2. Only applies if we couldn't resolve
  // a championship from the bracket above.
  if (!championship) {
    const champRoster = rosters.find((r) => r.settings?.rank === 1);
    const runnerUpRoster = rosters.find((r) => r.settings?.rank === 2);
    if (champRoster?.owner_id && runnerUpRoster?.owner_id) {
      const wId = canonicalManagerId(champRoster.owner_id, primaryUserIdMap);
      const lId = canonicalManagerId(runnerUpRoster.owner_id, primaryUserIdMap);
      if (managers[wId] && managers[lId]) {
        championFound = true;
        managers[wId].isChampion = true;
        managers[lId].isRunnerUp = true;
        championship = {
          winnerId: wId,
          winnerRoster: [],
          winnerScore: null,
          loserId: lId,
          loserRoster: [],
          loserScore: null,
        };
      }
    }
  }

  let toiletBowl = null;
  if (losersBracket && losersBracket.length > 0) {
    const finalLoserRound = Math.max(...losersBracket.map((m) => m.r));
    const toiletBowlMatch = losersBracket.find((m) => m.r === finalLoserRound);
    if (toiletBowlMatch) {
      const punishedRoster = rosters.find((r) => r.roster_id === toiletBowlMatch.w);
      const safeRoster = rosters.find((r) => r.roster_id === toiletBowlMatch.l);
      const punishedId = punishedRoster?.owner_id
        ? canonicalManagerId(punishedRoster.owner_id, primaryUserIdMap)
        : null;
      const safeId = safeRoster?.owner_id ? canonicalManagerId(safeRoster.owner_id, primaryUserIdMap) : null;
      if (punishedId && safeId) {
        const toiletBowlWeek = playoffWeekStart + finalLoserRound - 1;
        const toiletBowlMatchups = matchupsByWeek[toiletBowlWeek] || [];
        const punishedMatchup = toiletBowlMatchups.find((m) => m.roster_id === toiletBowlMatch.w);
        const safeMatchup = toiletBowlMatchups.find((m) => m.roster_id === toiletBowlMatch.l);
        if (punishedMatchup && safeMatchup) {
          toiletBowl = {
            punishedId,
            punishedRoster: getRosterDetails(punishedMatchup.starters, punishedMatchup.players_points, nflPlayers),
            punishedScore: punishedMatchup.points,
            safeId,
            safeRoster: getRosterDetails(safeMatchup.starters, safeMatchup.players_points, nflPlayers),
            safeScore: safeMatchup.points,
          };
        }
      }
    }
  }

  return {
    season,
    leagueId: String(leagueObj.league_id),
    leagueName: leagueObj.name,
    leagueAvatar: leagueObj.avatar ? `https://sleepercdn.com/avatars/${leagueObj.avatar}` : null,
    totalTeams: rosters.length,
    championFound,
    managers,
    weeklyScores,
    playerWeeklyScores,
    matchups,
    trades,
    faabBids,
    championship,
    toiletBowl,
    keptPlayers,
    rosterSnapshots,
  };
}

// ---------------------------------------------------------------------------
// aggregateSeasons
// ---------------------------------------------------------------------------

function pairKey(id1, id2) {
  return [id1, id2].sort().join("-");
}

/** Keep only the top/bottom N of (existing ∪ candidates) by comparator. Used both by full aggregation and incremental merge. */
function spliceTopN(existing, candidates, compareFn, n = 5) {
  return [...existing, ...candidates].sort(compareFn).slice(0, n);
}

/**
 * Fold ONE `SeasonData` into a running accumulator. This is the single piece
 * of logic shared by `aggregateSeasons()` (folds every historical season in
 * order) and `mergeAggregates()` in merge.js (folds exactly one live season
 * on top of an already-frozen accumulator reconstructed from `AggregateData`).
 *
 * Mutates and returns `acc` for convenience; callers that care about purity
 * should pass a deep-cloned accumulator (aggregateSeasons always starts from
 * a fresh one, so this is a non-issue there).
 *
 * @param {object} acc - Accumulator shape, see `createEmptyAccumulator()`.
 * @param {SeasonData} seasonData
 */
function foldSeasonIntoAccumulator(acc, seasonData) {
  const { season } = seasonData;

  if (!acc.seasons.includes(season)) acc.seasons.push(season);

  for (const [userId, sm] of Object.entries(seasonData.managers)) {
    if (!acc.managers[userId]) {
      acc.managers[userId] = {
        userId,
        displayName: sm.displayName,
        avatar: sm.avatar,
        wins: 0,
        losses: 0,
        ties: 0,
        pf: 0,
        pa: 0,
        transactions: 0,
        trades: 0,
        championshipYears: [],
        runnerUpYears: [],
        teamNameHistory: [],
        yearlyStandings: [],
        yearlyStats: {},
        h2h: {},
        cornerstones: {}, // playerId -> {playerId,name,position,weeks,points,years:Set}
        nemeses: {}, // playerId -> {playerId,name,position,points}
      };
    }
    const cm = acc.managers[userId];
    // Always keep the most recently seen display identity (latest season wins).
    cm.displayName = sm.displayName;
    cm.avatar = sm.avatar;
    cm.wins += sm.wins;
    cm.losses += sm.losses;
    cm.ties += sm.ties;
    cm.pf += sm.pf;
    cm.pa += sm.pa;
    cm.transactions += sm.transactions;
    cm.trades += sm.trades;
    if (sm.isChampion) cm.championshipYears.push(season);
    if (sm.isRunnerUp) cm.runnerUpYears.push(season);
    if (!cm.teamNameHistory.some((t) => t.year === season)) {
      cm.teamNameHistory.push({ year: season, name: sm.teamName });
    }
    if (sm.rank !== null && !cm.yearlyStandings.some((s) => s.year === season)) {
      cm.yearlyStandings.push({ year: season, rank: sm.rank, totalTeams: seasonData.totalTeams });
    }
    cm.yearlyStats[season] = {
      pf: sm.pf,
      pa: sm.pa,
      transactions: sm.transactions,
      trades: sm.trades,
      wins: sm.wins,
      losses: sm.losses,
      ties: sm.ties,
      record: `${sm.wins}-${sm.losses}`,
    };

    for (const [playerId, weeks] of Object.entries(sm.rosteredPlayerWeeks)) {
      const info = seasonData.playerInfoLookup?.[playerId];
      if (!cm.cornerstones[playerId]) {
        cm.cornerstones[playerId] = {
          playerId,
          name: info?.name || null,
          position: info?.position || null,
          weeks: 0,
          points: 0,
          years: new Set(),
        };
      }
      cm.cornerstones[playerId].weeks += weeks;
      cm.cornerstones[playerId].years.add(season);
    }
    for (const [playerId, points] of Object.entries(sm.startersPointsByPlayer)) {
      if (!cm.cornerstones[playerId]) {
        cm.cornerstones[playerId] = { playerId, name: null, position: null, weeks: 0, points: 0, years: new Set([season]) };
      }
      cm.cornerstones[playerId].points += points;
    }
    for (const [playerId, points] of Object.entries(sm.pointsAgainstByPlayer)) {
      if (!cm.nemeses[playerId]) {
        cm.nemeses[playerId] = { playerId, name: null, position: null, points: 0 };
      }
      cm.nemeses[playerId].points += points;
    }
  }

  // H2H records + matchup-pair history, derived from this season's deduplicated matchups.
  for (const match of seasonData.matchups) {
    const m1 = acc.managers[match.manager1Id];
    const m2 = acc.managers[match.manager2Id];
    if (!m1 || !m2) continue;
    if (!m1.h2h[match.manager2Id]) m1.h2h[match.manager2Id] = { wins: 0, losses: 0, ties: 0 };
    if (!m2.h2h[match.manager1Id]) m2.h2h[match.manager1Id] = { wins: 0, losses: 0, ties: 0 };
    if (match.score1 > match.score2) {
      m1.h2h[match.manager2Id].wins++;
      m2.h2h[match.manager1Id].losses++;
    } else if (match.score2 > match.score1) {
      m1.h2h[match.manager2Id].losses++;
      m2.h2h[match.manager1Id].wins++;
    } else if (match.score1 > 0) {
      m1.h2h[match.manager2Id].ties++;
      m2.h2h[match.manager1Id].ties++;
    }

    const key = pairKey(match.manager1Id, match.manager2Id);
    if (!acc.matchupsByManagerPair[key]) acc.matchupsByManagerPair[key] = [];
    acc.matchupsByManagerPair[key].push({
      season,
      week: match.week,
      m1: match.manager1Id,
      m2: match.manager2Id,
      score1: match.score1,
      score2: match.score2,
      playerPoints1: match.playerPoints1,
      playerPoints2: match.playerPoints2,
    });
  }

  // Record candidate pools (union-of-top5-and-new-candidates trick — see spliceTopN).
  const seasonScoreCandidates = Object.values(seasonData.managers).map((m) => ({
    score: m.pf,
    managerId: m.userId,
    year: season,
  }));
  const seasonRecordCandidates = Object.values(seasonData.managers)
    .filter((m) => m.wins + m.losses > 0)
    .map((m) => ({
      wins: m.wins,
      losses: m.losses,
      record: `${m.wins}-${m.losses}`,
      winPct: m.wins + m.losses > 0 ? m.wins / (m.wins + m.losses) : 0,
      pf: m.pf,
      managerId: m.userId,
      year: season,
    }));
  const blowoutCandidates = seasonData.matchups.map((m) => ({ ...m, season }));

  acc.records.topSeasonScores = spliceTopN(acc.records.topSeasonScores, seasonScoreCandidates, (a, b) => b.score - a.score);
  acc.records.lowestSeasonScores = spliceTopN(
    acc.records.lowestSeasonScores,
    seasonScoreCandidates,
    (a, b) => a.score - b.score
  );
  acc.records.topWeeklyScores = spliceTopN(acc.records.topWeeklyScores, seasonData.weeklyScores, (a, b) => b.score - a.score);
  acc.records.lowestWeeklyScores = spliceTopN(
    acc.records.lowestWeeklyScores,
    seasonData.weeklyScores.filter((s) => s.score > 0),
    (a, b) => a.score - b.score
  );
  acc.records.topSeasonRecords = spliceTopN(
    acc.records.topSeasonRecords,
    seasonRecordCandidates,
    (a, b) => b.winPct - a.winPct || b.pf - a.pf
  );
  acc.records.bottomSeasonRecords = spliceTopN(
    acc.records.bottomSeasonRecords,
    seasonRecordCandidates,
    (a, b) => a.winPct - b.winPct || a.pf - b.pf
  );
  acc.records.biggestBlowouts = spliceTopN(acc.records.biggestBlowouts, blowoutCandidates, (a, b) => b.margin - a.margin);
  acc.records.closestGames = spliceTopN(
    acc.records.closestGames,
    blowoutCandidates.filter((m) => m.totalScore > 0),
    (a, b) => a.margin - b.margin
  );
  acc.records.biggestShootouts = spliceTopN(
    acc.records.biggestShootouts,
    blowoutCandidates,
    (a, b) => b.totalScore - a.totalScore
  );
  acc.records.topPlayerScores = spliceTopN(
    acc.records.topPlayerScores,
    seasonData.playerWeeklyScores,
    (a, b) => b.score - a.score
  );

  // Legacies: ring chasers (championship appearances) + loyalty club (kept players).
  if (seasonData.championship) {
    const { winnerId, winnerRoster, loserId, loserRoster } = seasonData.championship;
    for (const p of winnerRoster) {
      if (!acc.legacies.playerAppearances[p.playerId]) {
        acc.legacies.playerAppearances[p.playerId] = {
          playerId: p.playerId,
          name: p.name,
          position: p.position,
          appearances: 0,
          history: [],
        };
      }
      acc.legacies.playerAppearances[p.playerId].appearances++;
      acc.legacies.playerAppearances[p.playerId].history.push({ season, managerId: winnerId, isWinner: true });
    }
    for (const p of loserRoster) {
      if (!acc.legacies.playerAppearances[p.playerId]) {
        acc.legacies.playerAppearances[p.playerId] = {
          playerId: p.playerId,
          name: p.name,
          position: p.position,
          appearances: 0,
          history: [],
        };
      }
      acc.legacies.playerAppearances[p.playerId].appearances++;
      acc.legacies.playerAppearances[p.playerId].history.push({ season, managerId: loserId, isWinner: false });
    }
  }
  for (const kp of seasonData.keptPlayers) {
    if (!acc.legacies.keptPlayers[kp.playerId]) {
      acc.legacies.keptPlayers[kp.playerId] = {
        playerId: kp.playerId,
        name: kp.name,
        position: kp.position,
        count: 0,
        history: [],
      };
    }
    acc.legacies.keptPlayers[kp.playerId].count++;
    acc.legacies.keptPlayers[kp.playerId].history.push({ season, managerId: kp.managerId });
  }

  // Track the last historical season's roster snapshots, purely so merge.js can
  // compute keptPlayers for a freshly-fetched live current season without a
  // second network round-trip to Sleeper for "last season's rosters".
  acc.lastSeasonRosterSnapshots = seasonData.rosterSnapshots;
  if (seasonData.championFound) {
    acc.reigningChampionId = seasonData.championship?.winnerId ?? acc.reigningChampionId;
  }

  return acc;
}

function createEmptyAccumulator() {
  return {
    seasons: [],
    managers: {},
    matchupsByManagerPair: {},
    records: {
      topSeasonScores: [],
      lowestSeasonScores: [],
      topWeeklyScores: [],
      lowestWeeklyScores: [],
      topSeasonRecords: [],
      bottomSeasonRecords: [],
      biggestBlowouts: [],
      closestGames: [],
      biggestShootouts: [],
      topPlayerScores: [],
    },
    legacies: {
      playerAppearances: {},
      keptPlayers: {},
    },
    lastSeasonRosterSnapshots: [],
    reigningChampionId: null,
  };
}

/**
 * Convert the internal accumulator into the public `AggregateData` shape:
 * derives Dashboard standings/trophy case, per-manager franchise views (rival,
 * legends, nemeses, cornerstones, highlights), and filtered/sorted legacies
 * lists from the raw cumulative maps built up in `foldSeasonIntoAccumulator`.
 *
 * Also shared between `aggregateSeasons()` and `mergeAggregates()` so both
 * produce byte-for-byte the same derived-field shape.
 *
 * @param {ReturnType<typeof createEmptyAccumulator>} acc
 * @param {string} throughSeason
 * @returns {AggregateData}
 */
function deriveAggregateData(acc, throughSeason) {
  const managerList = Object.values(acc.managers);

  const standings = managerList
    .map((m) => {
      const gp = m.wins + m.losses + m.ties;
      const winPct = gp > 0 ? m.wins / (m.wins + m.losses || 1) : 0;
      return { userId: m.userId, displayName: m.displayName, avatar: m.avatar, wins: m.wins, losses: m.losses, ties: m.ties, pf: m.pf, pa: m.pa, winPct };
    })
    .sort((a, b) => b.winPct - a.winPct || b.pf - a.pf)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const champions = managerList
    .filter((m) => m.championshipYears.length > 0)
    .sort((a, b) => b.championshipYears.length - a.championshipYears.length)
    .map((m) => ({ userId: m.userId, displayName: m.displayName, avatar: m.avatar, years: [...m.championshipYears].sort() }));
  const runnerUps = managerList
    .filter((m) => m.runnerUpYears.length > 0)
    .sort((a, b) => b.runnerUpYears.length - a.runnerUpYears.length)
    .map((m) => ({ userId: m.userId, displayName: m.displayName, avatar: m.avatar, years: [...m.runnerUpYears].sort() }));

  const ringChasers = Object.values(acc.legacies.playerAppearances)
    .filter((p) => p.appearances > 1)
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 10);
  const loyaltyClub = Object.values(acc.legacies.keptPlayers)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const managers = {};
  for (const m of managerList) {
    const gp = m.wins + m.losses;
    const winPct = gp > 0 ? m.wins / gp : 0;

    const cornerstones = Object.values(m.cornerstones)
      .map((c) => ({ ...c, years: [...c.years].sort() }))
      .sort((a, b) => b.weeks - a.weeks);
    const nemesesFull = Object.values(m.nemeses).sort((a, b) => b.points - a.points);

    let rival = null;
    let maxLosses = 0;
    for (const [oppId, record] of Object.entries(m.h2h)) {
      if (record.losses > maxLosses) {
        maxLosses = record.losses;
        rival = oppId;
      }
    }

    const managerSeasonScores = acc.records.topSeasonScores
      .concat(acc.records.lowestSeasonScores)
      .filter((s) => s.managerId === m.userId);
    const managerRecords = acc.records.topSeasonRecords
      .concat(acc.records.bottomSeasonRecords)
      .filter((r) => r.managerId === m.userId);
    const managerWeeklyScores = acc.records.topWeeklyScores
      .concat(acc.records.lowestWeeklyScores)
      .filter((s) => s.managerId === m.userId);
    const bestSeasonScore = managerSeasonScores.sort((a, b) => b.score - a.score)[0] || null;
    const bestSeasonRecord = managerRecords.sort((a, b) => b.winPct - a.winPct || b.pf - a.pf)[0] || null;
    const bestWeek = managerWeeklyScores.sort((a, b) => b.score - a.score)[0] || null;
    // NOTE: because these highlight candidates are pulled from the already-top-5-capped
    // record lists, a manager whose personal-best season/week never cracked the
    // league-wide top 5 will show `null` here. This matches the practical behavior of
    // the original (which scanned the *full* history, but only because it kept full
    // arrays in memory) closely enough for a "highlights" card; template code should
    // treat these fields as "notable record, if any" rather than a guaranteed value.
    // Build-time full-history scans remain available by computing highlights directly
    // from `SeasonData[]` before calling aggregateSeasons, if a template ever needs
    // guaranteed personal bests. See SCHEMA.md.

    managers[m.userId] = {
      userId: m.userId,
      displayName: m.displayName,
      avatar: m.avatar,
      wins: m.wins,
      losses: m.losses,
      ties: m.ties,
      pf: m.pf,
      pa: m.pa,
      winPct,
      transactions: m.transactions,
      trades: m.trades,
      championshipYears: [...m.championshipYears].sort(),
      runnerUpYears: [...m.runnerUpYears].sort(),
      teamNameHistory: [...m.teamNameHistory].sort((a, b) => (a.year > b.year ? 1 : -1)),
      yearlyStandings: [...m.yearlyStandings].sort((a, b) => (a.year > b.year ? 1 : -1)),
      yearlyStats: m.yearlyStats,
      h2h: m.h2h,
      rival: rival ? { managerId: rival, losses: maxLosses } : null,
      cornerstones,
      franchiseLegends: cornerstones.slice(0, 5),
      nemesesFull,
      archNemeses: nemesesFull.slice(0, 5),
      highlights: { bestSeasonScore, bestSeasonRecord, bestWeek },
    };
  }

  return {
    throughSeason,
    seasons: [...acc.seasons].sort(),
    standings,
    trophyCase: { champions, runnerUps },
    records: acc.records,
    legacies: { ringChasers, loyaltyClub },
    managers,
    matchupsByManagerPair: acc.matchupsByManagerPair,
    reigningChampionId: acc.reigningChampionId,
    lastSeasonRosterSnapshots: acc.lastSeasonRosterSnapshots,
  };
}

/**
 * @typedef {object} AggregateData
 * All-time / cross-season rollup consumed by the Dashboard, Records, My Team,
 * and Legacies tabs. Returned by `aggregateSeasons()`, and produced
 * incrementally (without recomputing history) by `mergeAggregates()` in
 * merge.js.
 * @property {string} throughSeason - The most recent season folded into this aggregate, e.g. "2024". `mergeAggregates` is a no-op if the live season is <= this.
 * @property {string[]} seasons - Every season folded in, ascending.
 * @property {Array<{userId:string,displayName:string,avatar:string,wins:number,losses:number,ties:number,pf:number,pa:number,winPct:number,rank:number}>} standings -
 *   All-Time Standings table (Dashboard tab), pre-sorted by winPct desc then pf desc, with `rank` (1-indexed) already assigned.
 * @property {{champions: Array<{userId:string,displayName:string,avatar:string,years:string[]}>, runnerUps: Array<{userId:string,displayName:string,avatar:string,years:string[]}>}} trophyCase -
 *   Dashboard "Trophy Case" card. Sorted by ring/appearance count desc.
 * @property {{topSeasonScores:Array,lowestSeasonScores:Array,topWeeklyScores:Array,lowestWeeklyScores:Array,topSeasonRecords:Array,bottomSeasonRecords:Array,biggestBlowouts:Array,closestGames:Array,biggestShootouts:Array,topPlayerScores:Array}} records -
 *   Records tab. Each list is pre-sorted and capped at 5 entries, exactly like `allTimeRecords` in the original. Element shapes:
 *   - `top/lowestSeasonScores`: `{score, managerId, year}`
 *   - `top/lowestWeeklyScores`: `{managerId, year, week, score}`
 *   - `top/bottomSeasonRecords`: `{wins, losses, record, winPct, pf, managerId, year}`
 *   - `biggestBlowouts/closestGames/biggestShootouts`: `{week, manager1Id, manager2Id, score1, score2, margin, totalScore, season, playerPoints1, playerPoints2}`
 *   - `topPlayerScores`: `{playerId, name, position, team, managerId, year, week, score}`
 * @property {{ringChasers: Array<{playerId,name,position,appearances,history:Array<{season,managerId,isWinner}>}>, loyaltyClub: Array<{playerId,name,position,count,history:Array<{season,managerId}>}>}} legacies -
 *   Legacies tab. Both pre-filtered (appearances/count > applicable threshold... actually ringChasers requires appearances > 1, loyaltyClub has no minimum) and capped at 10, sorted desc.
 * @property {Object<string, object>} managers - Per-manager career/franchise view keyed by `userId`. Powers the My Team tab. Each entry:
 *   `{userId, displayName, avatar, wins, losses, ties, pf, pa, winPct, transactions, trades, championshipYears, runnerUpYears,
 *     teamNameHistory: [{year,name}], yearlyStandings: [{year,rank,totalTeams}], yearlyStats: {[year]: {pf,pa,transactions,trades,wins,losses,ties,record}},
 *     h2h: {[opponentId]: {wins,losses,ties}}, rival: {managerId,losses}|null,
 *     cornerstones: [{playerId,name,position,weeks,points,years}] (FULL list, all-time, desc by weeks — "Franchise Cornerstones" table),
 *     franchiseLegends: (top 5 slice of cornerstones — "Franchise Legends" card),
 *     nemesesFull: [{playerId,name,position,points}] (FULL list, all-time, desc by points),
 *     archNemeses: (top 5 slice of nemesesFull — "Arch-Nemeses" card),
 *     highlights: {bestSeasonScore, bestSeasonRecord, bestWeek} (each null-able; see deriveAggregateData's inline note on why these can be null even when the manager has season/week data)}`
 * @property {Object<string, Array<{season,week,m1,m2,score1,score2,playerPoints1,playerPoints2}>>} matchupsByManagerPair -
 *   Keyed by `[id1,id2].sort().join('-')`. Full head-to-head matchup history between every pair of managers who've ever played each other. Powers the H2H tab (compute the on-the-fly summary — record/streaks/closest-game/nemesis — client-side from this list exactly like the original's `updateH2H()`, just reading from here instead of a global).
 * @property {string|null} reigningChampionId - See file-level porting note #4.
 * @property {Array<{rosterId,ownerId,players,wins,losses,ties,pf,ppts,rank}>} lastSeasonRosterSnapshots -
 *   Roster snapshots from the most recent season folded in. Exists ONLY so `mergeAggregates()` can compute `keptPlayers` for a
 *   freshly-fetched live season without a second Sleeper round-trip. Templates generally shouldn't need this directly.
 */

/**
 * Fold an array of `SeasonData` (any order) into a single `AggregateData`.
 *
 * PURE FUNCTION.
 *
 * @param {SeasonData[]} seasonDataArray
 * @returns {AggregateData}
 */
export function aggregateSeasons(seasonDataArray) {
  const sorted = [...seasonDataArray].sort((a, b) => Number(a.season) - Number(b.season));
  const acc = createEmptyAccumulator();
  for (const seasonData of sorted) {
    foldSeasonIntoAccumulator(acc, seasonData);
  }
  const throughSeason = sorted.length > 0 ? sorted[sorted.length - 1].season : null;
  return deriveAggregateData(acc, throughSeason);
}

// Exported for merge.js — not part of the public "template-facing" API, but
// necessary so mergeAggregates() can reuse the exact same fold/derive logic
// instead of re-implementing (and risking drift from) it.
export const _internal = {
  createEmptyAccumulator,
  foldSeasonIntoAccumulator,
  deriveAggregateData,
  spliceTopN,
  pairKey,
};
