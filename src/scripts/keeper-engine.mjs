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
 * rosters triad `processSeason()` consumes. This mirrors the existing
 * precedent for Draft Odds (season-processor.mjs porting note #5).
 *
 * The raw-fetch helpers below (`adpProjectionsUrl`, `parseAdpRows`,
 * `findCompletedDraft`, `parseDraftPicks`) are shared by both call sites:
 * data-build/fetch-sleeper.js (Node, build-time) and
 * src/scripts/keeper-assistant.js (browser). Each call site does its own I/O;
 * this module only ever transforms already-fetched JSON.
 *
 * ---------------------------------------------------------------------------
 * ROUND DIRECTION (confirmed with the league owner - do NOT "fix" this)
 * ---------------------------------------------------------------------------
 * Round numbers count UP as picks get cheaper (round 1 = most valuable). The
 * league's rules text uses "higher" to mean MORE VALUABLE, i.e. a LOWER round
 * number, and "below" to mean less valuable, i.e. a HIGHER round number:
 *
 *   Rule 2: kept "one round higher than where they were drafted"
 *           -> drafted round 10, keeper cost = round 9 (round - 1).
 *   Rule 3: "must use a higher-round pick" -> round 8, 7, ... (corroborates).
 *   Rule 6: undrafted cost "two rounds below their ADP"
 *           -> ADP round 5, keeper cost = round 7 (round + 2).
 *
 * Cost escalates by one more round for each consecutive year already kept
 * (also confirmed): 1st keeper year = origin - 1, 2nd = origin - 2.
 *
 * Rules 3-5 (trading for a pick) are out of scope by product decision;
 * `belowFirstRound` / `beyondDraftRounds` flag where they'd apply instead of
 * modeling the trade mechanics.
 */

// ---------------------------------------------------------------------------
// Raw-Sleeper-response parsing (shared by build-time and browser fetches)
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
    // 999 is Sleeper's "not meaningfully ranked" sentinel - keep it out rather
    // than converting it into an absurd round number downstream.
    if (typeof adp === "number" && Number.isFinite(adp) && adp > 0 && adp < 999) {
      byPlayerId[row.player_id] = adp;
    }
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

/** Build {ownerId: playerId[]} end-of-season roster snapshot from a raw /rosters response. */
export function parseRostersByOwner(rosters, primaryUserIdMap = {}) {
  const byOwner = {};
  for (const r of rosters || []) {
    if (!r.owner_id) continue;
    const ownerId = primaryUserIdMap[r.owner_id] || r.owner_id;
    byOwner[ownerId] = (byOwner[ownerId] || []).concat(r.players || []);
  }
  return byOwner;
}

// ---------------------------------------------------------------------------
// Keeper eligibility / cost / streak
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
 * @property {Object<string,string[]>} playersByOwner - End-of-season rosters, used to tell a keeper apart from a re-draft.
 *
 * @typedef {object} UpcomingAdp
 * @property {string} season - Season the ADP is quoted for (the upcoming draft).
 * @property {number} teamCount
 * @property {number|null} rounds - Expected rounds in the upcoming draft (carried from the last real draft).
 * @property {Object<string,number>} adpByPlayerId - Raw overall-pick ADP decimals.
 *
 * @typedef {object} KeeperProfile
 * @property {string} playerId
 * @property {string} name
 * @property {string} position
 * @property {'drafted'|'undrafted'|'unknown'} costBasis
 * @property {number|null} originRound - Round the current keeper chain started at.
 * @property {string|null} originSeason
 * @property {number|null} adpRound - Undrafted path only: the player's ADP expressed as a round.
 * @property {string|null} adpSeason
 * @property {number} streakCount - Consecutive keeper years ALREADY used under the current owner.
 * @property {boolean} eligible - streakCount < 2 (rule 8).
 * @property {number|null} keeperRound - Round this player would cost to keep, or null if undeterminable.
 * @property {boolean} belowFirstRound - Computed cost was above round 1; capped (rules 3-5 territory).
 * @property {boolean} beyondDraftRounds - ADP sits outside the draftable pool; capped at the last round.
 * @property {string|null} note
 */

/** Index every known pick per player across all recorded seasons, oldest first. */
export function buildDraftPickIndex(seasons) {
  const bySeason = [...(seasons || [])].sort((a, b) => Number(a.season) - Number(b.season));
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
 * Index who held each player at the END of each season.
 * @returns {Map<string, Object<number,string>>} playerId -> {season: ownerId}
 */
export function buildRosterHistoryIndex(seasons) {
  const byPlayer = new Map();
  for (const sd of seasons || []) {
    const season = Number(sd.season);
    for (const [ownerId, playerIds] of Object.entries(sd.playersByOwner || {})) {
      for (const playerId of playerIds) {
        const bySeason = byPlayer.get(playerId) || {};
        bySeason[season] = ownerId;
        byPlayer.set(playerId, bySeason);
      }
    }
  }
  return byPlayer;
}

/**
 * Walk the keeper chain backward from the most recent pick.
 *
 * A pick counts as a keeper year (rather than a fresh draft) when the same
 * manager ALSO held that player at the end of the previous season - in a
 * redraft-with-keepers league everyone else returns to the pool, so
 * "on my roster in December, drafted by me in August" is a keep. This is
 * deliberately NOT a round-delta test: rules 3 and 5 (use a higher pick when
 * you lack the round; trade for a second pick in a round) mean a real keeper's
 * round can move by more than one, which a strict delta check would miss.
 *
 * @returns {{streakCount: number, originPick: {season:number,round:number,ownerId:string|null}}}
 */
function walkKeeperChain(pickHistory, currentOwnerId, rosterSeasons) {
  let idx = pickHistory.length - 1;
  let streakCount = 0;

  while (idx >= 0) {
    const pick = pickHistory[idx];
    if (pick.ownerId !== currentOwnerId) break;
    if (rosterSeasons?.[pick.season - 1] !== currentOwnerId) break; // fresh draft, chain starts here
    streakCount++;
    if (idx === 0 || pickHistory[idx - 1].season !== pick.season - 1) break;
    idx--;
  }

  return { streakCount, originPick: pickHistory[idx] };
}

/**
 * @param {string} playerId
 * @param {string} currentOwnerId - Canonical manager id of the roster being evaluated.
 * @param {Array<{season:number,round:number,ownerId:string|null}>|undefined} pickHistory - Season-ascending.
 * @param {Object<number,string>|undefined} rosterSeasons - {season: ownerId} for this player.
 * @param {UpcomingAdp|null} upcomingAdp
 * @returns {Omit<KeeperProfile,'playerId'|'name'|'position'>}
 */
export function computeKeeperProfile(playerId, currentOwnerId, pickHistory, rosterSeasons, upcomingAdp) {
  const lastRound = upcomingAdp?.rounds ?? null;

  if (!pickHistory || pickHistory.length === 0) {
    // Rule 6: never drafted in any recorded season - price off the upcoming
    // draft's ADP (current market value), not a stale historical number.
    const adp = upcomingAdp?.adpByPlayerId?.[playerId];
    if (adp == null) {
      return {
        costBasis: "unknown",
        originRound: null,
        originSeason: null,
        adpRound: null,
        adpSeason: null,
        streakCount: 0,
        eligible: true,
        keeperRound: null,
        belowFirstRound: false,
        beyondDraftRounds: false,
        note: "Never drafted and no ADP on file - undraftable in this format, so there's no rule-6 cost to compute.",
      };
    }

    const adpRound = adpToRound(adp, upcomingAdp.teamCount);
    const raw = adpRound + 2; // "two rounds below their ADP" = two rounds later/cheaper
    const beyondDraftRounds = lastRound != null && raw > lastRound;
    return {
      costBasis: "undrafted",
      originRound: null,
      originSeason: null,
      adpRound,
      adpSeason: upcomingAdp.season,
      streakCount: 0,
      eligible: true,
      keeperRound: beyondDraftRounds ? lastRound : raw,
      belowFirstRound: false,
      beyondDraftRounds,
      note: beyondDraftRounds
        ? `${upcomingAdp.season} ADP is round ${adpRound}, past the last round of the draft - shown at the last round (round ${lastRound}).`
        : `Undrafted: ${upcomingAdp.season} ADP round ${adpRound}, kept two rounds later.`,
    };
  }

  // Rule 7: a dropped/traded player keeps the draft position of record, so the
  // chain origin is used even when someone else made that pick.
  const { streakCount, originPick } = walkKeeperChain(pickHistory, currentOwnerId, rosterSeasons);

  // Rule 2 + escalation: one round higher (earlier) per keeper year used.
  const raw = originPick.round - 1 - streakCount;
  const belowFirstRound = raw < 1;

  return {
    costBasis: "drafted",
    originRound: originPick.round,
    originSeason: String(originPick.season),
    adpRound: null,
    adpSeason: null,
    streakCount,
    eligible: streakCount < 2, // Rule 8: max 2 consecutive keeper years.
    keeperRound: belowFirstRound ? 1 : raw,
    belowFirstRound,
    beyondDraftRounds: false,
    note: belowFirstRound
      ? "Cost works out above round 1, which doesn't exist - shown at round 1. Confirm with the commissioner."
      : null,
  };
}

/**
 * @param {string[]} playerIds - Roster's current player_ids.
 * @param {string} currentOwnerId
 * @param {object} indexes - { pickIndex, rosterIndex } from buildDraftPickIndex/buildRosterHistoryIndex.
 * @param {UpcomingAdp|null} upcomingAdp
 * @param {Object<string,{name:string,position:string}>} playerInfoLookup
 * @returns {KeeperProfile[]}
 */
export function computeRosterKeeperProfiles(playerIds, currentOwnerId, indexes, upcomingAdp, playerInfoLookup) {
  const { pickIndex, rosterIndex } = indexes;
  return (playerIds || []).map((playerId) => {
    const info = playerInfoLookup?.[playerId];
    const profile = computeKeeperProfile(
      playerId,
      currentOwnerId,
      pickIndex.get(playerId),
      rosterIndex.get(playerId),
      upcomingAdp
    );
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
 * the rare case the chain inference gets a player wrong.
 */
export function applyKeeperOverrides(profiles, overridesByPlayerId) {
  if (!overridesByPlayerId || Object.keys(overridesByPlayerId).length === 0) return profiles;
  return profiles.map((p) => {
    const override = overridesByPlayerId[p.playerId];
    if (!override) return p;
    return { ...p, ...override, note: [p.note, "(manually corrected)"].filter(Boolean).join(" ") };
  });
}
