// Reference implementation of the live current-season merge (see merge.js's
// file header for the full pattern). Other all-time views (Records, My Team,
// Legends) follow the same three calls - fetch static aggregate, fetch live
// season, mergeAggregates() - and are the natural next pages to wire up the
// same way.
import { getCurrentSeasonData } from "./sleeper-client.js";
import { mergeAggregates } from "./merge.js";

function readLeagueConfig() {
  const el = document.getElementById("dashboard-league-config");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

function renderStandings(aggregate) {
  const tbody = document.getElementById("power-rankings-body");
  if (!tbody) return;
  tbody.innerHTML = aggregate.standings
    .map(
      (m) => `<tr>
        <td class="px-4 py-3 font-semibold">${m.rank}</td>
        <td class="px-4 py-3 flex items-center gap-2">
          <img src="${m.avatar}" alt="" class="w-7 h-7 rounded-full cursor-pointer" onclick="window.expandAvatar && window.expandAvatar(this.src)">
          ${m.displayName}${m.userId === aggregate.reigningChampionId ? ' <span title="Reigning Champ">👑</span>' : ""}
        </td>
        <td class="px-4 py-3"><span class="win">${m.wins}</span>-<span class="loss">${m.losses}</span>${m.ties ? "-" + m.ties : ""}</td>
        <td class="px-4 py-3">${(m.winPct * 100).toFixed(1)}%</td>
        <td class="px-4 py-3"><span class="win">${m.pf.toFixed(1)}</span> / <span class="loss">${m.pa.toFixed(1)}</span></td>
      </tr>`
    )
    .join("");
}

function renderTrophyCase(aggregate) {
  const card = document.getElementById("trophy-case-card");
  if (!card) return;
  const row = (m) =>
    `<div class="flex items-center justify-between gap-2 text-sm">
      <span class="flex items-center gap-2"><img src="${m.avatar}" alt="" class="w-6 h-6 rounded-full">${m.displayName}</span>
      <span class="text-text-secondary">${m.years.join(", ")}</span>
    </div>`;
  const champs = aggregate.trophyCase.champions;
  const runnerUps = aggregate.trophyCase.runnerUps;
  card.innerHTML = `
    <h2 class="text-xl font-bold mb-4 text-yellow-400">🏆 Trophy Case 🏆</h2>
    ${champs.length > 0 ? `<div class="space-y-3"><p class="text-xs uppercase tracking-wider text-text-secondary">Champions</p>${champs.map(row).join("")}</div>` : ""}
    ${runnerUps.length > 0 ? `<div class="space-y-3 mt-6"><p class="text-xs uppercase tracking-wider text-text-secondary">Runner-Ups</p>${runnerUps.map(row).join("")}</div>` : ""}
    ${champs.length === 0 ? '<p class="text-text-secondary text-sm">No champions crowned yet.</p>' : ""}
  `;
}

async function run() {
  const league = readLeagueConfig();
  if (!league) return;

  let staticAggregate;
  try {
    staticAggregate = await fetch(`/leagues/${league.slug}/data/aggregates.json`).then((r) => r.json());
  } catch {
    return; // No static data yet (fetch-sleeper.js hasn't run) - leave the (empty) server-rendered state as-is.
  }

  const liveCurrentSeasonData = await getCurrentSeasonData(league);
  const merged = mergeAggregates(staticAggregate, liveCurrentSeasonData);

  if (merged !== staticAggregate) {
    renderStandings(merged);
    renderTrophyCase(merged);
    document.getElementById("live-season-note")?.classList.remove("hidden");
  }
}

document.addEventListener("DOMContentLoaded", run);
