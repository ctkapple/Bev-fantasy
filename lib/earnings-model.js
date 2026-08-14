// Earnings tab ("the exchange") view model. Lifted out of .eleventy.js when the
// cross-league combine landed — it had grown to two thirds of the config file.
//
// Every league's ledger is hand-entered and keyed by whatever that league calls
// the entity: JRWLL and BestBall by person, SB3 by franchise (two of which are
// co-owned). src/_data/people.js reconciles those into one canonical person per
// human, so this module can express both views the page offers:
//
//   view.league — only this league's money
//   view.all    — every league's money, summed per person
//
// Both are computed here, at build time. The page renders `view.league` as
// static SVG exactly as before and ships `view.all` as a JSON island; the
// toggle in earnings.js interpolates between the two. That means the geometry
// of the two views has to be *structurally identical* — same number of path
// commands, dots, and rows — or there is nothing to interpolate. See
// `sampleSeries` for how a one-season league and a five-season one are made to
// agree on that.

export const money = (n) =>
  "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const moneyRound = (n) => "$" + Math.round(Number(n)).toLocaleString("en-US");

// Deterministic per-string PRNG (mulberry32 seeded by an FNV-1a hash) so the
// cosmetic wiggle below is stable across rebuilds - same manager/segment
// always wiggles the same way instead of the chart re-randomizing on every
// `npx eleventy` run.
function seededRandom(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let t = h >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Cosmetic-only "market texture": a real yearly point-to-point segment reads
// as a flat teleport rather than a trading day. We insert waypoints between
// each pair of *real* points, nudged by a seeded random offset - but every
// waypoint's value is clamped to [v0, v1], the segment's own real endpoints.
// Cumulative winnings never actually decrease (see monotonePath below), so
// the true value at any moment in that segment is provably within that
// range; the wiggle can therefore never draw a total below where it really
// was. This only changes the path fed to monotonePath - the real per-year
// points (dots, end labels, hover) are untouched.
const WIGGLE_STEPS = 3;
const WIGGLE_AMPLITUDE = 0.4;
function wigglePoints(points, seedBase, yFor) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const rand = seededRandom(`${seedBase}:${p0.year}-${p1.year}`);
    const lo = Math.min(p0.value, p1.value);
    const hi = Math.max(p0.value, p1.value);
    for (let s = 1; s <= WIGGLE_STEPS; s++) {
      const f = s / (WIGGLE_STEPS + 1);
      const base = p0.value + (p1.value - p0.value) * f;
      const amplitude = (hi - lo) * WIGGLE_AMPLITUDE;
      const value = Math.min(hi, Math.max(lo, base + (rand() - 0.5) * amplitude));
      out.push({ x: +(p0.x + (p1.x - p0.x) * f).toFixed(2), y: +yFor(value).toFixed(2), value });
    }
    out.push(p1);
  }
  return out;
}

// Cumulative winnings only ever go up (a $0 year adds nothing, ledger
// entries are never negative), so the curve connecting them must never
// imply a dip. Monotone cubic Hermite interpolation (Fritsch-Carlson)
// guarantees that: unlike a Catmull-Rom spline it can't overshoot past a
// sharp jump and bow below the flat run that preceded it.
//
// Zero-width segments are legal here and are *load-bearing*: sampleSeries pads
// every series out to the same length by repeating a point, which is what lets
// the two views' paths interpolate command-for-command. A repeated point has
// dx === 0, so its slope is forced to 0 rather than dividing by zero, and its
// two control points collapse onto the point itself — a valid, invisible curve
// command that holds the series' place in the command list.
function monotonePath(points) {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0].x} ${points[0].y}`;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    slope.push(dx[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / dx[i]);
  }
  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const same = slope[i - 1] !== 0 && slope[i] !== 0 && (slope[i - 1] < 0) === (slope[i] < 0);
    m[i] = same ? (slope[i - 1] + slope[i]) / 2 : 0;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) continue; // m[i] and m[i + 1] are already 0 here by construction
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const tau = 3 / h;
      m[i] = tau * a * slope[i];
      m[i + 1] = tau * b * slope[i];
    }
  }
  let d = `M${+xs[0].toFixed(2)} ${+ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const x1 = +(xs[i] + dx[i] / 3).toFixed(2);
    const y1 = +(ys[i] + (m[i] * dx[i]) / 3).toFixed(2);
    const x2 = +(xs[i + 1] - dx[i] / 3).toFixed(2);
    const y2 = +(ys[i + 1] - (m[i + 1] * dx[i]) / 3).toFixed(2);
    d += ` C${x1} ${y1} ${x2} ${y2} ${+xs[i + 1].toFixed(2)} ${+ys[i + 1].toFixed(2)}`;
  }
  return d;
}

