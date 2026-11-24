import { fetchWithRetry } from "../../data-build/fetch-with-retry.js";
import { buildPrimaryUserIdMap, processSeason } from "./season-processor.mjs";

const API = "https://api.sleeper.app/v1";
export const pickKey = (season, round, rosterId) => `${season}:${round}:${rosterId}`;

export async function fetchTradeTransactions(leagueId) {
  // Sleeper uses weekly buckets even in the offseason. Scan all of them so
  // week transitions or a trade filed under an earlier leg cannot hide a deal.
  const weeks = await Promise.all(Array.from({ length: 19 }, async (_, week) => {
    const rows = await fetchWithRetry(`${API}/league/${leagueId}/transactions/${week}`, 2);
    if (!Array.isArray(rows)) throw new Error(`Invalid Sleeper transaction feed for week ${week}`);
    return rows.filter(row => row.type === "trade" && row.status === "complete");
  }));
  return Object.fromEntries(weeks.map((rows, week) => [week, rows]));
}

export async function fetchTradeDraft(league) {
  const draftId = league.draft_id;
  const empty = { draftId: draftId || null, complete: false, lastPicked: null, picks: {} };
  if (!draftId) return empty;
  const url = `${API}/draft/${draftId}`;
  const draft = await fetchWithRetry(url, 2);
  if (String(draft.season) !== String(league.season) || String(draft.league_id) !== String(league.league_id)) return empty;
  if (!["drafting", "complete"].includes(draft.status) || !draft.slot_to_roster_id) return empty;

  const selections = await fetchWithRetry(`${url}/picks`, 2);
  if (!Array.isArray(selections)) throw new Error(`Invalid Sleeper draft results for ${draftId}`);
  const teamCount = draft.settings?.teams || Object.keys(draft.slot_to_roster_id).length;
  const picks = {};
  for (const selection of selections) {
    const originalRoster = draft.slot_to_roster_id[selection.draft_slot];
    const name = [selection.metadata?.first_name, selection.metadata?.last_name].filter(Boolean).join(" ");
    if (!selection.player_id || !selection.roster_id || !originalRoster || !name) continue;
    const round = Number(selection.round);
    const pickInRound = selection.pick_no - (round - 1) * teamCount;
    if (!Number.isInteger(round) || round < 1 || !(pickInRound > 0 && pickInRound <= teamCount)) continue;
    picks[pickKey(league.season, round, originalRoster)] = {
      name, rosterId: selection.roster_id, keeper: Boolean(selection.is_keeper),
      position: selection.metadata?.position,
      slot: `${round}.${String(pickInRound).padStart(2, "0")}`,
    };
  }
  return { draftId, complete: draft.status === "complete", lastPicked: draft.last_picked || null, picks };
}

export function tradeSeasonSnapshot(seasonData) {
  const managers = Object.fromEntries(Object.entries(seasonData.managers).map(([id, manager]) => [id, {
    displayName: manager.displayName, avatar: manager.avatar,
  }]));
  const rosters = Object.fromEntries(seasonData.rosterSnapshots.map(roster => [roster.rosterId, roster.ownerId]));
  return { leagueId: seasonData.leagueId, season: seasonData.season, managers, rosters, trades: seasonData.trades };
}

export function processTradeSeason(config, league, users, rosters, transactionsByWeek, nflPlayers) {
  return tradeSeasonSnapshot(processSeason({
    leagueObj: league, users, rosters, transactionsByWeek, nflPlayers, matchupsByWeek: {},
    managerInfoMap: config.managerInfoMap,
    primaryUserIdMap: buildPrimaryUserIdMap(config.coOwnerConfig, users),
  }));
}

export async function fetchTradeLeague(leagueId) {
  const url = `${API}/league/${leagueId}`;
  const [league, users, rosters] = await Promise.all([
    fetchWithRetry(url, 2), fetchWithRetry(`${url}/users`, 2), fetchWithRetry(`${url}/rosters`, 2),
  ]);
  if (String(league?.league_id) !== String(leagueId) || !Array.isArray(users) || !Array.isArray(rosters)) {
    throw new Error(`Invalid Sleeper metadata for league ${leagueId}`);
  }
  return { league, users, rosters };
}
