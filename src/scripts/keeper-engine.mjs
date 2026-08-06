/**
 * keeper-engine.mjs
 *
 * Pure keeper-eligibility engine for the Keeper Assistant tab (jrwll-only
 * today, gated on league config `rulesContent.keeperRules`). Isomorphic,
 * same DESIGN CONSTRAINTS as season-processor.mjs: no Node-only globals, no
 * browser-only globals, every export is a pure function of its inputs.
 *
 * Kept separate from season-processor.mjs (rather than folded into
 * `SeasonData`) because it has an independent fetch path and lifecycle -
 * Sleeper `/drafts` + `/draft/{id}/picks` plus the undocumented
 * api.sleeper.com ADP-projections endpoint, not the matchups/transactions/
 * rosters triad `processSeason()` consumes - and it needs the CURRENT
 * season's draft, which `historical.json` deliberately excludes (see
 * data-build/fetch-sleeper.js). This mirrors the existing precedent for
 * Draft Odds (season-processor.mjs porting note #5).
 *
 * The raw-fetch helpers below (`adpProjectionsUrl`, `parseAdpRows`,
 * `findCompletedDraft`, `parseDraftPicks`) are shared by both call sites:
 * data-build/fetch-sleeper.js (Node, build-time, writes drafts.json for
 * every completed historical + current-season draft) and
 * src/scripts/keeper-assistant.js (browser, live top-up for the rare case
 * the current season's draft isn't in drafts.json yet). Each call site does
 * its own I/O (fetchWithRetry + file writes vs. fetchWithRetry only); this
 * module only ever transforms already-fetched JSON.
 *
 * Implements jrwll's keeper rules (src/leagues/jrwll.json
 * rulesContent.keeperRules), specifically:
 *   1. Max 3 keepers, none required (display-only - not enforced here).
 *   2. Kept player costs one round higher than their original draft round;
 *      confirmed with the league owner to ESCALATE on a second consecutive
 *      keep (originalRound + 1 + streakCount).
 *   6. Undrafted-but-rostered players cost 2 rounds below end-of-season ADP.
 *   7. Original draft round persists across drops/trades.
 *   8. Max 2 consecutive keeper years.
 * Rules 3-5 (trading for a pick) are explicitly out of scope by product
 * decision - `exceedsDraftRounds` flags when they'd apply without modeling
 * the trade mechanics themselves.
 */

// ---------------------------------------------------------------------------
// Raw-Sleeper-response parsing (shared by build-time and live-top-up fetches)
// ---------------------------------------------------------------------------

const ADP_POSITIONS = ["DEF", "K", "QB", "RB", "TE", "WR"];
const ADP_FIELD_BY_FORMAT = { ppr: "adp_ppr", half_ppr: "adp_half_ppr", std: "adp_std" };

/** Pick the ADP field matching this league's scoring format from a Sleeper league object's scoring_settings.rec. */
export function scoringFormatFromLeagueObj(leagueObj) {
  const rec = leagueObj?.scoring_settings?.rec ?? 0;
  if (rec >= 1) return "ppr";
  if (rec >= 0.5) return "half_ppr";
  return "std";
}

/** Undocumented Sleeper endpoint (api.sleeper.com, NOT api.sleeper.app) that carries adp_ppr/adp_std/adp_half_ppr per player. */
export function adpProjectionsUrl(season) {
  const params = ADP_POSITIONS.map((p) => `position[]=${p}`).join("&");
  return `https://api.sleeper.com/projections/nfl/${season}?season_type=regular&${params}&order_by=pts_ppr`;
}

/** Parse a GET .../projections/nfl/{season} response into {playerId: adpValue} for the given scoring format. */
export function parseAdpRows(rows, format) {
  const field = ADP_FIELD_BY_FORMAT[format];
  const byPlayerId = {};
  for (const row of rows || []) {
    const adp = row?.stats?.[field];
    if (typeof adp === "number" && Number.isFinite(adp)) byPlayerId[row.player_id] = adp;
  }
  return byPlayerId;
}

