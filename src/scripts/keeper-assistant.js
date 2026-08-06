// Populates the Keeper Assistant tab: pick a manager, see their current
// roster's keeper eligibility, cost, and streak (src/scripts/keeper-engine.mjs
// has the algorithm and the round-direction rationale).
//
// Draft history + end-of-season rosters for completed seasons, and ADP for the
// upcoming draft, are static (src/leagues/<slug>/data/drafts.json, built by
// data-build/fetch-sleeper.js). The current live roster comes from the existing
// sleeper-client.js path. If the CURRENT season's draft isn't in the static
// file yet (season-rollover gap - fetch-sleeper.js records a season only once
// its draft completes), a small live top-up fetches just that one season.

import { getCurrentSeasonData } from "./sleeper-client.js";
import { fetchWithRetry } from "../../data-build/fetch-with-retry.js";
import {
  buildDraftPickIndex,
  buildRosterHistoryIndex,
  computeRosterKeeperProfiles,
  applyKeeperOverrides,
  findCompletedDraft,
  parseDraftPicks,
  parseRostersByOwner,
  scoringFormatFromLeagueObj,
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

async function fetchDraftData(slug) {
  try {
    const res = await fetch(`/leagues/${slug}/data/drafts.json`);
    if (!res.ok) return { seasons: [], upcomingAdp: null };
    const data = await res.json();
    // Tolerate the pre-upcomingAdp array shape in case a stale file is served.
    return Array.isArray(data) ? { seasons: data, upcomingAdp: null } : data;
  } catch {
    return { seasons: [], upcomingAdp: null };
  }
}

/** Live top-up for the current season if it's missing from the static file (see file header). */
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

  return {
    season: seasonData.season,
    teamCount: seasonData.totalTeams,
    scoringFormat: scoringFormatFromLeagueObj(leagueObj),
    rounds: completed.settings?.rounds ?? null,
    picks: parseDraftPicks(rawPicks, rosterIdToOwnerId),
    playersByOwner: parseRostersByOwner(
      seasonData.rosterSnapshots.map((r) => ({ owner_id: r.ownerId, players: r.players }))
    ),
  };
}

function keeperRoundLabel(profile) {
  if (profile.keeperRound == null) return "—";
  const flagged = profile.belowFirstRound || profile.beyondDraftRounds;
  return `Round ${profile.keeperRound}${flagged ? "*" : ""}`;
}

function originLabel(profile) {
  if (profile.costBasis === "drafted") return `Round ${profile.originRound} (${profile.originSeason})`;
  if (profile.costBasis === "undrafted") return `Undrafted — ${profile.adpSeason} ADP rd ${profile.adpRound}`;
  return "Undrafted — no ADP";
}

function streakLabel(profile) {
  if (profile.costBasis !== "drafted") return "New";
  if (profile.streakCount === 0) return "New";
  return profile.streakCount >= 2 ? "2 of 2 — maxed" : `${profile.streakCount} of 2 yrs kept`;
}

function renderMessage(tbody, message) {
  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-text-secondary">${message}</td></tr>`;
}

function renderRoster(tbody, profiles) {
  if (profiles.length === 0) {
    renderMessage(tbody, "No players on this roster.");
    return;
  }
  // Cheapest (highest round number) keepers are the least interesting, so lead
  // with the ones that would cost the most.
  const sorted = [...profiles].sort(
    (a, b) => (a.keeperRound ?? 99) - (b.keeperRound ?? 99) || a.name.localeCompare(b.name)
  );
  tbody.innerHTML = sorted
    .map((p) => {
      const posClass = `pos-${p.position || "NA"}`;
      const title = p.note ? p.note.replace(/"/g, "&quot;") : "";
      return `<tr${title ? ` title="${title}"` : ""}>
        <td class="px-4 py-2 font-semibold ${posClass}">${p.name}</td>
        <td class="px-4 py-2 ${posClass}" data-value="${p.position || ""}">${p.position || "N/A"}</td>
        <td class="px-4 py-2">${originLabel(p)}</td>
        <td class="px-4 py-2" data-value="${p.keeperRound ?? 99}">${keeperRoundLabel(p)}</td>
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
  const adpNote = document.getElementById("keeper-assistant-adp-note");
  if (!league || !select || !tbody) return;

  renderMessage(tbody, "Loading roster and draft history…");

  const [draftData, seasonData] = await Promise.all([
    fetchDraftData(league.slug),
    getCurrentSeasonData(league),
  ]);

  if (!seasonData) {
    renderMessage(tbody, "Couldn't load current roster data.");
    return;
  }

  let seasons = draftData.seasons || [];
  if (!seasons.some((sd) => sd.season === seasonData.season)) {
    const liveTopUp = await fetchLiveSeasonDraftData(league, seasonData).catch(() => null);
    if (liveTopUp) seasons = [...seasons, liveTopUp];
  }

  const indexes = {
    pickIndex: buildDraftPickIndex(seasons),
    rosterIndex: buildRosterHistoryIndex(seasons),
  };
  const upcomingAdp = draftData.upcomingAdp || null;

  if (adpNote && upcomingAdp) {
    adpNote.textContent = `Undrafted-player costs use ${upcomingAdp.season} ADP (${upcomingAdp.teamCount}-team, ${upcomingAdp.rounds} rounds).`;
  }

  select.disabled = false;
  renderMessage(tbody, "Select a manager above.");

  select.addEventListener("change", () => {
    if (!select.value) {
      renderMessage(tbody, "Select a manager above.");
      return;
    }
    const roster = seasonData.rosterSnapshots.find((r) => r.ownerId === select.value);
    if (!roster) {
      renderMessage(tbody, "No roster found for this manager.");
      return;
    }
    const profiles = computeRosterKeeperProfiles(
      roster.players,
      select.value,
      indexes,
      upcomingAdp,
      seasonData.playerInfoLookup
    );
    renderRoster(tbody, applyKeeperOverrides(profiles, overrides));
  });
}

document.addEventListener("DOMContentLoaded", render);
