import { FRANCHISE_COLORS, PERSON_COLORS } from "./manager-colors.js";
import { pickKey } from "./trade-feed.mjs";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/New_York" });
const textEntities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => textEntities[character]);
const tradeAnchor = tradeId => `trade-${tradeId}`;
const compareTrades = (a, b) => (a.date || 0) - (b.date || 0) || String(a.tradeId).localeCompare(String(b.tradeId));
const piecesIn = trade => Object.values(trade.pieces || {}).flat();
const rosterName = (season, rosterId) => season?.managers[season.rosters[rosterId]]?.displayName;
const resultArrow = '<span class="trade-result-arrow" aria-hidden="true">→</span>';

export function mergeTradeSeason(seasons, live) {
  const saved = seasons.find(season => season.leagueId === live.leagueId);
  const trades = new Map((saved?.trades || []).map(trade => [trade.tradeId, trade]));
  for (const trade of live.trades) trades.set(trade.tradeId, trade);
  return [...seasons.filter(season => season.leagueId !== live.leagueId), {
    ...live, trades: [...trades.values()], managers: { ...saved?.managers, ...live.managers },
  }];
}

function indexPickMoves(seasons) {
  const movesByPick = new Map();
  const trades = seasons.flatMap(season => season.trades.map(trade => ({ season, trade })));
  trades.sort((a, b) => compareTrades(a.trade, b.trade));
  for (const { season, trade } of trades) {
    for (const piece of piecesIn(trade)) {
      if (piece.type !== "pick" || !piece.originalRosterId) continue;
      const key = pickKey(piece.season, piece.round, piece.originalRosterId);
      const moves = movesByPick.get(key) || [];
      moves.push({ season, trade, piece });
      movesByPick.set(key, moves);
    }
  }

  const nextTrades = new Map();
  for (const moves of movesByPick.values()) {
    for (let i = 1; i < moves.length; i++) {
      const previous = moves[i - 1];
      const next = moves[i];
      // A matching origin alone does not prove who traded it next. Sleeper
      // may have an unrecorded commissioner move between two transactions.
      if (previous.trade.tradeId !== next.trade.tradeId && previous.piece.ownerId != null && next.piece.ownerId != null &&
          String(previous.piece.ownerId) === String(next.piece.previousOwnerId)) {
        nextTrades.set(previous.piece, next);
      }
    }
  }
  return nextTrades;
}

function managerStyle(id, displayName) {
  const personId = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const known = FRANCHISE_COLORS[displayName] || PERSON_COLORS[personId];
  if (typeof known === "string") return known;
  const seed = [...id].reduce((hash, character) => (31 * hash + character.charCodeAt(0)) >>> 0, 0);
  return `hsl(${seed % 360} 72% 62%)`;
}

