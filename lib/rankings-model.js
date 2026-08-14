// Rankings tab ("the standings desk") view model.
//
// The page is three sections, all built from one pass over the league's
// aggregate: the Rafters (a banner rail of every trophy, plaque and toilet
// seat), the Climb (a bump chart of where everyone finished, season by season)
// and the Table (an all-time standings blotter).
//
// This module is imported from TWO places and must stay environment-neutral —
// no node builtins, no DOM:
//
//   .eleventy.js          -> build time, over the frozen aggregates.json
//   src/scripts/dashboard.js -> in the browser, over the live-merged aggregate
//
// That is deliberate. The old dashboard.js kept its own copy of the standings
// markup and a *different*, lesser copy of the trophy case, so mid-season the
// page silently lost its Toilet King block and every colored ring. Building the
// model here and the markup in lib/rankings-markup.js means one implementation
// and two callers, and the live season looks exactly like the frozen one.

import { monotonePath } from "./chart-path.js";
import { FRANCHISE_COLORS } from "../src/scripts/manager-colors.js";

// Anyone the person registry has never heard of — an orphaned Sleeper account,
// a co-owner who never got added — draws in neutral slate rather than
// borrowing someone else's identity color.
const FALLBACK = { chip: "#64748b", line: "#94a3b8" };

/**
 * "What color is this league's franchise?" resolved by display name.
 *
 * The unit on this page is a *franchise* (one row in the standings), not a
 * person, so this matches the AP Poll's unit rather than the Earnings tab's.
 * Solo managers therefore land on their poll hex either way — PERSON_COLORS
 * leaves those untouched. The two co-owned SB3 franchises are the only place
 * the two disagree, and there the franchise's own hex is the honest answer for
 * a single row; the first owner's tuned LINE_COLORS stroke is kept for the
 * chart, since the raw franchise hexes are the ones flagged as unreadable at
 * 2px on this background (see manager-colors.js).
 */
function colorsForLeague(slug, people) {
  const byName = new Map();
  for (const person of Object.values(people || {})) {
    const identity = person.identities?.[slug];
    if (!identity) continue;
    const name = typeof identity === "string" ? identity : identity.name;
    const existing = byName.get(name);
    if (existing) {
      existing.chip = FRANCHISE_COLORS[name] || existing.chip;
      // A second claimant means this is a co-owned franchise, so the first
      // owner's personal ticker would mislabel the pair — fall back to initials.
      existing.ticker = null;
      continue;
    }
    byName.set(name, { chip: person.color, line: person.lineColor, ticker: person.ticker });
  }
  return byName;
}

// Short chart label. A manager the registry knows gets their Earnings ticker,
// so the same person reads the same on both pages; a co-owned franchise or an
// unknown account falls back to initials.
function initials(name) {
  if (name.includes("&")) {
    return name
      .split("&")
      .map((part) => part.trim()[0] || "")
      .join("&")
      .toUpperCase();
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 4).toUpperCase();
}

// --- Climb geometry --------------------------------------------------------
// A fixed-width viewBox scaled by CSS, like the equity curve. Rank 1 sits at
// the top and every rank gets its own row, so vertical distance is literally
// "places gained".
const WIDTH = 900;
const ROW_GAP = 24;
const PLOT_LEFT = 54;
const RIGHT_PAD = 84; // room for the end label
const PLOT_TOP = 30;
const BOTTOM_PAD = 48; // room for the season axis

