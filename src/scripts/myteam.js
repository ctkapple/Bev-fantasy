// Populates the "My Team" tab from the AggregateData.managers JSON embedded
// in the page (see src/pages/sections/myteam.njk) - no network fetch needed,
// this is all pre-computed at build time.

import { ICON_CROWN } from "./icons.js";
import { NAME_COLORS } from "../../lib/people.js";

// Anyone the person registry has never heard of draws in neutral slate rather
// than borrowing someone else's identity color — matches lib/rankings-model.js.
const FALLBACK_CHIP = "#64748b";

function readJson(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

function fmtPct(p) {
  return `${(p * 100).toFixed(1)}%`;
}

function renderManager(managers, reigningChampId, userId) {
  const m = managers[userId];
  const container = document.getElementById("my-team-data");
  if (!m || !container) return;

  const crown = userId === reigningChampId ? ` <span title="Reigning Champ">${ICON_CROWN}</span>` : "";
  const chip = NAME_COLORS[m.displayName] || FALLBACK_CHIP;
  const yearlyRows = m.yearlyStandings
    .map((y) => {
      const stats = m.yearlyStats[y.year] || {};
      return `<tr>
        <td class="px-2 py-2">${y.year}</td>
        <td class="px-2 py-2 text-center">${y.rank}/${y.totalTeams}</td>
        <td class="px-2 py-2 text-center">${stats.record ?? ""}</td>
        <td class="px-2 py-2 text-right win">${(stats.pf ?? 0).toFixed(2)}</td>
        <td class="px-2 py-2 text-right loss">${(stats.pa ?? 0).toFixed(2)}</td>
        <td class="px-2 py-2 text-right">${stats.transactions ?? 0}</td>
      </tr>`;
    })
    .join("");

  const legendsRows = m.franchiseLegends
    .map((c) => `<li class="text-sm flex justify-between"><span class="pos-${c.position || "NA"}">${c.name || "Unknown"} <span class="text-text-muted">(${c.position || "?"})</span></span><span class="text-text-secondary">${c.weeks} wks</span></li>`)
    .join("");

  const nemesesRows = m.archNemeses
    .map((n) => `<li class="text-sm flex justify-between"><span class="pos-${n.position || "NA"}">${n.name || "Unknown"} <span class="text-text-muted">(${n.position || "?"})</span></span><span class="loss">${n.points.toFixed(2)} pts</span></li>`)
    .join("");

  const nameHistory = m.teamNameHistory
    .map((t) => `<li class="text-sm">${t.year}: ${t.name || "—"}</li>`)
    .join("");

  const rivalHtml = m.rival
    ? `<p class="text-sm">${managers[m.rival.managerId]?.displayName || "Unknown"} <span class="text-text-secondary">(${m.rival.losses} losses to them)</span></p>`
    : `<p class="text-sm text-text-secondary">No clear rival yet.</p>`;

  const cornerstoneRows = m.cornerstones
    .slice(0, 25)
    .map(
      (c) => `<tr>
        <td class="px-4 py-2 pos-${c.position || "NA"}">${c.position || "N/A"}</td>
        <td class="px-4 py-2 font-semibold pos-${c.position || "NA"}">${c.name || "Unknown"}</td>
        <td class="px-4 py-2 text-right">${c.points.toFixed(2)}</td>
        <td class="px-4 py-2 text-right">${c.weeks}</td>
        <td class="px-4 py-2 text-right">${c.years.length}</td>
      </tr>`
    )
    .join("");

  container.innerHTML = `
    <div class="card text-center mb-6">
      <img src="${m.avatar}" alt="${m.displayName}" class="w-24 h-24 rounded-full mx-auto mb-4 border-4 object-cover shadow-lg cursor-pointer hover:scale-110 transition-transform" style="border-color:${chip}" onclick="window.expandAvatar && window.expandAvatar(this.src)">
      <h2 class="text-2xl sm:text-3xl font-bold" style="color:${chip}">${m.displayName}${crown}</h2>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <div class="card">
          <h3 class="text-xl font-bold mb-4 text-accent-500">Career Stats</h3>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-center">
            <div><p class="text-text-secondary text-sm">Overall Record</p><p class="text-xl font-semibold">${m.wins}-${m.losses}${m.ties ? "-" + m.ties : ""}</p></div>
            <div><p class="text-text-secondary text-sm">Win %</p><p class="text-xl font-semibold">${fmtPct(m.winPct)}</p></div>
            <div><p class="text-text-secondary text-sm">Transactions</p><p class="text-xl font-semibold">${m.transactions}</p></div>
            <div><p class="text-text-secondary text-sm">Points For</p><p class="text-xl font-semibold win">${m.pf.toFixed(2)}</p></div>
            <div><p class="text-text-secondary text-sm">Points Against</p><p class="text-xl font-semibold loss">${m.pa.toFixed(2)}</p></div>
            <div><p class="text-text-secondary text-sm">Trades</p><p class="text-xl font-semibold">${m.trades}</p></div>
          </div>
        </div>
        <div class="card">
          <h3 class="text-xl font-bold mb-4 text-accent-500">Year by Year</h3>
          <div class="overflow-x-auto">
            <table class="stat-table">
              <thead><tr><th class="px-2 py-3">Year</th><th class="px-2 py-3 text-center">Finish</th><th class="px-2 py-3 text-center">Record</th><th class="px-2 py-3 text-right win">PF</th><th class="px-2 py-3 text-right loss">PA</th><th class="px-2 py-3 text-right">Moves</th></tr></thead>
              <tbody>${yearlyRows}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <h3 class="text-xl font-bold mb-4 text-accent-500">Franchise Cornerstones</h3>
          <p class="text-xs text-text-muted -mt-4 mb-4">All players ever rostered, sorted by tenure.</p>
          <div class="overflow-x-auto">
            <table class="stat-table">
              <thead><tr><th class="px-4 py-3">Pos</th><th class="px-4 py-3">Name</th><th class="px-4 py-3 text-right">Points</th><th class="px-4 py-3 text-right">Weeks</th><th class="px-4 py-3 text-right">Years</th></tr></thead>
              <tbody>${cornerstoneRows}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="space-y-6">
        <div class="card"><h3 class="text-xl font-bold mb-4 text-accent-500">Franchise Rival</h3>${rivalHtml}</div>
        <div class="card"><h3 class="text-xl font-bold mb-4 text-accent-500">Franchise Legends</h3><p class="text-xs text-text-muted -mt-2 mb-4">Longest-tenured players</p><ul class="space-y-2">${legendsRows || '<li class="text-sm text-text-secondary">None yet.</li>'}</ul></div>
        <div class="card"><h3 class="text-xl font-bold mb-4 text-accent-500">Arch-Nemeses</h3><p class="text-xs text-text-muted -mt-2 mb-4">Players who've scored the most against you</p><ul class="space-y-2">${nemesesRows || '<li class="text-sm text-text-secondary">None yet.</li>'}</ul></div>
        <div class="card"><h3 class="text-xl font-bold mb-4 text-accent-500">Team Name History</h3><ul class="space-y-1">${nameHistory}</ul></div>
      </div>
    </div>
  `;
  container.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  const managers = readJson("myteam-data");
  const reigningChampId = readJson("myteam-reigning-champ");
  const buttons = [...document.querySelectorAll("[data-my-team-id]")];
  if (!managers || !buttons.length) return;

  buttons.forEach((button) => {
    const m = managers[button.dataset.myTeamId];
    const chip = (m && NAME_COLORS[m.displayName]) || FALLBACK_CHIP;
    const avatar = button.querySelector(".poll-voter-avatar");
    if (avatar) avatar.style.borderColor = chip;
    const name = button.querySelector(".poll-pick-copy strong");
    if (name) name.style.color = chip;
  });

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((candidate) => {
        const selected = candidate === button;
        candidate.setAttribute("aria-pressed", String(selected));
        const state = candidate.querySelector(".poll-voter-state");
        if (state) state.textContent = selected ? "Selected" : "";
      });
      renderManager(managers, reigningChampId, button.dataset.myTeamId);
    });
  });
});
