// Populates the Keeper Assistant tab: pick a manager, see their current
// roster's keeper eligibility/cost/streak (src/scripts/keeper-engine.mjs has
// the actual algorithm). Draft/ADP history for completed seasons is static
// (src/leagues/<slug>/data/drafts.json, built by data-build/fetch-sleeper.js);
// the current live roster comes from the existing sleeper-client.js path. If
// the CURRENT season's draft isn't in the static file yet (season-rollover
// gap - fetch-sleeper.js's historical-seasons filter deliberately excludes
// the still-active current season), a small live top-up fetches just that
// one season directly from Sleeper.

import { getCurrentSeasonData } from "./sleeper-client.js";
import { fetchWithRetry } from "../../data-build/fetch-with-retry.js";
import {
  buildDraftPickIndex,
  computeRosterKeeperProfiles,
  applyKeeperOverrides,
  scoringFormatFromLeagueObj,
  adpProjectionsUrl,
  parseAdpRows,
  adpToRound,
  findCompletedDraft,
  parseDraftPicks,
} from "./keeper-engine.mjs";

const SLEEPER_BASE = "https://api.sleeper.app/v1";

function readJson(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

async function fetchStaticDraftHistory(slug) {
  try {
    const res = await fetch(`/leagues/${slug}/data/drafts.json`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/** Live top-up for the current season if it's missing from the static drafts.json (see file header). */
async function fetchLiveSeasonDraftData(league, seasonData) {
  const drafts = await fetchWithRetry(`${SLEEPER_BASE}/league/${league.currentLeagueId}/drafts`);
  const completed = findCompletedDraft(drafts);
  if (!completed) return null; // this season's draft hasn't happened yet

  const rosterIdToOwnerId = {};
  for (const r of seasonData.rosterSnapshots) {
    if (r.ownerId) rosterIdToOwnerId[r.rosterId] = r.ownerId;
  }

  const [rawPicks, leagueObj] = await Promise.all([
    fetchWithRetry(`${SLEEPER_BASE}/draft/${completed.draft_id}/picks`),
    fetchWithRetry(`${SLEEPER_BASE}/league/${league.currentLeagueId}`),
  ]);
  const picks = parseDraftPicks(rawPicks, rosterIdToOwnerId);
  const format = scoringFormatFromLeagueObj(leagueObj);

  const adpByPlayerId = {};
  try {
    const rawAdpRows = await fetchWithRetry(adpProjectionsUrl(seasonData.season));
    const adpValues = parseAdpRows(rawAdpRows, format);
    for (const [playerId, adp] of Object.entries(adpValues)) {
      adpByPlayerId[playerId] = { adp, round: adpToRound(adp, seasonData.totalTeams) };
    }
  } catch {
    // ADP fetch failed - undrafted-player keeper cost will be unavailable this page load, not fatal.
  }

  return {
    season: seasonData.season,
    teamCount: seasonData.totalTeams,
    scoringFormat: format,
    rounds: completed.settings?.rounds ?? null,
    picks,
    adpByPlayerId,
  };
}

function keeperRoundLabel(profile) {
  if (profile.keeperRound == null) return "—";
  return profile.exceedsDraftRounds ? `Round ${profile.keeperRound}*` : `Round ${profile.keeperRound}`;
}

function originalDraftLabel(profile) {
  if (profile.costBasis === "drafted") return `Round ${profile.originalDraftRound} (${profile.originalDraftSeason})`;
  if (profile.costBasis === "undrafted") return "Undrafted (ADP-based)";
  return "Unknown";
}

function streakLabel(profile) {
  if (profile.streakCount === 0) return "New";
  return `${profile.streakCount} of 2 yrs kept${profile.streakCount >= 2 ? " — maxed" : ""}`;
}

function renderLoading(tbody, message) {
  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-text-secondary">${message}</td></tr>`;
}

function renderRoster(tbody, profiles) {
  if (profiles.length === 0) {
    renderLoading(tbody, "No players on this roster.");
    return;
  }
  const sorted = [...profiles].sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
  tbody.innerHTML = sorted
    .map((p) => {
      const posClass = `pos-${p.position || "NA"}`;
      const title = p.note ? p.note.replace(/"/g, "&quot;") : "";
      return `<tr title="${title}">
        <td class="px-4 py-2 font-semibold ${posClass}">${p.name}</td>
        <td class="px-4 py-2 ${posClass}" data-value="${p.position || ""}">${p.position || "N/A"}</td>
        <td class="px-4 py-2">${originalDraftLabel(p)}</td>
        <td class="px-4 py-2" data-value="${p.keeperRound ?? ""}">${keeperRoundLabel(p)}</td>
        <td class="px-4 py-2" data-value="${p.streakCount}">${streakLabel(p)}</td>
        <td class="px-4 py-2 text-center ${p.eligible ? "win" : "loss"}">${p.eligible ? "✅" : "❌"}</td>
      </tr>`;
    })
    .join("");
}

async function render() {
  const league = readJson("keeper-assistant-league-config");
  const overrides = readJson("keeper-assistant-overrides") || {};
  const select = document.getElementById("keeper-assistant-select");
  const tbody = document.getElementById("keeper-assistant-body");
  if (!league || !select || !tbody) return;

  renderLoading(tbody, "Loading roster and draft history…");

  const [draftHistory, seasonData] = await Promise.all([
    fetchStaticDraftHistory(league.slug),
    getCurrentSeasonData(league),
  ]);

  if (!seasonData) {
    renderLoading(tbody, "Couldn't load current roster data.");
    return;
  }

  let fullHistory = draftHistory;
  const hasCurrentSeason = draftHistory.some((sd) => sd.season === seasonData.season);
  if (!hasCurrentSeason) {
    const liveTopUp = await fetchLiveSeasonDraftData(league, seasonData).catch(() => null);
    if (liveTopUp) fullHistory = [...draftHistory, liveTopUp];
  }

  const pickIndex = buildDraftPickIndex(fullHistory);
  const latestSeasonDraft = [...fullHistory].sort((a, b) => Number(b.season) - Number(a.season))[0] || null;

  select.disabled = false;
  renderLoading(tbody, "Select a manager above.");

  select.addEventListener("change", () => {
    if (!select.value) {
      renderLoading(tbody, "Select a manager above.");
      return;
    }
    const roster = seasonData.rosterSnapshots.find((r) => r.ownerId === select.value);
    if (!roster) {
      renderLoading(tbody, "No roster found for this manager.");
      return;
    }
    const profiles = computeRosterKeeperProfiles(
      roster.players,
      select.value,
      pickIndex,
      latestSeasonDraft,
      seasonData.playerInfoLookup
    );
    renderRoster(tbody, applyKeeperOverrides(profiles, overrides));
  });
}

document.addEventListener("DOMContentLoaded", render);