function buildClimb(rows, seasons, maxTeams) {
  const plotRight = WIDTH - RIGHT_PAD;
  const height = PLOT_TOP + (maxTeams - 1) * ROW_GAP + BOTTOM_PAD;
  const baselineY = PLOT_TOP + (maxTeams - 1) * ROW_GAP;
  const yFor = (rank) => PLOT_TOP + (rank - 1) * ROW_GAP;
  // One season would divide by zero and, more to the point, has nothing to
  // connect — the template gates the whole section out below two.
  const xFor = (i) =>
    seasons.length < 2
      ? (PLOT_LEFT + plotRight) / 2
      : +(PLOT_LEFT + (i * (plotRight - PLOT_LEFT)) / (seasons.length - 1)).toFixed(2);

  const series = rows.map((row) => {
    const points = [];
    seasons.forEach((year, i) => {
      const finish = row.finishes[year];
      if (!finish) return;
      // Y is the *regular-season* standing, so a title year is not necessarily
      // a first-place point — jrwll's 2025 champion finished the regular season
      // sixth. Flagging it here is what stops the curve from appearing to
      // contradict the banner hanging in the Rafters.
      points.push({
        x: xFor(i),
        y: yFor(finish.rank),
        i,
        year,
        rank: finish.rank,
        title: row.titleYears.has(year),
      });
    });

    // A manager who sat a season out gets a broken line rather than one that
    // glides through the gap as if they'd played it.
    const segments = [];
    let run = [];
    for (const point of points) {
      if (run.length && point.i !== run[run.length - 1].i + 1) {
        segments.push(run);
        run = [];
      }
      run.push(point);
    }
    if (run.length) segments.push(run);

    const end = points[points.length - 1];
    return {
      userId: row.userId,
      name: row.name,
      short: row.short,
      avatar: row.avatar,
      chip: row.chip,
      line: row.line,
      rank: row.rank,
      isTop: row.rank <= 3,
      d: segments.map((seg) => monotonePath(seg)).join(" "),
      dots: points,
      end: end ? { x: +(end.x + 11).toFixed(2), y: +(end.y + 4).toFixed(2) } : null,
    };
  });

  return {
    width: WIDTH,
    height,
    plotLeft: PLOT_LEFT,
    plotRight,
    baselineY,
    seasons,
    maxTeams,
    yTicks: Array.from({ length: maxTeams }, (_, i) => ({ rank: i + 1, y: yFor(i + 1) })),
    xTicks: seasons.map((year, i) => ({ label: year, x: xFor(i) })),
    // Ranked best-to-worst, matching the legend rail; the renderer paints them
    // in reverse so the leaders land on top of the pack, as the equity curve does.
    series,
  };
}

// --- Form sparkline --------------------------------------------------------
// One bar per league season; height is the inverted finish, so a tall bar is a
// good year. Seasons the manager wasn't around for draw as a flat gap rather
// than a last-place bar.
const SPARK_H = 20;
const SPARK_MIN = 3; // last place's sliver, and the base of the height scale
const SPARK_BAR = 4;
const SPARK_GAP = 2;

function buildForm(finishes, seasons, maxTeams) {
  const width = seasons.length * SPARK_BAR + Math.max(0, seasons.length - 1) * SPARK_GAP;
  const bars = seasons.map((year, i) => {
    const finish = finishes[year];
    const x = i * (SPARK_BAR + SPARK_GAP);
    if (!finish) return { x, y: SPARK_H - 2, w: SPARK_BAR, h: 2, played: false };
    const teams = finish.totalTeams || maxTeams;
    // Last place still gets a sliver so the bar reads as "played and lost"
    // rather than as an absence. That floor is the *base* of the scale rather
    // than a clamp on top of it — clamping flattened the bottom three finishes
    // in a 14-team league into three identical bars.
    const frac = teams > 1 ? (teams - finish.rank) / (teams - 1) : 1;
    const h = SPARK_MIN + Math.round(frac * (SPARK_H - SPARK_MIN));
    return { x, y: SPARK_H - h, w: SPARK_BAR, h, played: true, rank: finish.rank, year };
  });
  // Sorting the Form column should mean "who is hot right now", so it sorts on
  // the most recent season actually played, normalized the same way the bars
  // are (1 = won the league that year, 0 = finished last).
  const lastPlayed = [...bars].reverse().find((b) => b.played);
  const recentForm = lastPlayed
    ? +((lastPlayed.h - SPARK_MIN) / (SPARK_H - SPARK_MIN)).toFixed(3)
    : -1;
  return { w: Math.max(width, SPARK_BAR), h: SPARK_H, bars, recentForm };
}

// --- Rafters ---------------------------------------------------------------
// Every banner on the wall, newest first. Champions, runner-ups and Toilet
// Kings share one rail and are told apart by color and label, rather than
// living in three stacked lists the way the old trophy case did.
const BANNER_ORDER = { champion: 0, runnerUp: 1, toilet: 2 };

function buildRafters(league, aggregate, colorFor) {
  const banners = [];
  const push = (kind, label, name, avatar, year) => {
    const color = colorFor(name);
    banners.push({ kind, label, name, avatar, year: String(year), chip: color.chip });
  };

  for (const champ of aggregate.trophyCase?.champions || []) {
    for (const year of champ.years) push("champion", "Champion", champ.displayName, champ.avatar, year);
  }
  for (const runnerUp of aggregate.trophyCase?.runnerUps || []) {
    for (const year of runnerUp.years) push("runnerUp", "Runner-Up", runnerUp.displayName, runnerUp.avatar, year);
  }
  // Hand-curated in league config — Sleeper has no notion of a Toilet King.
  const managersByName = new Map(
    Object.values(aggregate.managers || {}).map((m) => [m.displayName, m])
  );
  for (const king of league.toiletKings || []) {
    const manager = managersByName.get(king.manager);
    if (manager) push("toilet", "Toilet King", manager.displayName, manager.avatar, king.year);
  }

  banners.sort(
    (a, b) => Number(b.year) - Number(a.year) || BANNER_ORDER[a.kind] - BANNER_ORDER[b.kind]
  );
  return banners;
}

