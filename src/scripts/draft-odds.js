// Ported from sb3.html's renderDraftOdds(): mid-season projected rookie draft
// order = reverse standings. Playoff teams (top 7, matching this league's
// format) draft after non-playoff teams, each group sorted by projected
// finish (wins asc, then max-potential-points asc as the tiebreaker).
import { getCurrentSeasonData } from "./sleeper-client.js";

const PLAYOFF_TEAMS = 7;

function readLeagueConfig() {
  const el = document.getElementById("draft-odds-league-config");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

function computeDraftOrder(rosterSnapshots) {
  const rosters = [...rosterSnapshots].filter((r) => r.ownerId);

  const withPct = rosters.map((r) => ({
    ...r,
    winPct: r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0,
  }));
  withPct.sort((a, b) => b.winPct - a.winPct || b.pf - a.pf);

  const playoffTeams = withPct.slice(0, PLAYOFF_TEAMS);
  const nonPlayoffTeams = withPct.slice(PLAYOFF_TEAMS);

  nonPlayoffTeams.sort((a, b) => a.ppts - b.ppts);
  playoffTeams.sort((a, b) => a.wins - b.wins || a.ppts - b.ppts);

  return [...nonPlayoffTeams, ...playoffTeams];
}

async function render() {
  const league = readLeagueConfig();
  const body = document.getElementById("draft-odds-body");
  const title = document.getElementById("draft-odds-title");
  if (!league || !body) return;

  const seasonData = await getCurrentSeasonData(league);
  if (!seasonData || !seasonData.rosterSnapshots?.length) {
    body.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-text-secondary">Draft order data is not yet available.</td></tr>`;
    return;
  }

  if (title) title.textContent = `${Number(seasonData.season) + 1} Projected Rookie Draft Order`;

  const order = computeDraftOrder(seasonData.rosterSnapshots);
  body.innerHTML = order
    .map((r, i) => {
      const manager = seasonData.managers[r.ownerId];
      return `<tr>
        <td class="px-4 py-2 font-semibold">${i + 1}</td>
        <td class="px-4 py-2">${manager?.displayName || "Unknown"}</td>
        <td class="px-4 py-2">${r.wins}-${r.losses}${r.ties ? "-" + r.ties : ""}</td>
        <td class="px-4 py-2">${r.ppts.toFixed(1)}</td>
      </tr>`;
    })
    .join("");
}

document.addEventListener("DOMContentLoaded", render);