// Rewrite every y coordinate in a path to a single value, keeping the x
// coordinates and command structure. Used to give a manager who has no money in
// *this* league a "from" shape for the toggle: their combined curve, flattened
// onto the baseline, so it grows up out of the axis instead of appearing.
function flattenPath(d, y) {
  let i = 0;
  return d.replace(/-?\d+(\.\d+)?/g, (n) => (i++ % 2 === 0 ? n : String(y)));
}

// --- Ledger -> rows --------------------------------------------------------
// One row per person, merging however many leagues are in scope.
//
// Seasons played comes from each manager's yearlyStandings rather than from
// the ledger, because a $0 ledger year is ambiguous — it means either "won
// nothing" or "wasn't in the league yet" (JRWLL ran 10 teams in 2021, 12
// after; BestBall ran 12 until 2025's 14). Only the former should count
// against a manager's cost basis, and only the latter should be left out of
// their equity curve.
function collectRows(people, leaguesBySlug, leagueStats, slugs) {
  const rows = [];

  for (const person of Object.values(people)) {
    const parts = [];

    for (const slug of slugs) {
      const cfg = leaguesBySlug[slug];
      const ledger = cfg?.earnings?.ledger;
      const identity = person.identities?.[slug];
      if (!ledger || !identity) continue;

      const name = typeof identity === "string" ? identity : identity.name;
      const share = typeof identity === "string" ? 1 : identity.share ?? 1;
      const entry = ledger[name];
      if (!entry) continue;

      const byYear = entry.byYear || {};
      const manager = Object.values(leagueStats[slug]?.aggregates?.managers || {}).find(
        (m) => m.displayName === name
      );
      const standings = manager?.yearlyStandings || [];
      const played = new Set(
        standings.length ? standings.map((s) => String(s.year)) : Object.keys(byYear)
      );
      const buyIn = Number(cfg.earnings.buyIn) || 0;
      let total = 0;
      for (const y of played) total += (byYear[y] || 0) * share;

      parts.push({
        slug,
        label: cfg.name,
        share,
        byYear,
        played,
        buyIn,
        total,
        paid: played.size * buyIn * share,
        props: (entry.props || 0) * share,
        highs: (entry.highs || 0) * share,
      });
    }

    if (parts.length === 0) continue;

    const played = new Set(parts.flatMap((p) => [...p.played]));
    const byYear = {};
    // Cost basis has to be tracked per year as well as in total, because the
    // market summary reports the size of each season's pot — and in the
    // combined view a single season's pot is three leagues' buy-ins at three
    // different prices, not one head count times one number.
    const paidByYear = {};
    for (const y of played) {
      byYear[y] = parts.reduce(
        (sum, p) => sum + (p.played.has(y) ? (p.byYear[y] || 0) * p.share : 0),
        0
      );
      paidByYear[y] = parts.reduce((sum, p) => sum + (p.played.has(y) ? p.buyIn * p.share : 0), 0);
    }

    rows.push({
      id: person.id,
      name: person.name,
      ticker: person.ticker,
      symbol: person.symbol,
      color: person.color,
      lineColor: person.lineColor,
      avatar: person.avatar,
      byYear,
      played,
      paidByYear,
      paid: parts.reduce((s, p) => s + p.paid, 0),
      props: parts.reduce((s, p) => s + p.props, 0),
      highs: parts.reduce((s, p) => s + p.highs, 0),
      breakdown: parts.map((p) => ({
        slug: p.slug,
        label: p.label,
        share: p.share,
        seasons: p.played.size,
        total: p.total,
        totalText: money(p.total),
        paid: p.paid,
        paidText: money(p.paid),
        netText: (p.total - p.paid >= 0 ? "+" : "−") + money(Math.abs(p.total - p.paid)),
      })),
    });
  }

  return rows;
}

