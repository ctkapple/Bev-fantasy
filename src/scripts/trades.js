// Trades tab filter bar: a free-text search plus filter chips (manager,
// season, position, draft pick, FAAB). Everything the filters need is
// already sitting in data-* attributes on the server-rendered trade cards
// (see the `tradeIndex` filter in .eleventy.js and trades.njk) - this module
// just reads those, shows/hides cards, and keeps the chip labels/result
// count in sync. No re-fetch, no re-render of trade markup.

function setupChipPopovers() {
  const triggers = [...document.querySelectorAll("[data-chip-trigger]")];
  const panels = [...document.querySelectorAll("[data-chip-panel]")];

  function closeAll() {
    panels.forEach((p) => p.classList.add("hidden"));
    triggers.forEach((t) => t.setAttribute("aria-expanded", "false"));
  }

  triggers.forEach((trigger) => {
    const panel = document.getElementById(trigger.dataset.chipTrigger);
    if (!panel) return;
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !panel.classList.contains("hidden");
      closeAll();
      if (!isOpen) {
        panel.classList.remove("hidden");
        trigger.setAttribute("aria-expanded", "true");
      }
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
  });

  document.addEventListener("click", closeAll);
  return closeAll;
}

// Fills the pick-season/pick-round <select>s from whatever "season:round"
// tokens actually appear in data-picks across the page, so the options
// always match real data instead of a hardcoded guess.
function populatePickOptions(tradeCards) {
  const seasons = new Set();
  const rounds = new Set();
  for (const card of tradeCards) {
    const picks = (card.dataset.picks || "").trim();
    if (!picks) continue;
    for (const token of picks.split(" ")) {
      const [season, round] = token.split(":");
      if (season) seasons.add(season);
      if (round) rounds.add(Number(round));
    }
  }

  const seasonSelect = document.getElementById("pick-season-select");
  for (const season of [...seasons].sort((a, b) => b - a)) {
    seasonSelect.append(new Option(season, season));
  }
  const roundSelect = document.getElementById("pick-round-select");
  for (const round of [...rounds].sort((a, b) => a - b)) {
    roundSelect.append(new Option(`Round ${round}`, String(round)));
  }
}

function selectedLabel(select) {
  return select.value ? select.selectedOptions[0].textContent : "";
}

