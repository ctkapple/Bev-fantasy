/**
 * merge.js
 *
 * mergeAggregates(staticAggregates, liveCurrentSeasonData) layers exactly ONE
 * freshly-fetched, live current season on top of a frozen AggregateData
 * (built by the nightly/on-push GitHub Actions run) - without re-fetching or
 * re-processing any historical season. Every "all-time" view (Dashboard
 * standings, Records, My Team, Legacies) should call this identically:
 *
 *   const staticAggregates = await fetch('/leagues/<slug>/data/aggregates.json').then(r => r.json());
 *   const liveCurrentSeasonData = await getCurrentSeasonData(leagueConfig); // sleeper-client.js
 *   const merged = mergeAggregates(staticAggregates, liveCurrentSeasonData);
 *
 * IMPORTANT LIMITATION (documented, not a bug to "fix" - it's the accepted
 * cost of a client-side incremental merge instead of a full server-side
 * rebuild): AggregateData is a DERIVED shape - `legacies.ringChasers` /
 * `legacies.loyaltyClub` are already filtered+capped to the top 10, so
 * reconstructing the accumulator from AggregateData (see
 * reconstructAccumulator below) only "remembers" players already in that
 * top 10. A player whose 2nd-ever championship appearance happens to be
 * THIS live season, whose 1st appearance fell outside the frozen top 10,
 * will read as a 1st (not 2nd) appearance until the next real build runs
 * aggregateSeasons() over full history. Every other field merges exactly.
 */
import { _internal } from "./season-processor.mjs";

function reconstructAccumulator(aggregateData) {
  const acc = {
    seasons: [...aggregateData.seasons],
    managers: {},
    matchupsByManagerPair: { ...(aggregateData.matchupsByManagerPair || {}) },
    records: aggregateData.records, // same shape as acc.records - direct passthrough
    legacies: { playerAppearances: {}, keptPlayers: {} },
    lastSeasonRosterSnapshots: aggregateData.lastSeasonRosterSnapshots || [],
    reigningChampionId: aggregateData.reigningChampionId,
    playerInfo: { ...(aggregateData.playerInfo || {}) },
  };

  for (const [userId, m] of Object.entries(aggregateData.managers)) {
    acc.managers[userId] = {
      userId: m.userId,
      displayName: m.displayName,
      avatar: m.avatar,
      wins: m.wins,
      losses: m.losses,
      ties: m.ties,
      pf: m.pf,
      pa: m.pa,
      transactions: m.transactions,
      trades: m.trades,
      championshipYears: [...m.championshipYears],
      runnerUpYears: [...m.runnerUpYears],
      teamNameHistory: [...m.teamNameHistory],
      yearlyStandings: [...m.yearlyStandings],
      yearlyStats: { ...m.yearlyStats },
      h2h: { ...m.h2h },
      cornerstones: Object.fromEntries(
        m.cornerstones.map((c) => [c.playerId, { ...c, years: new Set(c.years) }])
      ),
      nemeses: Object.fromEntries(m.nemesesFull.map((n) => [n.playerId, { ...n }])),
    };
  }

  // Best-effort - see file header limitation note.
  for (const rc of aggregateData.legacies.ringChasers) {
    acc.legacies.playerAppearances[rc.playerId] = { ...rc, history: [...rc.history] };
  }
  for (const lc of aggregateData.legacies.loyaltyClub) {
    acc.legacies.keptPlayers[lc.playerId] = { ...lc, history: [...lc.history] };
  }

  return acc;
}

/**
 * @param {import('./season-processor.mjs').AggregateData} staticAggregates - Frozen, build-time aggregate (fetched from /leagues/<slug>/data/aggregates.json).
 * @param {import('./season-processor.mjs').SeasonData|null} liveCurrentSeasonData - Result of processSeason() for the live current season, or null if the live fetch failed/hasn't happened yet.
 * @returns {import('./season-processor.mjs').AggregateData}
 */
export function mergeAggregates(staticAggregates, liveCurrentSeasonData) {
  if (!liveCurrentSeasonData) return staticAggregates;

  // Idempotent: once a real rebuild has frozen this season into history,
  // merging it again client-side would double-count it.
  if (Number(liveCurrentSeasonData.season) <= Number(staticAggregates.throughSeason || 0)) {
    return staticAggregates;
  }

  const acc = reconstructAccumulator(staticAggregates);
  _internal.foldSeasonIntoAccumulator(acc, liveCurrentSeasonData);
  return _internal.deriveAggregateData(acc, String(liveCurrentSeasonData.season));
}