// Pad a series out to one sample per *global* year so both views produce the
// same number of path commands. A year this view doesn't have, or one before
// the manager's first season, collapses onto their first real point: a repeated
// coordinate draws nothing but holds its slot in the command list. That is why
// SB3's single 2025 season can morph into a five-season combined curve at all.
function sampleSeries(row, years, yearIdx, globalYears, xFor) {
  const raw = globalYears.map((year) => {
    const i = yearIdx.get(year);
    if (i === undefined || row.cumulative[i] === null) return null;
    return { x: +xFor(i).toFixed(2), value: row.cumulative[i], year, real: true };
  });

  const first = raw.find(Boolean);
  if (!first) return null;

  const out = [];
  let prev = null;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]) {
      prev = raw[i];
      out.push(raw[i]);
    } else {
      out.push({ ...(prev || first), year: globalYears[i], real: false });
    }
  }
  return out;
}

const CHART = { W: 1000, H: 440, PAD: { l: 62, r: 104, t: 22, b: 46 } };
const SPARK = { w: 78, h: 24, gap: 3 };

function buildMarket(rows, years, globalYears, { buyIn, slugs }) {
  if (rows.length === 0 || years.length === 0) return null;
  const yearIdx = new Map(years.map((y, i) => [y, i]));

  rows.forEach((r) => {
    r.vals = years.map((y) => (r.played.has(y) ? r.byYear[y] || 0 : null));
    let running = 0;
    r.cumulative = years.map((y, i) => {
      if (r.vals[i] === null) return null;
      running += r.vals[i];
      return running;
    });
    r.total = running;
    r.totalText = money(r.total);
    r.totalRoundText = moneyRound(r.total);
    r.paidText = money(r.paid);
    r.net = r.total - r.paid;
    r.netText = (r.net >= 0 ? "+" : "−") + money(Math.abs(r.net));
    r.roi = r.paid ? r.net / r.paid : 0;
    r.roiText = r.paid ? (r.net >= 0 ? "+" : "−") + Math.round(Math.abs(r.roi) * 100) + "%" : "—";
    // The tape's delta is the latest season's *net* — what that year won less
    // what it cost to enter (every league's buy-in, in the combined view). A
    // manager who took $55 out of a $100 season is down $45, and the tape has
    // to say so; showing the gross made losing years look like gains.
    const latest = years[years.length - 1];
    r.change = r.played.has(latest) ? (r.byYear[latest] || 0) - (r.paidByYear[latest] || 0) : 0;
    r.changeText = (r.change > 0 ? "+" : r.change < 0 ? "−" : "") + money(Math.abs(r.change));
    r.seasons = r.played.size;
  });

  // Blotter cells and the per-row mini bar chart. `heat` is a single year's
  // take as a fraction of the biggest year anyone has ever had, so a
  // championship season glows and a $10 high-score week barely registers.
  // Columns span the *global* years so the table keeps its shape across views;
  // a column this view doesn't cover is marked `inView: false` and hidden.
  const bestYear = Math.max(1, ...rows.flatMap((r) => r.vals.map((v) => v || 0)));
  const barW = (SPARK.w - SPARK.gap * (globalYears.length - 1)) / globalYears.length;
  rows.forEach((r) => {
    r.cells = globalYears.map((y) => {
      const i = yearIdx.get(y);
      const v = i === undefined ? null : r.vals[i];
      return {
        year: y,
        inView: i !== undefined,
        played: v !== null,
        value: v === null ? -1 : v,
        text: v === null ? "—" : money(v),
        heat: v === null ? 0 : +(v / bestYear).toFixed(3),
      };
    });
    r.spark = {
      ...SPARK,
      bars: r.cells.map((c, i) => {
        const v = c.played ? c.value : null;
        const h = v === null ? 0 : Math.max(v > 0 ? 2 : 1, (v / bestYear) * SPARK.h);
        return {
          x: +(i * (barW + SPARK.gap)).toFixed(2),
          y: +(SPARK.h - h).toFixed(2),
          w: +barW.toFixed(2),
          h: +h.toFixed(2),
          played: v !== null,
        };
      }),
    };
  });

  const lifetime = [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  lifetime.forEach((r, i) => {
    r.rank = i + 1;
  });

  // --- Equity curve geometry ---------------------------------------------
  const { W, H, PAD } = CHART;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const rawMax = Math.max(1, ...lifetime.map((r) => r.total));
  const step = [10, 25, 50, 100, 200, 250, 500, 1000, 2500, 5000].find((s) => rawMax / s <= 4) || 10000;
  const maxY = Math.ceil(rawMax / step) * step;
  const xFor = (i) => (years.length === 1 ? PAD.l + plotW / 2 : PAD.l + (plotW * i) / (years.length - 1));
  const yFor = (v) => PAD.t + plotH - (v / maxY) * plotH;
  const baselineY = +yFor(0).toFixed(2);

  const series = lifetime
    .map((r) => {
      const samples = sampleSeries(r, years, yearIdx, globalYears, xFor);
      if (!samples) return null;
      const points = samples.map((s) => ({
        x: s.x,
        y: +yFor(s.value).toFixed(2),
        value: s.value,
        year: s.year,
        real: s.real,
      }));
      const d = monotonePath(wigglePoints(points, r.name, yFor));
      const first = points[0];
      const last = points[points.length - 1];
      return {
        ticker: r.ticker,
        symbol: r.symbol,
        name: r.name,
        avatar: r.avatar,
        rank: r.rank,
        color: r.color,
        line: r.lineColor,
        d,
        areaD: `${d} L${last.x} ${baselineY} L${first.x} ${baselineY} Z`,
        dots: points.map((p) => ({ x: p.x, y: p.y, r: p.real ? 3.5 : 0 })),
        end: { x: last.x, y: last.y },
        totalText: r.totalText,
        totalRoundText: r.totalRoundText,
      };
    })
    .filter(Boolean);

  const chart = {
    width: W,
    height: H,
    baselineY,
    plotLeft: PAD.l,
    plotRight: W - PAD.r,
    plotTop: PAD.t,
    plotHeight: plotH,
    maxY,
    step,
    series,
    yTicks: [...Array(maxY / step + 1)].map((_, i) => ({
      value: i * step,
      label: "$" + (i * step).toLocaleString("en-US"),
      y: +yFor(i * step).toFixed(2),
    })),
    xTicks: globalYears.map((y) => ({
      label: y,
      inView: yearIdx.has(y),
      x: +xFor(yearIdx.has(y) ? yearIdx.get(y) : 0).toFixed(2),
    })),
  };

  // --- Market summary -----------------------------------------------------
  const distributed = rows.reduce((sum, r) => sum + r.total, 0);
  const potByYear = {};
  years.forEach((y) => {
    potByYear[y] = rows.reduce((sum, r) => sum + (r.paidByYear[y] || 0), 0);
  });

  let biggest = { amount: -Infinity };
  rows.forEach((r) =>
    years.forEach((y, i) => {
      if (r.vals[i] !== null && r.vals[i] > biggest.amount) {
        biggest = { amount: r.vals[i], year: y, ticker: r.ticker, symbol: r.symbol, name: r.name };
      }
    })
  );

  const pot = Object.values(potByYear).reduce((a, b) => a + b, 0);
  const maxProps = Math.max(1, ...rows.map((r) => r.props));
  const maxHighs = Math.max(1, ...rows.map((r) => r.highs));
  const withPct = (list, key, max) => list.map((r) => ({ ...r, pct: Math.round((r[key] / max) * 100) }));

  return {
    slugs,
    years,
    globalYears,
    buyIn,
    chart,
    lifetime,
    tape: lifetime,
    holdings: lifetime,
    props: withPct([...rows].sort((a, b) => b.props - a.props), "props", maxProps),
    highs: withPct([...rows].sort((a, b) => b.highs - a.highs), "highs", maxHighs),
    hasProps: rows.some((r) => r.props > 0),
    hasHighs: rows.some((r) => r.highs > 0),
    summary: {
      distributed,
      distributedText: money(distributed),
      pot,
      potText: money(pot),
      undistributedText: money(pot - distributed),
      seasons: years.length,
      latestYear: years[years.length - 1],
      latestPotText: money(potByYear[years[years.length - 1]] || 0),
      leader: lifetime[0],
      biggest: { ...biggest, amountText: money(biggest.amount) },
    },
  };
}

/**
 * Build both views for one league's Earnings page.
 * Returns { league, all, hasAll } — `all` is null when this is the only league
 * with a ledger, in which case the page renders without a toggle.
 */
export function buildEarningsView(league, leagues, leagueStats, people) {
  const leaguesBySlug = Object.fromEntries(leagues.map((l) => [l.slug, l]));
  const ledgerSlugs = leagues.filter((l) => l.earnings?.ledger).map((l) => l.slug);
  if (!leaguesBySlug[league.slug]?.earnings?.ledger) return { league: null, all: null, hasAll: false };

  const yearsFor = (slugs) =>
    [
      ...new Set(
        slugs.flatMap((slug) =>
          Object.values(leaguesBySlug[slug].earnings.ledger).flatMap((e) =>
            Object.keys(e.byYear || {})
          )
        )
      ),
    ].sort();

  const globalYears = yearsFor(ledgerSlugs);

  const build = (slugs) =>
    buildMarket(collectRows(people, leaguesBySlug, leagueStats, slugs), yearsFor(slugs), globalYears, {
      buyIn: leaguesBySlug[slugs[0]].earnings.buyIn,
      slugs,
    });

  const leagueView = build([league.slug]);
  const allView = ledgerSlugs.length > 1 ? build(ledgerSlugs) : null;
  const champTickers = reigningChampTicker(league, leagueStats, people);
  if (!leagueView) return { league: null, all: null, hasAll: false, champTickers };
  if (!allView) return { league: leagueView, all: null, hasAll: false, champTickers };

  mergeAbsent(leagueView, allView);

  return {
    league: leagueView,
    all: allView,
    hasAll: true,
    champTickers,
    grid: gridlines(leagueView, allView),
    xTicks: xTicks(leagueView, allView, globalYears),
    breakdown: Object.fromEntries(allView.lifetime.map((r) => [r.ticker, r.breakdown])),
    data: compact(allView),
  };
}

// The blotter's crown marks whoever holds *this* league's title, so it has to
// resolve the league's own champion id back to a person the rows are keyed by.
function reigningChampTicker(league, leagueStats, people) {
  const aggregates = leagueStats[league.slug]?.aggregates;
  const champ = aggregates?.managers?.[aggregates?.reigningChampionId];
  if (!champ) return [];
  // A list, not one ticker: a co-owned franchise wins as a franchise, so both
  // of its owners wear the crown.
  return Object.values(people)
    .filter((p) => {
      const identity = p.identities?.[league.slug];
      const name = typeof identity === "string" ? identity : identity?.name;
      return name === champ.displayName;
    })
    .map((p) => p.ticker);
}

// The y axis has to be able to animate between two different scales, so both
// views' tick values are rendered up front as one set of gridlines. A tick that
// only one view uses is drawn at both positions and fades in or out with the
// toggle; a tick both views share just slides.
function yOf(market, value) {
  return +(market.chart.plotTop + market.chart.plotHeight * (1 - value / market.chart.maxY)).toFixed(2);
}

function gridlines(leagueView, allView) {
  const values = [
    ...new Set([...leagueView.chart.yTicks, ...allView.chart.yTicks].map((t) => t.value)),
  ].sort((a, b) => a - b);
  return values.map((value) => ({
    value,
    label: "$" + value.toLocaleString("en-US"),
    yLeague: yOf(leagueView, value),
    yAll: yOf(allView, value),
    inLeague: value <= leagueView.chart.maxY,
    inAll: value <= allView.chart.maxY,
  }));
}

function xTicks(leagueView, allView, globalYears) {
  const xIn = (market, year) => market.chart.xTicks.find((t) => t.label === year);
  return globalYears.map((year) => {
    const l = xIn(leagueView, year);
    const a = xIn(allView, year);
    return {
      label: year,
      xLeague: l ? l.x : a.x,
      xAll: a ? a.x : l.x,
      inLeague: Boolean(l && l.inView),
      inAll: Boolean(a && a.inView),
    };
  });
}

// Everything the toggle needs to animate toward, and nothing else — the full
// market model carries Sets and duplicated row objects that would triple the
// size of the JSON island for no benefit.
function compact(market) {
  return {
    years: market.years,
    leader: market.summary.leader.ticker,
    plot: {
      maxY: market.chart.maxY,
      top: market.chart.plotTop,
      height: market.chart.plotHeight,
      baselineY: market.chart.baselineY,
    },
    series: Object.fromEntries(
      market.chart.series.map((s) => [s.ticker, { d: s.d, dots: s.dots, end: s.end, rank: s.rank }])
    ),
    rows: Object.fromEntries(
      market.lifetime.map((r) => [
        r.ticker,
        {
          rank: r.rank,
          total: r.total,
          totalText: r.totalText,
          totalRoundText: r.totalRoundText,
          net: r.net,
          netText: r.netText,
          roi: r.roi,
          roiText: r.roiText,
          change: r.change,
          changeText: r.changeText,
          seasons: r.seasons,
          props: r.props,
          highs: r.highs,
          propsPct: market.props.find((p) => p.ticker === r.ticker)?.pct || 0,
          highsPct: market.highs.find((p) => p.ticker === r.ticker)?.pct || 0,
          cells: r.cells.map((c) => ({
            text: c.text,
            value: c.value,
            heat: c.heat,
            played: c.played,
            inView: c.inView,
          })),
          spark: r.spark.bars.map((b) => ({ y: b.y, h: b.h, played: b.played })),
        },
      ])
    ),
    summary: {
      distributedText: market.summary.distributedText,
      potText: market.summary.potText,
      seasons: market.summary.seasons,
      latestYear: market.summary.latestYear,
      latestPotText: market.summary.latestPotText,
      leaderSymbol: market.summary.leader.symbol,
      leaderName: market.summary.leader.name,
      leaderAvatar: market.summary.leader.avatar,
      leaderColor: market.summary.leader.color,
      leaderTotalText: market.summary.leader.totalText,
      biggestAmountText: market.summary.biggest.amountText,
      biggestSymbol: market.summary.biggest.symbol,
      biggestYear: market.summary.biggest.year,
    },
  };
}

// A manager with money in another league but none in this one has no row, no
// chip and no line in the league view — but the toggle needs something to
// animate *from*. Give them one: their combined curve flattened onto the
// baseline, and zeroed table/board rows. CSS hides all of it until the combined
// view is on, at which point it rises out of the axis and fades in.
function mergeAbsent(leagueView, allView) {
  const known = new Set(leagueView.lifetime.map((r) => r.ticker));
  const baseline = leagueView.chart.baselineY;

  for (const row of allView.lifetime) {
    if (known.has(row.ticker)) continue;
    const source = allView.chart.series.find((s) => s.ticker === row.ticker);

    leagueView.chart.series.push({
      ...source,
      absent: true,
      d: flattenPath(source.d, baseline),
      areaD: flattenPath(source.areaD, baseline),
      dots: source.dots.map((d) => ({ ...d, y: baseline, r: 0 })),
      end: { x: source.end.x, y: baseline },
      totalText: money(0),
      totalRoundText: moneyRound(0),
    });

    const zeroed = {
      ...row,
      absent: true,
      total: 0,
      totalText: money(0),
      totalRoundText: moneyRound(0),
      paid: 0,
      paidText: money(0),
      net: 0,
      netText: "+" + money(0),
      roi: 0,
      roiText: "—",
      change: 0,
      changeText: money(0),
      props: 0,
      highs: 0,
      pct: 0,
      seasons: 0,
      cells: row.cells.map((c) => ({ ...c, played: false, value: -1, text: "—", heat: 0 })),
      spark: { ...row.spark, bars: row.spark.bars.map((b) => ({ ...b, h: 0, y: row.spark.h, played: false })) },
    };
    leagueView.lifetime.push(zeroed);
    leagueView.props.push(zeroed);
    leagueView.highs.push(zeroed);
  }
}
