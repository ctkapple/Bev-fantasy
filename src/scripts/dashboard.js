// Rankings tab ("the standings desk") behavior:
//
//   1. chart isolation — click a legend chip or a line to bring one manager
//      forward and push the pack back
//   2. the live current-season merge — fold the in-progress season on top of
//      the frozen aggregate and redraw
//
// The redraw calls the exact same lib/rankings-markup.js functions .eleventy.js
// used to render the page, so the live view and the frozen view cannot diverge.
// The previous version kept its own copy of the standings markup and a lesser
// copy of the trophy case, which silently dropped the Toilet King block and
// every identity-colored ring the moment a season went live.
import { getCurrentSeasonData } from "./sleeper-client.js";
import { mergeAggregates } from "./merge.js";
import { buildRankingsView } from "../../lib/rankings-model.js";
import {
  climbLegendMarkup,
  climbMarkup,
  raftersMarkup,
  standingsMarkup,
} from "../../lib/rankings-markup.js";
import { PEOPLE } from "../../lib/people.js";

function readLeagueConfig() {
  const el = document.getElementById("dashboard-league-config");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

// --- Isolation -------------------------------------------------------------
// One manager forward, everyone else dimmed. Driven by a class on the card so
// the whole cascade lives in CSS (see .rank-climb-card.is-isolating).
function setupIsolation(root) {
  const card = root.querySelector("[data-climb]");
  if (!card) return;
  const svg = card.querySelector("[data-climb-svg]");
  const legend = card.querySelector("[data-climb-legend]");
  let pinned = null;

  const apply = (managerId) => {
    card.classList.toggle("is-isolating", Boolean(managerId));
    for (const el of card.querySelectorAll("[data-manager]")) {
      el.classList.toggle("is-active", el.dataset.manager === managerId);
      if (el.tagName === "BUTTON") {
        el.setAttribute("aria-pressed", String(el.dataset.manager === managerId));
      }
    }
  };

  legend?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-manager]");
    if (!chip) return;
    pinned = pinned === chip.dataset.manager ? null : chip.dataset.manager;
    apply(pinned);
  });

  svg?.addEventListener("click", (event) => {
    const series = event.target.closest("[data-manager]");
    if (!series) return;
    pinned = pinned === series.dataset.manager ? null : series.dataset.manager;
    apply(pinned);
  });

  // Hover previews the isolation without committing to it, but never fights a
  // pinned selection.
  svg?.addEventListener("mouseover", (event) => {
    if (pinned) return;
    const series = event.target.closest("[data-manager]");
    if (series) apply(series.dataset.manager);
  });
  svg?.addEventListener("mouseleave", () => {
    if (!pinned) apply(null);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pinned) {
      pinned = null;
      apply(null);
    }
  });
}

// --- Live season -----------------------------------------------------------
function render(root, view) {
  root.querySelector("[data-rafters]").innerHTML = raftersMarkup(view.rafters);
  root.querySelector("[data-standings]").innerHTML = standingsMarkup(view.rows);

  const svg = root.querySelector("[data-climb-svg]");
  if (svg && view.hasClimb) {
    // The merged season adds a column, so the viewBox itself has to move.
    svg.setAttribute("viewBox", `0 0 ${view.climb.width} ${view.climb.height}`);
    svg.innerHTML = climbMarkup(view.climb);
    root.querySelector("[data-climb-legend]").innerHTML = climbLegendMarkup(view.rows);
  }
}

async function run() {
  const root = document.getElementById("dashboard-root");
  if (!root) return;
  setupIsolation(root);

  const league = readLeagueConfig();
  if (!league) return;

  let staticAggregate;
  try {
    staticAggregate = await fetch(`/leagues/${league.slug}/data/aggregates.json`).then((r) => r.json());
  } catch {
    return; // No static data yet (fetch-sleeper.js hasn't run) — leave the server-rendered state as-is.
  }

  const liveCurrentSeasonData = await getCurrentSeasonData(league);
  const merged = mergeAggregates(staticAggregate, liveCurrentSeasonData);
  if (merged === staticAggregate) return; // Nothing live to add.

  const view = buildRankingsView(league, merged, PEOPLE);
  if (!view) return;

  render(root, view);
  document.getElementById("live-season-note")?.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", run);