/**
 * @param {object} league  the league config (slug, name, toiletKings, ...)
 * @param {object} aggregate  AggregateData — frozen at build time, live-merged in the browser
 * @param {object} people  the canonical person registry (lib/people.js)
 * @returns {object|null} null when the league has no completed season yet
 */
export function buildRankingsView(league, aggregate, people) {
  if (!aggregate || !(aggregate.standings || []).length) return null;

  const palette = colorsForLeague(league.slug, people);
  const colorFor = (name) => palette.get(name) || FALLBACK;
  const managers = aggregate.managers || {};

  // The season axis is the union of every manager's yearly finishes rather
  // than aggregate.seasons, so a league whose early years predate the current
  // roster still plots them.
  const seasonSet = new Set();
  let maxTeams = 0;
  for (const manager of Object.values(managers)) {
    for (const standing of manager.yearlyStandings || []) {
      seasonSet.add(String(standing.year));
      maxTeams = Math.max(maxTeams, standing.totalTeams || 0);
    }
  }
  const seasons = [...seasonSet].sort((a, b) => Number(a) - Number(b));
  maxTeams = Math.max(maxTeams, aggregate.standings.length, 1);

  const winPcts = aggregate.standings.map((s) => s.winPct);
  const lowPct = Math.min(...winPcts);
  const highPct = Math.max(...winPcts);

  const rows = aggregate.standings.map((standing) => {
    const manager = managers[standing.userId] || {};
    const color = colorFor(standing.displayName);
    const finishes = {};
    for (const entry of manager.yearlyStandings || []) {
      finishes[String(entry.year)] = { rank: entry.rank, totalTeams: entry.totalTeams };
    }
    const played = Object.values(finishes);
    const bestRank = played.length ? Math.min(...played.map((f) => f.rank)) : null;
    const bestYear = bestRank
      ? Object.keys(finishes).find((year) => finishes[year].rank === bestRank)
      : null;
    const diff = standing.pf - standing.pa;
    const titleYears = new Set((manager.championshipYears || []).map(String));
    const titles = titleYears.size;

    return {
      userId: standing.userId,
      rank: standing.rank,
      name: standing.displayName,
      avatar: standing.avatar,
      short: color.ticker || initials(standing.displayName),
      chip: color.chip || FALLBACK.chip,
      line: color.line || FALLBACK.line,
      isChamp: standing.userId === aggregate.reigningChampionId,
      wins: standing.wins,
      losses: standing.losses,
      ties: standing.ties,
      recordText: `${standing.wins}-${standing.losses}${standing.ties ? "-" + standing.ties : ""}`,
      winPct: standing.winPct,
      winPctText: (standing.winPct * 100).toFixed(1) + "%",
      // Shading is spread across the league's *actual* spread rather than 0-100%,
      // so a tight league still shows a gradient instead of eleven identical cells.
      heat: highPct > lowPct ? +((standing.winPct - lowPct) / (highPct - lowPct)).toFixed(3) : 0,
      pf: standing.pf,
      pa: standing.pa,
      pfText: standing.pf.toFixed(2),
      paText: standing.pa.toFixed(2),
      diff,
      diffText: (diff >= 0 ? "+" : "−") + Math.abs(diff).toFixed(2),
      seasons: played.length,
      titles,
      titleYears,
      runnerUps: (manager.runnerUpYears || []).length,
      bestRank,
      bestText: bestRank ? `${ordinal(bestRank)} · ${bestYear}` : "—",
      finishes,
      form: buildForm(finishes, seasons, maxTeams),
    };
  });

  return {
    seasons,
    maxTeams,
    rows,
    rafters: buildRafters(league, aggregate, colorFor),
    climb: buildClimb(rows, seasons, maxTeams),
    // The chart needs at least two seasons to be a chart; SB3's single frozen
    // season would render one column of dots and no line.
    hasClimb: seasons.length >= 2,
    throughSeason: aggregate.throughSeason ? String(aggregate.throughSeason) : null,
  };
}

export function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return n + "th";
  return n + (["th", "st", "nd", "rd"][n % 10] || "th");
}