document.addEventListener("DOMContentLoaded", () => {
  const filterBar = document.getElementById("trades-filter-bar");
  const tradeCards = [...document.querySelectorAll("[data-trade]")];
  if (!filterBar || tradeCards.length === 0) return;

  const seasonBlocks = [...document.querySelectorAll("[data-season-block]")];
  const search = document.getElementById("trades-search");
  const manager1Select = document.getElementById("manager1-select");
  const manager2Select = document.getElementById("manager2-select");
  const seasonSelect = document.getElementById("season-select");
  const positionSelect = document.getElementById("position-select");
  const pickSeasonSelect = document.getElementById("pick-season-select");
  const pickRoundSelect = document.getElementById("pick-round-select");
  const faabBtn = document.getElementById("chip-faab-btn");
  const clearBtn = document.getElementById("clear-filters-btn");
  const resultCount = document.getElementById("trades-result-count");
  const emptyState = document.getElementById("trades-empty-state");
  const tradesList = document.getElementById("trades-list");

  const managerChipBtn = document.getElementById("chip-manager-btn");
  const managerChipLabel = document.getElementById("chip-manager-label");
  const seasonChipBtn = document.getElementById("chip-season-btn");
  const seasonChipLabel = document.getElementById("chip-season-label");
  const positionChipBtn = document.getElementById("chip-position-btn");
  const positionChipLabel = document.getElementById("chip-position-label");
  const pickChipBtn = document.getElementById("chip-pick-btn");
  const pickChipLabel = document.getElementById("chip-pick-label");

  const closeAllPopovers = setupChipPopovers();
  populatePickOptions(tradeCards);

  let faabOnly = false;

  function pickMatches(card, pickSeason, pickRound) {
    if (!pickSeason && !pickRound) return true;
    const tokens = (card.dataset.picks || "").trim();
    if (!tokens) return false;
    return tokens.split(" ").some((token) => {
      const [season, round] = token.split(":");
      return (!pickSeason || season === pickSeason) && (!pickRound || round === pickRound);
    });
  }

  function applyFilters() {
    const query = search.value.trim().toLowerCase();
    const manager1 = manager1Select.value;
    const manager2 = manager2Select.value;
    const season = seasonSelect.value;
    const position = positionSelect.value;
    const pickSeason = pickSeasonSelect.value;
    const pickRound = pickRoundSelect.value;

    let visibleCount = 0;
    for (const card of tradeCards) {
      const managers = (card.dataset.managers || "").split(",").filter(Boolean);
      const positions = (card.dataset.positions || "").split(",").filter(Boolean);

      const matches =
        (!manager1 || managers.includes(manager1)) &&
        (!manager2 || managers.includes(manager2)) &&
        (!season || card.dataset.season === season) &&
        (!position || positions.includes(position)) &&
        pickMatches(card, pickSeason, pickRound) &&
        (!faabOnly || card.dataset.faab === "true") &&
        (!query || card.textContent.toLowerCase().includes(query));

      card.classList.toggle("hidden", !matches);
      if (matches) visibleCount++;
    }

    for (const block of seasonBlocks) {
      const hasVisible = block.querySelector("[data-trade]:not(.hidden)");
      block.classList.toggle("hidden", !hasVisible);
    }

    const anyFilterActive =
      manager1 || manager2 || season || position || pickSeason || pickRound || faabOnly || query;

    tradesList.classList.toggle("hidden", visibleCount === 0);
    emptyState.classList.toggle("hidden", visibleCount !== 0);
    resultCount.textContent = anyFilterActive
      ? `Showing ${visibleCount} of ${tradeCards.length} trades`
      : "";
    clearBtn.classList.toggle("hidden", !anyFilterActive);

    const managerLabel = manager1 && manager2
      ? `${selectedLabel(manager1Select)} ↔ ${selectedLabel(manager2Select)}`
      : selectedLabel(manager1Select) || selectedLabel(manager2Select);
    managerChipLabel.textContent = managerLabel || "Manager";
    managerChipBtn.dataset.active = String(Boolean(manager1 || manager2));

    seasonChipLabel.textContent = season || "Season";
    seasonChipBtn.dataset.active = String(Boolean(season));

    positionChipLabel.textContent = position || "Position";
    positionChipBtn.dataset.active = String(Boolean(position));

    const pickLabel = [pickSeason, pickRound && `R${pickRound}`].filter(Boolean).join(" · ");
    pickChipLabel.textContent = pickLabel || "Draft Pick";
    pickChipBtn.dataset.active = String(Boolean(pickSeason || pickRound));
  }

  [search].forEach((el) => el.addEventListener("input", applyFilters));
  [manager1Select, manager2Select, seasonSelect, positionSelect, pickSeasonSelect, pickRoundSelect].forEach((el) =>
    el.addEventListener("change", applyFilters)
  );

  faabBtn.addEventListener("click", () => {
    faabOnly = !faabOnly;
    faabBtn.setAttribute("aria-pressed", String(faabOnly));
    faabBtn.dataset.active = String(faabOnly);
    applyFilters();
  });

  clearBtn.addEventListener("click", () => {
    search.value = "";
    manager1Select.value = "";
    manager2Select.value = "";
    seasonSelect.value = "";
    positionSelect.value = "";
    pickSeasonSelect.value = "";
    pickRoundSelect.value = "";
    faabOnly = false;
    faabBtn.setAttribute("aria-pressed", "false");
    faabBtn.dataset.active = "false";
    closeAllPopovers();
    applyFilters();
  });

  applyFilters();
});
