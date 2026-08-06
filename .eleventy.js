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
