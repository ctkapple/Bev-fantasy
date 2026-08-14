import { readFileSync } from "node:fs";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "resources": "resources" });
  eleventyConfig.addPassthroughCopy("CNAME");

  // Historical/aggregate JSON produced by data-build/fetch-sleeper.js lands in
  // src/leagues/<slug>/data/*.json and needs to ship as-is (alongside the per-league
  // config files) so client JS can fetch it directly for the current-season merge.
  eleventyConfig.addPassthroughCopy({ "src/leagues": "leagues" });

  eleventyConfig.addShortcode("icon", function (name, cls = "icon") {
    try {
      const svg = readFileSync(
        new URL(`./node_modules/lucide-static/icons/${name}.svg`, import.meta.url)
      ).toString();
      return svg.replace("<svg ", `<svg class="${cls}" `);
    } catch {
      console.warn(`[icon shortcode] Unknown Lucide icon "${name}" - check the exact filename under node_modules/lucide-static/icons/`);
      return "";
    }
  });

  eleventyConfig.addFilter("commas", (num) =>
    typeof num === "number" ? num.toLocaleString("en-US") : num
  );

  eleventyConfig.addFilter("limit", (arr, n) => (arr || []).slice(0, n));

  // The original site rendered all scores to 2 decimal places.
  eleventyConfig.addFilter("decimal2", (num) => (typeof num === "number" ? num.toFixed(2) : num));

  // Look up a manager id by display name - lets hand-curated config data
  // (Toilet Kings, manual toilet-bowl entries) reference people by name
  // instead of opaque Sleeper user ids.
  // Collapse the flat [{year, manager}] toiletKings config into one entry per
  // manager with all their years, matching the original's grouping.
  eleventyConfig.addFilter("groupToiletKings", (kings) => {
    const byManager = new Map();
    for (const k of kings || []) {
      if (!byManager.has(k.manager)) byManager.set(k.manager, []);
      byManager.get(k.manager).push(k.year);
    }
    return [...byManager.entries()].map(([manager, years]) => ({ manager, years: years.sort() }));
  });

  // Drop hand-entered entries for any season the Sleeper fetch already covered.
  // The build reaches back further than the original site did, so manual
  // fallbacks (e.g. jrwll's 2021 toilet bowl) can now collide with real data.
  eleventyConfig.addFilter("excludeSeasonsIn", (manualList, existing) => {
    const covered = new Set((existing || []).map((g) => String(g.season)));
    return (manualList || []).filter((m) => !covered.has(String(m.season)));
  });

  eleventyConfig.addFilter("sortBySeasonDesc", (arr) =>
    [...(arr || [])].sort((a, b) => Number(b.season) - Number(a.season))
  );

  eleventyConfig.addFilter("managerByName", (managers, name) => {
    if (!managers) return null;
    return Object.values(managers).find((m) => m.displayName === name) || null;
  });

  eleventyConfig.addFilter("decimal1", (num) =>
    typeof num === "number" ? num.toFixed(1) : num
  );

  // JSON-embed filter for <script type="application/json"> data islands.
  // Escapes "</" so a string value can never prematurely close the script tag.
  eleventyConfig.addFilter("dump", (obj) => JSON.stringify(obj ?? null).replace(/<\//g, "<\\/"));

  // FAAB tab helpers: SeasonData.faabBids only carries a bare managerId, so
  // flatten-and-resolve-names lives here rather than as nested Nunjucks loops.
  eleventyConfig.addFilter("topFaabBids", (historical, n = 15) => {
    const all = (historical || []).flatMap((season) =>
      (season.faabBids || []).map((bid) => ({
        ...bid,
        season: season.season,
        managerName: season.managers[bid.managerId]?.displayName || "Unknown",
      }))
    );
    return all.sort((a, b) => b.amount - a.amount).slice(0, n);
  });

  // Earnings tab: championship-count-based payout, e.g. bb.json's model
  // (total = sum of payoutsByYear[y] for every y a manager won it all).
  eleventyConfig.addFilter("championshipEarnings", (managers, payoutsByYear) => {
    if (!managers || !payoutsByYear) return [];
    return Object.values(managers)
      .map((m) => ({
        displayName: m.displayName,
        total: (m.championshipYears || []).reduce((sum, year) => sum + (payoutsByYear[year] || 0), 0),
      }))
      .filter((m) => m.total > 0)
      .sort((a, b) => b.total - a.total);
  });

  // --- Earnings tab ("the exchange") ---------------------------------------
  // The three highlight colors the equity curve gives its top three earners.
  // Everyone else draws in DIM so the leaders stay readable through twelve
  // overlapping lines.
  const EARNINGS_COLORS = ["#fb923c", "#fbbf24", "#fde68a"];
  const EARNINGS_DIM = "#52525b";

  const money = (n) =>
    "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // A manager's ticker symbol: the first four letters of their surname, e.g.
  // "Malcolm Zeroka" -> ZERO. Collisions fall back to three surname letters
  // plus the first initial (SMIT/SMIJ), which is enough for a 12-team league.
  function deriveTickers(names) {
    const used = new Set();
    const out = {};
    for (const name of names) {
      const parts = String(name).trim().split(/\s+/);
      const surname = (parts[parts.length - 1] || name).replace(/[^A-Za-z]/g, "").toUpperCase();
      const initial = (parts[0] || name).replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 1);
      let ticker = (surname + initial + "XXXX").slice(0, 4);
      if (used.has(ticker)) ticker = (surname.slice(0, 3) + initial + "XXXX").slice(0, 4);
      let suffix = 1;
      while (used.has(ticker)) ticker = ticker.slice(0, 3) + String(suffix++);
      used.add(ticker);
      out[name] = ticker;
    }
    return out;
  }

  // Earnings tab: fully hand-curated ledger model, e.g. jrwll.json's model
  // (each manager's total is a hand-entered $ per year, not derived from
  // championshipYears — winnings also come from runner-up/3rd/weekly-high-
  // score/weekly-prop money, not just first place). Joins the ledger (keyed
  // by display name, since that's how it was hand-entered) against `managers`
  // (keyed by userId) for avatar/userId/seasons-played, then produces the
  // whole trading-desk view model: ticker tape, market summary, the geometry
  // of the cumulative equity curve, and the holdings blotter.
  //
  // Seasons played comes from each manager's yearlyStandings rather than from
  // the ledger, because a $0 ledger year is ambiguous — it means either "won
  // nothing" or "wasn't in the league yet" (JRWLL ran 10 teams in 2021, 12
  // after). Only the former should count against a manager's cost basis, and
  // only the latter should be left out of their equity curve.
  eleventyConfig.addFilter("earningsMarket", (managers, earnings) => {
    const ledger = earnings && earnings.ledger;
    if (!managers || !ledger) return null;

    const byName = {};
    Object.values(managers).forEach((m) => {
      byName[m.displayName] = m;
    });

    const years = [
      ...new Set(Object.values(ledger).flatMap((e) => Object.keys(e.byYear || {}))),
    ].sort();
    const buyIn = Number(earnings.buyIn) || 0;
    const overrides = earnings.tickers || {};
    const derived = deriveTickers(Object.keys(ledger));

    const rows = Object.entries(ledger)
      .map(([name, e]) => {
        const manager = byName[name];
        if (!manager) return null;
        const byYear = e.byYear || {};
        const standings = manager.yearlyStandings || [];
        const played = standings.length
          ? new Set(standings.map((s) => String(s.year)))
          : new Set(Object.keys(byYear));

        let running = 0;
        const cumulative = years.map((y) => {
          if (!played.has(y)) return null;
          running += byYear[y] || 0;
          return running;
        });

        const total = running;
        const paid = played.size * buyIn;
        const vals = years.map((y) => (played.has(y) ? byYear[y] || 0 : null));
        const latest = years[years.length - 1];
        return {
          manager,
          name,
          ticker: overrides[name] || derived[name],
          byYear,
          vals,
          played: years.map((y) => played.has(y)),
          seasons: played.size,
          cumulative,
          total,
          totalText: money(total),
          paid,
          paidText: money(paid),
          net: total - paid,
          netText: (total - paid >= 0 ? "+" : "−") + money(Math.abs(total - paid)),
          roiText: paid ? (total - paid >= 0 ? "+" : "−") + Math.round(Math.abs((total - paid) / paid) * 100) + "%" : "—",
          change: played.has(latest) ? byYear[latest] || 0 : 0,
          changeText: money(played.has(latest) ? byYear[latest] || 0 : 0),
          props: e.props || 0,
          highs: e.highs || 0,
        };
      })
      .filter(Boolean);

    // A ledger whose names all failed to join against `managers` has nothing
    // to chart; fall through to the simpler no-ledger layout instead.
    if (rows.length === 0 || years.length === 0) return null;

    // Blotter cells and the per-row mini bar chart. `heat` is a single year's
    // take as a fraction of the biggest year anyone has ever had, so a
    // championship season glows and a $10 high-score week barely registers.
    const bestYear = Math.max(1, ...rows.flatMap((r) => r.vals.map((v) => v || 0)));
    const SPARK = { w: 78, h: 24, gap: 3 };
    const barW = (SPARK.w - SPARK.gap * (years.length - 1)) / years.length;
    rows.forEach((r) => {
      r.cells = years.map((y, i) => ({
        year: y,
        played: r.vals[i] !== null,
        value: r.vals[i] === null ? -1 : r.vals[i],
        text: r.vals[i] === null ? "—" : money(r.vals[i]),
        heat: r.vals[i] === null ? 0 : +(r.vals[i] / bestYear).toFixed(3),
      }));
      r.spark = {
        ...SPARK,
        bars: r.vals.map((v, i) => {
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

    const lifetime = [...rows].sort((a, b) => b.total - a.total);
    lifetime.forEach((r, i) => {
      r.rank = i + 1;
    });

    // --- Equity curve geometry ---------------------------------------------
    const W = 1000;
    const H = 440;
    const PAD = { l: 62, r: 104, t: 22, b: 46 };
    const plotW = W - PAD.l - PAD.r;
    const plotH = H - PAD.t - PAD.b;
    const rawMax = Math.max(1, ...lifetime.map((r) => r.total));
    const step = [10, 25, 50, 100, 200, 250, 500, 1000, 2500, 5000].find((s) => rawMax / s <= 4) || 10000;
    const maxY = Math.ceil(rawMax / step) * step;
    const xFor = (i) => (years.length === 1 ? PAD.l + plotW / 2 : PAD.l + (plotW * i) / (years.length - 1));
    const yFor = (v) => PAD.t + plotH - (v / maxY) * plotH;

    const series = lifetime.map((r, rank) => {
      const points = r.cumulative
        .map((v, i) => (v === null ? null : { x: +xFor(i).toFixed(2), y: +yFor(v).toFixed(2), value: v, year: years[i] }))
        .filter(Boolean);
      const d = points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
      const first = points[0];
      const last = points[points.length - 1];
      return {
        ticker: r.ticker,
        name: r.name,
        avatar: r.manager.avatar,
        userId: r.manager.userId,
        rank: rank + 1,
        isTop: rank < EARNINGS_COLORS.length,
        color: EARNINGS_COLORS[rank] || EARNINGS_DIM,
        d,
        areaD: first && last ? `${d} L${last.x} ${yFor(0)} L${first.x} ${yFor(0)} Z` : "",
        points,
        end: last,
        totalText: r.totalText,
      };
    });

    const chart = {
      width: W,
      height: H,
      baselineY: +yFor(0).toFixed(2),
      series,
      yTicks: [...Array(maxY / step + 1)].map((_, i) => ({
        label: "$" + (i * step).toLocaleString("en-US"),
        y: +yFor(i * step).toFixed(2),
      })),
      xTicks: years.map((y, i) => ({ label: y, x: +xFor(i).toFixed(2) })),
      plotLeft: PAD.l,
      plotRight: W - PAD.r,
    };

    // --- Market summary -----------------------------------------------------
    const distributed = rows.reduce((sum, r) => sum + r.total, 0);
    const potByYear = {};
    years.forEach((y) => {
      potByYear[y] = rows.filter((r) => r.played[years.indexOf(y)]).length * buyIn;
    });
    const pot = Object.values(potByYear).reduce((a, b) => a + b, 0);
    let biggest = { amount: -Infinity };
    rows.forEach((r) =>
      years.forEach((y, i) => {
        if (r.played[i] && (r.byYear[y] || 0) > biggest.amount) {
          biggest = { amount: r.byYear[y] || 0, year: y, ticker: r.ticker, name: r.name };
        }
      })
    );

    const maxProps = Math.max(1, ...rows.map((r) => r.props));
    const maxHighs = Math.max(1, ...rows.map((r) => r.highs));
    const withPct = (list, key, max) =>
      list.map((r) => ({ ...r, pct: Math.round((r[key] / max) * 100) }));

    return {
      years,
      buyIn,
      chart,
      lifetime,
      tape: lifetime,
      holdings: lifetime,
      breakdown: [...rows].sort((a, b) => a.name.localeCompare(b.name)),
      props: withPct([...rows].filter((r) => r.props > 0).sort((a, b) => b.props - a.props), "props", maxProps),
      highs: withPct([...rows].filter((r) => r.highs > 0).sort((a, b) => b.highs - a.highs), "highs", maxHighs),
      summary: {
        distributedText: money(distributed),
        potText: money(pot),
        undistributed: pot - distributed,
        undistributedText: money(pot - distributed),
        seasons: years.length,
        latestYear: years[years.length - 1],
        latestPotText: money(potByYear[years[years.length - 1]] || 0),
        leader: lifetime[0],
        biggest: { ...biggest, amountText: money(biggest.amount) },
      },
    };
  });

  // Trades tab filter bar: precompute the searchable/filterable facets for one
  // trade (participant ids, positions moved, "season:round" pick tokens, and
  // whether FAAB changed hands) so the template can drop them straight into
  // data-* attributes and the client-side filter (trades.js) never has to
  // re-derive them from trade.pieces itself.
  eleventyConfig.addFilter("tradeIndex", (trade) => {
    const allPieces = Object.values(trade.pieces || {}).flat();
    return {
      managers: Object.keys(trade.pieces || {}).join(","),
      positions: [...new Set(allPieces.filter((p) => p.type === "player").map((p) => p.position || "NA"))].join(","),
      picks: allPieces.filter((p) => p.type === "pick").map((p) => `${p.season}:${p.round}`).join(" "),
      hasFaab: allPieces.some((p) => p.type === "faab"),
    };
  });

  eleventyConfig.addFilter("faabTotalsByManager", (historical, managers) => {
    const totals = {};
    for (const season of historical || []) {
      for (const bid of season.faabBids || []) {
        totals[bid.managerId] = (totals[bid.managerId] || 0) + bid.amount;
      }
    }
    return Object.entries(totals)
      .map(([managerId, total]) => ({ managerId, total, displayName: managers?.[managerId]?.displayName || "Unknown" }))
      .sort((a, b) => b.total - a.total);
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
