import { projectDraftBoard } from "./draft-odds-model.mjs";
import { FRANCHISE_COLORS } from "./manager-colors.js";
import { getDraftOddsData } from "./sleeper-client.js";

const points = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => entities[character]);
const byId = id => document.getElementById(`draft-odds-${id}`);
const pickLabel = slot => `1.${String(slot).padStart(2, "0")}`;

function managerFor(roster, managers) {
  const manager = managers[roster?.ownerId];
  const name = manager?.displayName || (roster ? `Roster ${roster.rosterId}` : "Ownership unavailable");
  return { name, avatar: manager?.avatar, color: FRANCHISE_COLORS[name] || "rgb(var(--color-accent-400))" };
}

function portrait(manager) {
  return manager.avatar
    ? `<img class="draft-avatar" src="${escapeHtml(manager.avatar)}" alt="" loading="lazy" decoding="async">`
    : `<span class="draft-avatar draft-avatar-fallback" aria-hidden="true">${escapeHtml(manager.name.charAt(0))}</span>`;
}

function identity(manager, context = "") {
  return `<div class="draft-identity" style="--franchise:${manager.color}">${portrait(manager)}
    <div><strong>${escapeHtml(manager.name)}</strong>${context}</div>
  </div>`;
}

function formatOdds(odds, locked) {
  if (odds == null) return "—";
  if (locked) return "100%";
  if (odds < 0.01) return "<1%";
  if (odds > 0.99) return ">99%";
  return `${Math.round(100 * odds)}%`;
}

function meter(odds) {
  return odds == null ? "" : `<span class="draft-meter" aria-hidden="true"><span style="width:${odds * 100}%"></span></span>`;
}

function record({ wins, losses, ties }) {
  return `${wins}–${losses}${ties ? `–${ties}` : ""}`;
}

function holderNote(row, managers) {
  if (!row.holder) return '<span class="draft-subline">Ownership unavailable</span>';
  if (row.holder.rosterId === row.origin.rosterId) return "";
  return `<span class="draft-subline">Held by ${escapeHtml(managerFor(row.holder, managers).name)}</span>`;
}

function renderSpotlight(rows, managers) {
  const [favorite, ...others] = rows.filter(row => row.firstOdds > 0)
    .sort((a, b) => b.firstOdds - a.firstOdds || a.slot - b.slot);
  if (!favorite) return;

  const origin = managerFor(favorite.origin, managers);
  byId("spotlight").style.setProperty("--franchise", origin.color);
  byId("favorite").innerHTML = `
    <strong class="draft-favorite-value">${escapeHtml(formatOdds(favorite.firstOdds, favorite.isLocked))}</strong>
    ${identity(origin, `<span class="draft-subline">Original franchise · ${record(favorite.origin)} · ${points.format(favorite.origin.ppts)} Max PF</span>${holderNote(favorite, managers)}`)}`;
  byId("challengers").innerHTML = others.slice(0, 3).map(row => {
    const challenger = managerFor(row.origin, managers);
    return `<li style="--franchise:${challenger.color}">
      ${identity(challenger, holderNote(row, managers))}${meter(row.firstOdds)}<strong>${escapeHtml(formatOdds(row.firstOdds, false))}</strong>
    </li>`;
  }).join("");
  byId("challengers").hidden = others.length === 0;
  byId("spotlight-title").textContent = favorite.isLocked ? "No. 1 overall locked" : "No. 1 overall odds";
  byId("spotlight").hidden = false;
}

