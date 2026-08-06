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

// A group of `[data-value]` buttons that behaves like a single-select radio
// group: click a button to select it (deselecting any other in the group),
// click the selected one again to clear it. Powers every dropdown-turned-
// clickable-list in the filter bar (Season/Position pills, Manager and
// Draft Pick option lists) with one shared implementation instead of one
// per filter. Current value lives on the container's `data-selected`
// attribute so callers can read it the same way they'd read `select.value`.
function createOptionGroup(container, onChange) {
  container.dataset.selected = "";

  function setActive(value) {
    container.dataset.selected = value;
    for (const btn of container.querySelectorAll("[data-value]")) {
      btn.dataset.active = String(btn.dataset.value === value);
    }
  }

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (!btn || !container.contains(btn)) return;
    setActive(container.dataset.selected === btn.dataset.value ? "" : btn.dataset.value);
    onChange();
  });

  return {
    get value() {
      return container.dataset.selected;
    },
    get label() {
      return container.querySelector('[data-active="true"]')?.textContent ?? "";
    },
    clear() {
      setActive("");
    },
  };
}

// Fills the pick-season/pick-round option lists from whatever "season:round"
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

  const seasonList = document.getElementById("pick-season-list");
  for (const season of [...seasons].sort((a, b) => b - a)) {
    seasonList.insertAdjacentHTML("beforeend", `<button type="button" class="filter-list-item" data-value="${season}" data-active="false">${season}</button>`);
  }
  const roundList = document.getElementById("pick-round-list");
  for (const round of [...rounds].sort((a, b) => a - b)) {
    roundList.insertAdjacentHTML("beforeend", `<button type="button" class="filter-list-item" data-value="${round}" data-active="false">Round ${round}</button>`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const filterBar = document.getElementById("trades-filter-bar");
  const tradeCards = [...document.querySelectorAll("[data-trade]")];
  if (!filterBar || tradeCards.length === 0) return;

  const seasonBlocks = [...document.querySelectorAll("[data-season-block]")];
  const search = document.getElementById("trades-search");
  const faabBtn = document.getElementById("chip-faab-btn");
  const clearBtn = document.getElementById("clear-filters-btn");
  const resultCount = document.getElementById("trades-result-count");
  const emptyState = document.getElementById("trades-empty-state");
  const tradesList = document.getElementById("trades-list");

  const managerChipBtn = document.getElementById("chip-manager-btn");
  const managerChipLabel = document.getElementById("chip-manager-label");
  const pickChipBtn = document.getElementById("chip-pick-btn");
  const pickChipLabel = document.getElementById("chip-pick-label");

  const closeAllPopovers = setupChipPopovers();
  populatePickOptions(tradeCards);

  let faabOnly = false;
  const applyFiltersRef = () => applyFilters();

  const seasonGroup = createOptionGroup(document.getElementById("season-group"), applyFiltersRef);
  const positionGroup = createOptionGroup(document.getElementById("position-group"), applyFiltersRef);
  const manager1Group = createOptionGroup(document.getElementById("manager1-list"), applyFiltersRef);
  const manager2Group = createOptionGroup(document.getElementById("manager2-list"), applyFiltersRef);
  const pickSeasonGroup = createOptionGroup(document.getElementById("pick-season-list"), applyFiltersRef);
  const pickRoundGroup = createOptionGroup(document.getElementById("pick-round-list"), applyFiltersRef);

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
    const manager1 = manager1Group.value;
    const manager2 = manager2Group.value;
    const season = seasonGroup.value;
    const position = positionGroup.value;
    const pickSeason = pickSeasonGroup.value;
    const pickRound = pickRoundGroup.value;

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
      ? `${manager1Group.label} ↔ ${manager2Group.label}`
      : manager1Group.label || manager2Group.label;
    managerChipLabel.textContent = managerLabel || "Manager";
    managerChipBtn.dataset.active = String(Boolean(manager1 || manager2));

    const pickLabel = [pickSeason, pickRound && `R${pickRound}`].filter(Boolean).join(" · ");
    pickChipLabel.textContent = pickLabel || "Draft Pick";
    pickChipBtn.dataset.active = String(Boolean(pickSeason || pickRound));
  }

  search.addEventListener("input", applyFilters);

  faabBtn.addEventListener("click", () => {
    faabOnly = !faabOnly;
    faabBtn.setAttribute("aria-pressed", String(faabOnly));
    faabBtn.dataset.active = String(faabOnly);
    applyFilters();
  });

  clearBtn.addEventListener("click", () => {
    search.value = "";
    seasonGroup.clear();
    positionGroup.clear();
    manager1Group.clear();
    manager2Group.clear();
    pickSeasonGroup.clear();
    pickRoundGroup.clear();
    faabOnly = false;
    faabBtn.setAttribute("aria-pressed", "false");
    faabBtn.dataset.active = "false";
    closeAllPopovers();
    applyFilters();
  });

  applyFilters();
});
