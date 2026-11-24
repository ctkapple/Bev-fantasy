import { getNflPlayers } from "./sleeper-client.js";
import { fetchTradeDraft, fetchTradeLeague, fetchTradeTransactions, processTradeSeason } from "./trade-feed.mjs";
import { mergeTradeSeason, renderTradeCards } from "./trade-view.mjs";

const checkedTime = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
});
const normalize = value => value.toLowerCase().replace(/[’‘]/g, "'");
const tokens = value => (value || "").split(/\s+/).filter(Boolean);
const distinct = values => [...new Set(values)];
const data = id => JSON.parse(document.getElementById(id).textContent);

function setOptions(select, placeholder, values) {
  const selected = select.value;
  select.replaceChildren(new Option(placeholder, ""), ...values.map(([value, label]) => new Option(label, value)));
  select.value = values.some(([value]) => String(value) === selected) ? selected : "";
}

function setupFilters(form, list) {
  const count = document.getElementById("trade-count");
  const empty = document.getElementById("trade-empty");
  const clear = document.getElementById("trade-clear");
  const more = document.getElementById("trade-more");
  const extra = document.getElementById("trade-extra");
  let groups = [];

  function apply() {
    const { query, season, manager, secondManager, position, pickYear, pickRound, faab } = Object.fromEntries(new FormData(form));
    const words = tokens(normalize(query));
    const active = words.length || season || manager || secondManager || position || pickYear || pickRound || faab;
    let shown = 0;
    let total = 0;

    for (const group of groups) {
      let visible = 0;
      for (const card of group.cards) {
        const matchesPick = !pickYear && !pickRound || card.picks.some(([year, round]) =>
          (!pickYear || year === pickYear) && (!pickRound || round === pickRound));
        const matches = (!season || season === group.season) && (!manager || card.managers.has(manager)) &&
          (!secondManager || card.managers.has(secondManager)) && (!position || card.positions.includes(position)) &&
          matchesPick && (!faab || card.faab) && words.every(word => card.search.includes(word));
        card.element.hidden = !matches;
        visible += Number(matches);
      }
      group.element.hidden = visible === 0;
      shown += visible;
      total += group.cards.length;
    }

    clear.hidden = !active;
    count.textContent = active ? `Showing ${shown} of ${total} trades` : `${total} ${total === 1 ? "trade" : "trades"}`;
    empty.hidden = shown > 0;
    empty.textContent = active ? "No trades match your filters." : "No completed trades yet.";
  }

  function readCards() {
    const managers = new Map();
    groups = [...list.querySelectorAll("[data-trade-season]")].map(element => ({
      element,
      season: element.dataset.tradeSeason,
      cards: [...element.querySelectorAll("[data-trade]")].map(element => {
        const managerIds = [...element.querySelectorAll("[data-manager-id]")].map(side => {
          const { managerId, managerName } = side.dataset;
          if (!managers.has(managerId)) managers.set(managerId, managerName);
          return managerId;
        });
        return {
          element, managers: new Set(managerIds), search: normalize(element.textContent),
          positions: tokens(element.dataset.positions), picks: tokens(element.dataset.picks).map(pick => pick.split(":")),
          faab: element.dataset.faab === "true",
        };
      }),
    }));

    const cards = groups.flatMap(group => group.cards);
    const picks = cards.flatMap(card => card.picks);
    const managerOptions = [...managers].sort(([, a], [, b]) => a.localeCompare(b));
    const labeled = values => values.map(value => [value, value]);
    const fields = form.elements;
    setOptions(fields.season, "All seasons", labeled(groups.map(group => group.season)));
    setOptions(fields.manager, "Any manager", managerOptions);
    setOptions(fields.secondManager, "Any manager", managerOptions);
    setOptions(fields.position, "Any position", labeled(distinct(cards.flatMap(card => card.positions)).sort()));
    setOptions(fields.pickYear, "Any year", labeled(distinct(picks.map(([year]) => year)).sort((a, b) => b - a)));
    setOptions(fields.pickRound, "Any round", distinct(picks.map(([, round]) => round)).sort((a, b) => a - b).map(round => [round, `Round ${round}`]));
    apply();
  }

  function reset(season = "") {
    for (const field of form.elements) {
      if (field.type === "checkbox") field.checked = false;
      else if (field.name) field.value = "";
    }
    form.elements.season.value = season;
    apply();
  }

  form.addEventListener("input", apply);
  form.addEventListener("submit", event => event.preventDefault());
  form.addEventListener("reset", event => {
    event.preventDefault();
    reset();
  });
  more.addEventListener("click", () => {
    extra.hidden = !extra.hidden;
    more.setAttribute("aria-expanded", String(!extra.hidden));
  });
  form.hidden = false;
  readCards();

  return { readCards, reset };
}