function renderRow(row, managers) {
  const { origin, holder, rank, slot, isPlayoff, isLocked, isChampionPick, slotOdds } = row;
  const originalManager = managerFor(origin, managers);
  const currentManager = managerFor(holder, managers);
  const traded = holder && holder.rosterId !== origin.rosterId;
  const originMarkup = !holder || traded
    ? `<div class="draft-original" style="--franchise:${originalManager.color}">${portrait(originalManager)}
        <span><span class="draft-role">Original franchise</span> ${escapeHtml(originalManager.name)}</span>
      </div>` : "";
  const value = isPlayoff ? origin.pf : origin.ppts;
  const metric = isPlayoff ? "PF" : "Max PF";
  const oddsLabel = formatOdds(slotOdds, isLocked);
  return `<li class="draft-row draft-columns${traded ? " is-traded" : ""}" style="--franchise:${holder ? currentManager.color : originalManager.color}">
    <strong class="draft-slot">${pickLabel(slot)}</strong>
    <div class="draft-owner">
      ${identity(currentManager, traded ? '<span class="draft-subline draft-role">Current holder</span>' : "")}${originMarkup}
      ${isChampionPick ? '<span class="draft-subline draft-champion">Champion’s pick</span>' : ""}
    </div>
    <div class="draft-record"><span class="sr-only">Original franchise record</span><strong>${record(origin)}</strong><span class="draft-subline">${rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`} in standings</span></div>
    <div class="draft-points"><strong>${points.format(value)}</strong><span class="draft-subline">${metric}</span></div>
    <div class="draft-slot-odds">
      <span class="sr-only">${slotOdds == null ? "Slot odds unavailable" : "Chance of this slot"}</span>
      <strong>${escapeHtml(oddsLabel)}</strong>${meter(slotOdds)}
      ${isLocked ? '<span class="draft-subline">Locked</span>' : '<span class="draft-subline draft-mobile-odds" aria-hidden="true">Slot odds</span>'}
    </div>
  </li>`;
}

function renderGroup(rows, label, rule, managers) {
  if (!rows.length) return "";
  const headingId = rows[0].isPlayoff ? "draft-playoff-picks" : "draft-non-playoff-picks";
  return `<section class="draft-group" aria-labelledby="${headingId}">
    <header class="draft-group-header">
      <h4 id="${headingId}">${label}</h4><span>${rule}</span>
    </header>
    <ol start="${rows[0].slot}" class="draft-picks" role="list">${rows.map(row => renderRow(row, managers)).join("")}</ol>
  </section>`;
}

async function render() {
  const config = document.getElementById("draft-odds-league-config");
  if (!config) return;
  const status = byId("status");
  const data = await getDraftOddsData(JSON.parse(config.textContent));
  if (!data || data.rosterSnapshots.length <= data.playoffTeams ||
      (data.rosterCount && data.rosterSnapshots.length !== data.rosterCount)) {
    status.textContent = "Sleeper standings are currently unavailable.";
    return;
  }

  byId("title").textContent = `${Number(data.season) + 1} Rookie Draft Odds`;
  if (data.completedWeek < data.firstWeek || !data.maxPfAvailable) {
    status.textContent = "The board will appear when Sleeper has scored games and Max PF for every roster.";
    return;
  }

  const { rows, regularComplete, hasBracket, final } = projectDraftBoard(data);
  const phase = final ? "Final order" : regularComplete ? "Playoff bracket" : `Through Week ${data.completedWeek}`;
  const warnings = [];
  if (data.stale) warnings.push(`Sleeper is unavailable. Showing the snapshot from ${new Date(data.fetchedAt).toLocaleString()}.`);
  if (rows.some(row => !row.holder)) warnings.push("Pick ownership is unavailable where marked.");
  if (regularComplete && !hasBracket) warnings.push("Awaiting Sleeper’s playoff bracket. The board still uses regular-season standings.");
  if (rows.every(row => row.slotOdds == null)) warnings.push("Odds will appear when enough weekly scores and the remaining schedule are available.");
  status.textContent = warnings.join(" ");
  status.hidden = !warnings.length;
  byId("week").textContent = phase;
  byId("order-title").textContent = final ? "Final first-round order" : "Projected first-round order";
  renderSpotlight(rows, data.managers);

  const nonPlayoff = rows.filter(row => !row.isPlayoff);
  const playoff = rows.filter(row => row.isPlayoff);
  const regularLabel = regularComplete && hasBracket ? "Non-playoff teams" : "Projected non-playoff teams";
  const playoffLabel = regularComplete && hasBracket ? "Playoff teams" : "Projected playoff teams";
  const playoffRule = final ? "Playoff results · Champion picks last"
    : regularComplete && hasBracket ? "Playoff results · Seed projection for unplayed games" : "Reverse seed order · Higher PF wins record ties";
  byId("body").innerHTML = `
    <div class="draft-columns draft-column-labels" aria-hidden="true">
      <span>Pick</span><span>Pick ownership</span><span>Origin record</span><span>Origin points</span><span>Slot odds</span>
    </div>
    ${renderGroup(nonPlayoff, regularLabel, "Lowest Max PF picks first", data.managers)}
    ${renderGroup(playoff, playoffLabel, playoffRule, data.managers)}`;
  byId("content").hidden = false;
}

document.addEventListener("DOMContentLoaded", render);