/** Overall-pick ADP decimal -> draft round, floored at round 1. */
export function adpToRound(adp, teamCount) {
  return Math.max(1, Math.ceil(adp / teamCount));
}

/** Find the completed draft (if any) in a GET /v1/league/{id}/drafts response. Returns null if the draft hasn't happened/finished yet - expected pre/mid-draft, not an error. */
export function findCompletedDraft(drafts) {
  return (drafts || []).find((d) => d.status === "complete") || null;
}

/** Parse a GET /v1/draft/{id}/picks response into {round, playerId, ownerId}[], resolving each pick's roster_id to a canonical (co-owner-merged) manager id via the supplied maps. */
export function parseDraftPicks(rawPicks, rosterIdToOwnerId, primaryUserIdMap = {}) {
  return (rawPicks || [])
    .filter((p) => p.player_id)
    .map((p) => {
      const ownerId = rosterIdToOwnerId[p.roster_id] || null;
      return {
        round: p.round,
        playerId: p.player_id,
        ownerId: ownerId ? primaryUserIdMap[ownerId] || ownerId : null,
      };
    });
}

// ---------------------------------------------------------------------------
// Keeper eligibility/round/streak algorithm
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SeasonDraftPick
 * @property {number} round
 * @property {string} playerId
 * @property {string|null} ownerId - Canonical manager id, or null if unresolvable.
 *
 * @typedef {object} SeasonDraftData
 * @property {string} season
 * @property {number} teamCount
 * @property {'ppr'|'half_ppr'|'std'} scoringFormat
 * @property {number|null} rounds - Total rounds in this season's draft.
 * @property {SeasonDraftPick[]} picks
 * @property {Object<string,{adp:number, round:number}>} adpByPlayerId
 *
 * @typedef {object} KeeperProfile
 * @property {string} playerId
 * @property {string} name
 * @property {string} position
 * @property {'drafted'|'undrafted'|'unknown'} costBasis
 * @property {number|null} originalDraftRound
 * @property {string|null} originalDraftSeason
 * @property {number} streakCount - Consecutive prior keeper years already used, chained under the CURRENT owner only.
 * @property {boolean} eligible - streakCount < 2 (rule 8).
 * @property {number|null} keeperRound - Round this player would cost to keep this year, or null if unknown.
 * @property {boolean} exceedsDraftRounds - keeperRound is beyond the known draft's round count (rules 3-5 territory - flagged, not modeled).
 * @property {string|null} note - Human-readable caveat for the UI.
 */

/**
 * Index every known pick per player across all recorded seasons, oldest first.
 * @param {SeasonDraftData[]} draftHistory
 * @returns {Map<string, Array<{season:number, round:number, ownerId:string|null}>>}
 */
export function buildDraftPickIndex(draftHistory) {
  const bySeason = [...(draftHistory || [])].sort((a, b) => Number(a.season) - Number(b.season));
  const byPlayer = new Map();
  for (const sd of bySeason) {
    for (const pick of sd.picks || []) {
      const list = byPlayer.get(pick.playerId) || [];
      list.push({ season: Number(sd.season), round: pick.round, ownerId: pick.ownerId });
      byPlayer.set(pick.playerId, list);
    }
  }
  return byPlayer;
}

/**
 * @param {string} playerId
 * @param {string} currentOwnerId - Canonical manager id of the roster being evaluated.
 * @param {Array<{season:number, round:number, ownerId:string|null}>|undefined} pickHistory - This player's known picks, season-ascending.
 * @param {SeasonDraftData|null} latestSeasonDraft - Most recent known SeasonDraftData (source of ADP + this draft's round count), or null.
 * @returns {Omit<KeeperProfile, 'playerId'|'name'|'position'>}
 */
