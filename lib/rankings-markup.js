// Markup for the three data-driven regions of the Rankings tab.
//
// These live in JS rather than in dashboard.njk for one reason: the live
// current-season merge has to redraw them in the browser, and the previous
// arrangement — Nunjucks for the frozen render, a hand-copied template literal
// in dashboard.js for the live one — drifted badly enough that mid-season the
// page lost its Toilet King banners and every identity-colored ring. One
// function per region, called by .eleventy.js at build time and by
// src/scripts/dashboard.js after the merge, means the two renders cannot differ.
//
// dashboard.njk still owns the page: cards, section heads, table head, notes.

import { ordinal } from "./rankings-model.js";
import { ICON_CROWN } from "../src/scripts/icons.js";

// Sleeper display names are user-controlled, and Nunjucks' auto-escaping does
// not reach a string we hand it with `| safe`.
const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The banner rail: every trophy, plaque and toilet seat, newest first. */
export function raftersMarkup(banners) {
  if (!banners.length) {
    return '<p class="rank-empty">Nothing hanging yet — the first banner goes up when a season ends.</p>';
  }
  return banners
    .map(
      (b) => `<article class="rank-banner is-${b.kind}" style="--chip: ${esc(b.chip)}">
      <span class="rank-banner-year">${esc(b.year)}</span>
      <img class="rank-banner-face" src="${esc(b.avatar)}" alt="" loading="lazy"
        onclick="window.expandAvatar && window.expandAvatar(this.src)">
      <span class="rank-banner-name">${esc(b.name)}</span>
      <span class="rank-banner-label">${esc(b.label)}</span>
    </article>`
    )
    .join("");
}

/** The bump chart's <svg> innards: gridlines, season axis, one group per manager. */
export function climbMarkup(climb) {
  const gridlines = climb.yTicks
    .map(
      (t) => `<g class="rank-gridline ${t.rank === 1 ? "is-crown" : ""}">
      <line x1="${climb.plotLeft}" x2="${climb.plotRight}" y1="${t.y}" y2="${t.y}"></line>
      <text x="${climb.plotLeft - 14}" y="${t.y + 4}" text-anchor="end">${t.rank}</text>
    </g>`
    )
    .join("");

  const xAxis = climb.xTicks
    .map(
      (t) =>
        `<text class="rank-axis-x" x="${t.x}" y="${climb.baselineY + 34}" text-anchor="middle">${esc(t.label)}</text>`
    )
    .join("");

  // Reverse: the leaders are drawn last so they sit on top of the pack.
  const series = [...climb.series]
    .reverse()
    .map((s) => {
      // A title year gets a gold marker that stays visible whether or not the
      // manager is emphasized — it's the only thing reconciling a mid-table
      // line with a banner in the Rafters.
      const dots = s.dots
        .map(
          (p) =>
            `<circle class="rank-dot ${p.title ? "is-title" : ""}" cx="${p.x}" cy="${p.y}" r="4"><title>${esc(s.name)} — ${ordinal(p.rank)} in the ${esc(p.year)} regular season${p.title ? ", won the title" : ""}</title></circle>`
        )
        .join("");
      const label = s.end
        ? `<text class="rank-end-label" x="${s.end.x}" y="${s.end.y}">${esc(s.short)}</text>`
        : "";
      return `<g class="rank-series ${s.isTop ? "is-top" : ""}" data-manager="${esc(s.userId)}"
        style="--line: ${esc(s.line)}; --chip: ${esc(s.chip)}">
        <path class="rank-line-hit" d="${s.d}"></path>
        <path class="rank-line" d="${s.d}"></path>
        ${dots}${label}
      </g>`;
    })
    .join("");

  return gridlines + xAxis + series;
}

/** The legend rail beside the chart — ranked, and the isolate control. */
export function climbLegendMarkup(rows) {
  return rows
    .map(
      (r) => `<button type="button" class="rank-legend-chip ${r.rank <= 3 ? "is-top" : ""}"
      data-manager="${esc(r.userId)}" aria-pressed="false"
      style="--line: ${esc(r.line)}; --chip: ${esc(r.chip)}"
      title="${esc(r.name)} — ${ordinal(r.rank)} all-time. Click to isolate on the chart; Esc clears.">
      <img src="${esc(r.avatar)}" alt="">
      <span class="rank-legend-sym">${esc(r.short)}</span>
      <span class="rank-legend-val">${ordinal(r.rank)}</span>
    </button>`
    )
    .join("");
}

// Medals ride on the all-time rank itself, not on row position — the table is
// sortable, so #1 has to stay gold after someone sorts by points against.
const MEDAL = { 1: "is-gold", 2: "is-silver", 3: "is-bronze" };

/** The all-time standings blotter's <tbody>. */
export function standingsMarkup(rows) {
  return rows
    .map((r) => {
      const bars = r.form.bars
        .map(
          (b) =>
            `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="1" class="${b.played ? "rank-form-bar" : "rank-form-gap"}"></rect>`
        )
        .join("");
      const hardware = r.titles
        ? `<span class="rank-rings" title="${r.titles} title${r.titles === 1 ? "" : "s"}">${"●".repeat(Math.min(r.titles, 4))}${r.titles > 4 ? `<i>+${r.titles - 4}</i>` : ""}</span>`
        : '<span class="rank-rings is-empty">—</span>';

      return `<tr data-manager="${esc(r.userId)}" style="--chip: ${esc(r.chip)}; --line: ${esc(r.line)}">
      <td class="px-3 py-2" data-value="${r.rank}"><span class="rank-pos ${MEDAL[r.rank] || ""}">${r.rank}</span></td>
      <td class="px-3 py-2" data-value="${esc(r.name)}">
        <span class="rank-holder">
          <img src="${esc(r.avatar)}" alt="" loading="lazy"
            onclick="window.expandAvatar && window.expandAvatar(this.src)">
          <span class="truncate">${esc(r.name)}</span>
          ${r.isChamp ? `<span class="rank-crown" title="Reigning Champ">${ICON_CROWN}</span>` : ""}
        </span>
      </td>
      <td class="px-3 py-2 text-center rank-col-opt" data-value="${r.seasons}">${r.seasons}</td>
      <td class="px-3 py-2 whitespace-nowrap" data-value="${r.wins}"><span class="win">${r.wins}</span>-<span class="loss">${r.losses}</span>${r.ties ? "-" + r.ties : ""}</td>
      <td class="px-3 py-2 text-right rank-pct"${r.heat > 0.02 ? ` style="--heat: ${r.heat}"` : ""} data-value="${r.winPct}">${r.winPctText}</td>
      <td class="px-3 py-2 text-right win" data-value="${r.pf}">${r.pfText}</td>
      <td class="px-3 py-2 text-right loss rank-col-opt" data-value="${r.pa}">${r.paText}</td>
      <td class="px-3 py-2 text-right font-semibold ${r.diff >= 0 ? "win" : "loss"}" data-value="${r.diff}">${r.diffText}</td>
      <td class="px-3 py-2 text-center" data-value="${r.titles}">${hardware}</td>
      <td class="px-3 py-2 whitespace-nowrap rank-col-opt" data-value="${r.bestRank ?? 99}">${esc(r.bestText)}</td>
      <td class="px-3 py-2" data-value="${r.form.recentForm}">
        <svg class="rank-form" viewBox="0 0 ${r.form.w} ${r.form.h}" width="${r.form.w}" height="${r.form.h}" aria-hidden="true">${bars}</svg>
      </td>
    </tr>`;
    })
    .join("");
}