function setupTradeLog() {
  const config = data("trade-league-config");
  let feed = data("trade-snapshot");
  const form = document.getElementById("trade-filters");
  const list = document.getElementById("trade-list");
  const status = document.getElementById("trade-live-status");
  const filters = setupFilters(form, list);
  let markup = renderTradeCards(feed);

  function linkedTrade() {
    const id = location.hash.slice(1);
    const card = id.startsWith("trade-") && document.getElementById(id);
    return card && list.contains(card) ? card : null;
  }

  function openLinkedTrade() {
    const target = linkedTrade();
    list.querySelector(".trade-card.is-target")?.classList.remove("is-target");
    if (!target) return;
    if (target.hidden) {
      filters.reset(target.closest("[data-trade-season]").dataset.tradeSeason);
    }
    target.classList.add("is-target");
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  }

  async function playerData(transactions) {
    const known = {};
    for (const season of feed.seasons) {
      for (const trade of season.trades) {
        for (const piece of Object.values(trade.pieces).flat()) {
          if (piece.type === "player" && piece.name !== "Unknown Player") {
            known[piece.playerId] = { first_name: piece.name, position: piece.position };
          }
        }
      }
    }
    const addedPlayers = Object.values(transactions).flatMap(rows => rows.flatMap(row => Object.keys(row.adds || {})));
    if (addedPlayers.every(id => known[id])) return known;
    return getNflPlayers().catch(error => {
      console.warn("[trades] Could not resolve new players from Sleeper:", error);
      return known;
    });
  }

  async function loadCurrentTrades() {
    try {
      const [{ league, users, rosters }, transactions] = await Promise.all([
        fetchTradeLeague(config.currentLeagueId), fetchTradeTransactions(config.currentLeagueId),
      ]);
      const savedDraft = feed.drafts[league.season];
      const draft = savedDraft?.complete && savedDraft.draftId === league.draft_id ? savedDraft :
        await fetchTradeDraft(league).catch(error => {
          console.warn("[trades] Could not refresh draft results:", error);
          return savedDraft;
        });
      const live = processTradeSeason(config, league, users, rosters, transactions, await playerData(transactions));
      feed = {
        checkedAt: Date.now(),
        seasons: mergeTradeSeason(feed.seasons, live),
        drafts: { ...feed.drafts, [league.season]: draft },
      };
      const nextMarkup = renderTradeCards(feed);
      if (nextMarkup !== markup) {
        const hadTarget = linkedTrade();
        const focused = document.activeElement?.closest("[data-trade]");
        const focusedHref = document.activeElement?.getAttribute("href");
        list.innerHTML = nextMarkup;
        markup = nextMarkup;
        filters.readCards();
        if (!hadTarget && linkedTrade()) openLinkedTrade();
        else if (hadTarget?.classList.contains("is-target")) linkedTrade()?.classList.add("is-target");
        if (focused) {
          const card = document.getElementById(focused.id);
          const link = [...(card?.querySelectorAll("a") || [])].find(anchor => anchor.getAttribute("href") === focusedHref);
          (link || card)?.focus({ preventScroll: true });
        }
      }
      status.textContent = `Sleeper checked ${checkedTime.format(feed.checkedAt)}`;
      status.dataset.live = "true";
    } catch (error) {
      console.warn("[trades] Could not refresh current trades:", error);
      status.textContent = feed.checkedAt ? `Sleeper unavailable · last checked ${checkedTime.format(feed.checkedAt)}` : "Sleeper unavailable · showing saved trades";
      status.dataset.live = "false";
    }
  }

  list.addEventListener("click", event => {
    const link = event.target.closest(".trade-next");
    if (link?.hash === location.hash && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      openLinkedTrade();
    }
  });
  window.addEventListener("hashchange", openLinkedTrade);
  if (linkedTrade()) openLinkedTrade();
  status.hidden = false;
  status.textContent = "Checking Sleeper…";
  loadCurrentTrades();
}

document.addEventListener("DOMContentLoaded", setupTradeLog);