export function computeKeeperProfile(playerId, currentOwnerId, pickHistory, latestSeasonDraft) {
  const rounds = latestSeasonDraft?.rounds ?? null;

  if (!pickHistory || pickHistory.length === 0) {
    // Never drafted in any known season - rule 6 branch.
    const adpEntry = latestSeasonDraft?.adpByPlayerId?.[playerId];
    if (!adpEntry) {
      return {
        costBasis: "unknown",
        originalDraftRound: null,
        originalDraftSeason: null,
        streakCount: 0,
        eligible: true,
        keeperRound: null,
        exceedsDraftRounds: false,
        note: "No draft or ADP history available for this player.",
      };
    }
    const keeperRound = Math.max(1, adpEntry.round - 2);
    return {
      costBasis: "undrafted",
      originalDraftRound: null,
      originalDraftSeason: null,
      streakCount: 0,
      eligible: true,
      keeperRound,
      exceedsDraftRounds: rounds != null && keeperRound > rounds,
      note: `ADP-based cost (${latestSeasonDraft.season} ADP round ${adpEntry.round}).`,
    };
  }

  // Rule 7: original draft round persists across drops/trades - always the earliest known pick, any owner.
  const original = pickHistory[0];
  const mostRecent = pickHistory[pickHistory.length - 1];

  // Streak: consecutive round=prevRound+1, season=prevSeason+1 picks chained
  // backward from the most recent one, only while the owner stays the
  // CURRENT owner. A manager change anywhere breaks the chain - an inherited
  // keeper streak is not modeled; a new owner (via trade/waiver) starts at 0.
  let streakCount = 0;
  if (mostRecent.ownerId === currentOwnerId) {
    for (let i = pickHistory.length - 1; i > 0; i--) {
      const cur = pickHistory[i];
      const prev = pickHistory[i - 1];
      if (cur.ownerId !== currentOwnerId || prev.ownerId !== currentOwnerId) break;
      if (cur.season !== prev.season + 1 || cur.round !== prev.round + 1) break;
      streakCount++;
    }
  }

  // Rule 2 (escalating, confirmed with league owner): 1st keeper year costs
  // originalRound + 1; each further consecutive keeper year adds one more round.
  const keeperRound = original.round + 1 + streakCount;

  return {
    costBasis: "drafted",
    originalDraftRound: original.round,
    originalDraftSeason: String(original.season),
    streakCount,
    eligible: streakCount < 2, // Rule 8: max 2 consecutive keeper years.
    keeperRound,
    exceedsDraftRounds: rounds != null && keeperRound > rounds,
    note:
      rounds != null && keeperRound > rounds
        ? "Computed round exceeds this draft's round count - trading for a pick (not modeled here) would be required."
        : null,
  };
}

/**
 * @param {string[]} playerIds - Roster's current player_ids.
 * @param {string} currentOwnerId
 * @param {Map<string, Array<object>>} pickIndex - From buildDraftPickIndex().
 * @param {SeasonDraftData|null} latestSeasonDraft
 * @param {Object<string,{name:string,position:string}>} playerInfoLookup
 * @returns {KeeperProfile[]}
 */
export function computeRosterKeeperProfiles(playerIds, currentOwnerId, pickIndex, latestSeasonDraft, playerInfoLookup) {
  return (playerIds || []).map((playerId) => {
    const info = playerInfoLookup?.[playerId];
    const profile = computeKeeperProfile(playerId, currentOwnerId, pickIndex.get(playerId), latestSeasonDraft);
    return {
      playerId,
      name: info?.name || "Unknown Player",
      position: info?.position || "N/A",
      ...profile,
    };
  });
}

/**
 * Shallow-merge hand-entered corrections (league config `keeperOverrides`,
 * keyed by Sleeper player_id) over the inferred profiles - escape hatch for
 * the rare case the round-based streak inference gets a player wrong.
 * @param {KeeperProfile[]} profiles
 * @param {Object<string, Partial<KeeperProfile>>} overridesByPlayerId
 * @returns {KeeperProfile[]}
 */
export function applyKeeperOverrides(profiles, overridesByPlayerId) {
  if (!overridesByPlayerId || Object.keys(overridesByPlayerId).length === 0) return profiles;
  return profiles.map((p) => {
    const override = overridesByPlayerId[p.playerId];
    if (!override) return p;
    return { ...p, ...override, note: [p.note, "(manually corrected)"].filter(Boolean).join(" ") };
  });
}