function managerPortrait(manager, name) {
  const avatar = manager?.avatar || "";
  const hasPortrait = /^\/assets\/[^/]|^https:\/\/sleepercdn\.com\/avatars\//i.test(avatar);
  const initials = name.split(/\s+/).filter(part => /\p{L}/u.test(part)).slice(0, 2).map(part => [...part][0]).join("");
  return `<span class="trade-portrait" aria-hidden="true">${hasPortrait
    ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy" decoding="async">`
    : escapeHtml(initials.toLocaleUpperCase())}</span>`;
}

function pieceMarkup(piece, trade, season, managerId, context) {
  if (piece.type === "player") {
    const position = escapeHtml(piece.position || "N/A");
    return `<li><span class="trade-player">${escapeHtml(piece.name)}</span> <span class="trade-position pos-${position}">${position}</span></li>`;
  }
  if (piece.type === "faab") return `<li><span class="trade-faab">$${escapeHtml(piece.amount)} FAAB</span></li>`;
  if (piece.type !== "pick") return "";

  const { drafts, seasonsByYear, nextTrades } = context;
  const draftSeason = seasonsByYear.get(String(piece.season));
  const origin = rosterName(season, piece.originalRosterId) || rosterName(draftSeason, piece.originalRosterId);
  const label = `<span class="trade-pick">${escapeHtml(piece.season)} Round ${escapeHtml(piece.round)} Pick</span>${origin ? ` <span class="trade-origin">via ${escapeHtml(origin)}</span>` : ""}`;
  const next = nextTrades.get(piece);
  if (next) {
    const rosterId = next.piece.ownerId;
    const manager = escapeHtml(rosterName(next.season, rosterId) || `Roster ${rosterId}`);
    const href = escapeHtml(tradeAnchor(next.trade.tradeId));
    return `<li>${label}<div class="trade-outcome">${resultArrow} <a class="trade-next" href="#${href}" aria-label="Traded to ${manager}, view trade">Traded to</a> <strong>${manager}</strong></div></li>`;
  }

  const draft = drafts[piece.season];
  const key = pickKey(piece.season, piece.round, piece.originalRosterId);
  const used = draft?.picks?.[key];
  if (!used || (draft.lastPicked && trade.date > draft.lastPicked)) return `<li>${label}</li>`;

  const draftingManager = draftSeason?.rosters[used.rosterId];
  const draftedBy = draftSeason?.managers[draftingManager]?.displayName;
  const draftingNote = draftedBy && draftingManager !== managerId ? ` <span class="trade-drafted-by">${used.keeper ? "kept" : "drafted"} by ${escapeHtml(draftedBy)}</span>` : "";
  const keeper = used.keeper ? ' <span class="trade-keeper">Keeper</span>' : "";
  return `<li>${label}<div class="trade-outcome">${resultArrow} <strong>${escapeHtml(used.slot)} · ${escapeHtml(used.name)}</strong>${keeper}${draftingNote}</div></li>`;
}

function tradeMarkup(trade, season, context) {
  const id = escapeHtml(tradeAnchor(trade.tradeId));
  const managerIds = Object.keys(trade.pieces);
  const allPieces = piecesIn(trade);
  const positions = [...new Set(allPieces.filter(piece => piece.type === "player").map(piece => piece.position || "N/A"))];
  const picks = [...new Set(allPieces.filter(piece => piece.type === "pick").map(piece => `${piece.season}:${piece.round}`))];
  const faab = allPieces.some(piece => piece.type === "faab");
  const date = trade.date ? new Date(trade.date) : null;
  const dateMarkup = date && !Number.isNaN(date.valueOf()) ? `<time datetime="${date.toISOString()}">${dateFormat.format(date)}</time>` : "Date unavailable";
  const cards = Object.entries(trade.pieces).map(([id, pieces]) => {
    const manager = season.managers[id];
    const name = manager?.displayName || (id.startsWith("roster:") ? `Roster ${id.slice(7)}` : "Unknown manager");
    const list = pieces.length ? `<ul class="trade-assets">${pieces.map(piece => pieceMarkup(piece, trade, season, id, context)).join("")}</ul>` : "";
    return `<section class="trade-side" style="--trade-team:${managerStyle(id, name)}" data-manager-id="${escapeHtml(id)}" data-manager-name="${escapeHtml(name)}">
      <header class="trade-manager">${managerPortrait(manager, name)}<div><h4>${escapeHtml(name)}</h4><span>Received</span></div></header>
      ${list}
    </section>`;
  }).join("");

  return `<article class="trade-card" id="${id}" tabindex="-1" data-trade data-positions="${escapeHtml(positions.join(" "))}" data-picks="${escapeHtml(picks.join(" "))}" data-faab="${faab}">
    <header class="trade-card-top">${dateMarkup}${managerIds.length > 2 ? ` <span>${managerIds.length}-team trade</span>` : ""}</header>
    <div class="trade-sides${managerIds.length > 2 ? " trade-sides-multi" : ""}">${cards}</div>
  </article>`;
}

export function renderTradeCards({ seasons = [], drafts = {} } = {}) {
  const ordered = [...seasons].sort((a, b) => Number(b.season) - Number(a.season));
  const context = { drafts, seasonsByYear: new Map(ordered.map(season => [String(season.season), season])), nextTrades: indexPickMoves(ordered) };
  return ordered.filter(season => season.trades.length).map(season => {
    const year = escapeHtml(season.season);
    const cards = [...season.trades].sort((a, b) => compareTrades(b, a)).map(trade => tradeMarkup(trade, season, context)).join("");
    return `<section class="trade-season" data-trade-season="${year}"><h3>${year} Season</h3><div class="trade-cards">${cards}</div></section>`;
  }).join("");
}
