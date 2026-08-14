// Earnings tab ("the exchange"): line isolation, and the This League ↔ All
// Leagues toggle.
//
// The chart is rendered server-side as inline SVG by earnings.njk, so the page
// paints its full this-league chart before any JS runs. The combined view rides
// along as a JSON island (lib/earnings-model.js `compact`), and this file
// interpolates between the two.
//
// The trick that makes the morph cheap: both views' paths are generated from
// the same number of sample points, so their `d` strings have identical command
// structure and differ only in their numbers. Lerping the numbers pairwise and
// re-joining with the same template is all it takes — no path parser, no
// spline math in the browser. See sampleSeries in the model for how a
// one-season league is padded out to agree with a five-season one.

const card = document.querySelector("[data-earnings-chart]");
const exchange = document.querySelector("[data-exchange]");
const island = document.querySelector("[data-earnings-all]");

const DURATION = 700;
const EASE = (t) => 1 - Math.pow(1 - t, 3); // cubic-bezier(.22,1,.36,1), near enough
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ------------------------------------------------------------------ isolate */

if (card) {
  const series = [...card.querySelectorAll(".exch-series")];
  const chips = [...card.querySelectorAll(".exch-legend-chip")];
  const rows = [...document.querySelectorAll(".exch-blotter tbody tr[data-ticker]")];

  // Any number of managers can be pinned at once — comparing two or three runs
  // is the thing people actually want from this chart. Hover is a preview of a
  // single line and only applies while nothing is pinned; once a selection
  // exists, hovering another line adds it to what's lit rather than replacing
  // the selection out from under the pointer.
  const pinned = new Set();
  let hovered = null;

  function render() {
    const active = new Set(pinned);
    if (hovered) active.add(hovered);
    card.classList.toggle("is-isolating", active.size > 0);
    series.forEach((g) => g.classList.toggle("is-active", active.has(g.dataset.ticker)));
    chips.forEach((c) => c.setAttribute("aria-pressed", String(pinned.has(c.dataset.ticker))));
  }

  function hover(ticker) {
    hovered = ticker;
    render();
  }

  function pin(ticker) {
    if (pinned.has(ticker)) pinned.delete(ticker);
    else pinned.add(ticker);
    render();
  }

  series.forEach((g) => {
    const ticker = g.dataset.ticker;
    g.addEventListener("pointerenter", () => hover(ticker));
    g.addEventListener("pointerleave", () => hover(null));
    g.addEventListener("click", () => pin(ticker));
  });

  chips.forEach((chip) => {
    const ticker = chip.dataset.ticker;
    chip.addEventListener("click", () => pin(ticker));
    chip.addEventListener("pointerenter", () => hover(ticker));
    chip.addEventListener("pointerleave", () => hover(null));
    chip.addEventListener("focus", () => hover(ticker));
    chip.addEventListener("blur", () => hover(null));
  });

  // Hovering a manager's row in the blotter lights up their line, which is the
  // fastest way to answer "which of these twelve is the one I'm reading?".
  rows.forEach((row) => {
    const ticker = row.dataset.ticker;
    row.addEventListener("pointerenter", () => hover(ticker));
    row.addEventListener("pointerleave", () => hover(null));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pinned.size) {
      pinned.clear();
      render();
    }
  });
}

/* ------------------------------------------------------------------- toggle */

if (exchange && island && card) {
  // Both views are normalized into the same shape so switching is symmetric:
  // one is read out of the server-rendered DOM, the other out of the JSON
  // island, and neither direction is a special case.
  const views = { league: readDom(), all: readIsland(JSON.parse(island.textContent)) };

  // The server render hides gridlines and year labels this league doesn't reach
  // with `is-offview`, so the page is right with JS disabled. Once JS is here,
  // opacity has to drive them instead — a display:none tick can't fade in when
  // the combined view rescales the axis past it.
  card.querySelectorAll("[data-grid], [data-xtick]").forEach((el) => {
    el.classList.remove("is-offview");
    el.style.opacity = el.dataset.inLeague;
  });

  let view = "league";
  let frame = null;

  /* ---- numeric path interpolation ---- */

  const round = (n) => Math.round(n * 100) / 100;
  const lerp = (a, b, t) => a + (b - a) * t;

  // The two views' paths were generated from the same number of sample points,
  // so they differ only in their numbers. Split each into literal chunks and
  // numbers, lerp the numbers, re-join.
  function lerpPath(from, to, t) {
    const numsA = from.match(/-?\d+(?:\.\d+)?/g) || [];
    const numsB = to.match(/-?\d+(?:\.\d+)?/g) || [];
    if (numsA.length !== numsB.length) return t < 0.5 ? from : to;
    const chunks = from.split(/-?\d+(?:\.\d+)?/);
    let out = "";
    for (let i = 0; i < numsA.length; i++) {
      out += chunks[i] + round(lerp(parseFloat(numsA[i]), parseFloat(numsB[i]), t));
    }
    return out + chunks[chunks.length - 1];
  }

  function areaFor(series, baselineY) {
    const first = series.dots[0];
    const last = series.dots[series.dots.length - 1];
    return `${series.d} L${last.x} ${baselineY} L${first.x} ${baselineY} Z`;
  }

  /* ---- reading the two views ---- */

  function readDom() {
    const state = { series: {}, rows: {}, summary: {}, order: [] };

    card.querySelectorAll(".exch-series").forEach((g) => {
      const label = g.querySelector(".exch-end-label");
      state.series[g.dataset.ticker] = {
        d: g.querySelector(".exch-line").getAttribute("d"),
        area: g.querySelector(".exch-area").getAttribute("d"),
        dots: [...g.querySelectorAll(".exch-dot")].map((c) => ({
          x: parseFloat(c.getAttribute("cx")),
          y: parseFloat(c.getAttribute("cy")),
          r: parseFloat(c.getAttribute("r")),
        })),
        end: { x: parseFloat(label.getAttribute("x")) - 10, y: parseFloat(label.getAttribute("y")) - 4 },
        hidden: g.classList.contains("is-absent"),
      };
    });

    const row = (ticker) => (state.rows[ticker] = state.rows[ticker] || {});

    document.querySelectorAll(".exch-blotter tbody tr[data-ticker]").forEach((tr, i) => {
      const r = row(tr.dataset.ticker);
      state.order.push(tr.dataset.ticker);
      r.rank = i + 1;
      r.hidden = tr.classList.contains("is-absent");
      for (const field of ["totalText", "netText", "roiText"]) {
        const el = tr.querySelector(`[data-field="${field}"]`);
        r[field] = el.textContent.trim();
        r[field.replace("Text", "Value")] = el.dataset.value;
      }
      r.cells = [...tr.querySelectorAll("[data-cell]")].map((td) => ({
        text: td.textContent.trim(),
        value: td.dataset.value,
        heat: td.style.getPropertyValue("--heat"),
        empty: td.classList.contains("exch-cell-empty"),
        offview: td.classList.contains("is-offview"),
      }));
      r.spark = [...tr.querySelectorAll(".exch-spark rect")].map((rect) => ({
        y: rect.getAttribute("y"),
        h: rect.getAttribute("height"),
        played: rect.classList.contains("exch-spark-bar"),
      }));
    });

    document.querySelectorAll(".exch-tape-run:first-child .exch-tape-item").forEach((item) => {
      const r = row(item.dataset.ticker);
      r.tapeTotal = item.querySelector('[data-field="totalText"]').textContent.trim();
      r.tapeChange = item.querySelector('[data-field="changeText"]').textContent.trim();
      const delta = item.querySelector('[data-field="delta"]');
      r.tapeDir = delta.classList.contains("is-up")
        ? "up"
        : delta.classList.contains("is-down")
          ? "down"
          : "flat";
    });

    document.querySelectorAll(".exch-legend-chip").forEach((chip) => {
      const r = row(chip.dataset.ticker);
      r.chipValue = chip.querySelector('[data-field="totalRoundText"]').textContent.trim();
      r.valColor = chip.style.getPropertyValue("--val").trim();
    });

    document.querySelectorAll("[data-board]").forEach((board) => {
      board.querySelectorAll(".exch-board-row").forEach((el) => {
        row(el.dataset.ticker)[board.dataset.board] = {
          amount: el.querySelector('[data-field="amount"]').textContent.trim(),
          pct: parseFloat(el.querySelector(".exch-board-bar i").style.width) || 0,
          zero: el.classList.contains("is-absent"),
        };
      });
    });

    document.querySelectorAll("[data-stat]").forEach((el) => {
      state.summary[el.dataset.stat] = el.textContent.trim();
    });
    const img = document.querySelector("[data-stat-img]");
    state.summary.leaderAvatar = img ? img.getAttribute("src") : "";
    const leaderTile = document.querySelector(".exch-stat-value--sym");
    state.summary.leaderColor = leaderTile ? leaderTile.style.getPropertyValue("--chip") : "";

    return state;
  }

  function readIsland(data) {
    const state = {
      series: {},
      rows: {},
      summary: { ...data.summary, firstYear: data.years[0] },
      order: [],
    };

    for (const [ticker, s] of Object.entries(data.series)) {
      state.series[ticker] = { ...s, area: areaFor(s, data.plot.baselineY), hidden: false };
    }

    for (const [ticker, r] of Object.entries(data.rows)) {
      state.rows[ticker] = {
        rank: r.rank,
        valColor: r.valColor,
        hidden: false,
        totalText: r.totalText,
        totalValue: r.total,
        netText: r.netText,
        netValue: r.net,
        roiText: r.roiText,
        roiValue: r.roi,
        chipValue: r.totalRoundText,
        tapeTotal: r.totalText,
        tapeChange: r.changeText,
        tapeDir: r.change > 0 ? "up" : r.change < 0 ? "down" : "flat",
        cells: r.cells.map((c) => ({
          text: c.text,
          value: c.value,
          heat: c.played && c.heat > 0.02 ? String(c.heat) : "",
          empty: !c.played,
          offview: !c.inView,
        })),
        spark: r.spark.map((b) => ({ y: b.y, h: b.h, played: b.played })),
        props: { amount: String(r.props), pct: r.propsPct, zero: !r.props },
        highs: { amount: String(r.highs), pct: r.highsPct, zero: !r.highs },
      };
    }

    state.order = Object.entries(data.rows)
      .sort((a, b) => a[1].rank - b[1].rank)
      .map(([ticker]) => ticker);

    return state;
  }

  /* ---- geometry, every frame ---- */

  function paint(t) {
    const { league, all } = views;

    card.querySelectorAll(".exch-series").forEach((g) => {
      const a = league.series[g.dataset.ticker];
      const b = all.series[g.dataset.ticker];
      if (!a || !b) return;

      const d = lerpPath(a.d, b.d, t);
      g.querySelector(".exch-line").setAttribute("d", d);
      g.querySelector(".exch-line-hit").setAttribute("d", d);
      // The fill is invisible unless this manager is lit, but it still has to
      // travel with the line — otherwise hovering mid-animation shows a wash
      // sitting under where the curve used to be.
      g.querySelector(".exch-area").setAttribute("d", lerpPath(a.area, b.area, t));

      g.querySelectorAll(".exch-dot").forEach((dot, i) => {
        if (!a.dots[i] || !b.dots[i]) return;
        dot.setAttribute("cx", round(lerp(a.dots[i].x, b.dots[i].x, t)));
        dot.setAttribute("cy", round(lerp(a.dots[i].y, b.dots[i].y, t)));
        dot.setAttribute("r", round(lerp(a.dots[i].r, b.dots[i].r, t)));
      });

      const label = g.querySelector(".exch-end-label");
      label.setAttribute("x", round(lerp(a.end.x, b.end.x, t)) + 10);
      label.setAttribute("y", round(lerp(a.end.y, b.end.y, t)) + 4);

      // Rank drives emphasis, and the top three change between views — hand it
      // over at the midpoint so a line doesn't thicken before it has moved.
      const top = (t < 0.5 ? league : all).rows[g.dataset.ticker];
      g.classList.toggle("is-top", Boolean(top && top.rank <= 3));

      // A manager with no money in this league starts flattened onto the axis
      // (see mergeAbsent in the model) and fades up as their real curve grows.
      if (a.hidden) g.style.opacity = String(t);
    });

    card.querySelectorAll("[data-grid]").forEach((g) => {
      const y = round(lerp(parseFloat(g.dataset.yLeague), parseFloat(g.dataset.yAll), t));
      const line = g.querySelector("line");
      line.setAttribute("y1", y);
      line.setAttribute("y2", y);
      g.querySelector("text").setAttribute("y", y + 4);
      g.style.opacity = String(lerp(Number(g.dataset.inLeague), Number(g.dataset.inAll), t));
    });

    card.querySelectorAll("[data-xtick]").forEach((tick) => {
      tick.setAttribute("x", round(lerp(parseFloat(tick.dataset.xLeague), parseFloat(tick.dataset.xAll), t)));
      tick.style.opacity = String(lerp(Number(tick.dataset.inLeague), Number(tick.dataset.inAll), t));
    });
  }

  /* ---- text, classes and order: once, at the midpoint ---- */

  function applyState(target) {
    const state = views[target];

    document.querySelectorAll(".exch-blotter tbody tr[data-ticker]").forEach((tr) => {
      const r = state.rows[tr.dataset.ticker];
      if (!r) return;
      tr.classList.toggle("is-absent", Boolean(r.hidden));
      for (const field of ["totalText", "netText", "roiText"]) {
        const el = tr.querySelector(`[data-field="${field}"]`);
        el.textContent = r[field];
        el.dataset.value = r[field.replace("Text", "Value")];
      }
      const negative = parseFloat(r.netValue) < 0;
      tr.querySelector('[data-field="netText"]').className =
        `px-3 py-2 text-right font-semibold ${negative ? "loss" : "win"}`;
      tr.querySelector('[data-field="roiText"]').className =
        `px-3 py-2 text-right ${negative ? "loss" : "win"}`;

      tr.querySelectorAll("[data-cell]").forEach((td, i) => {
        const cell = r.cells[i];
        if (!cell) return;
        td.textContent = cell.text;
        td.dataset.value = cell.value;
        td.classList.toggle("exch-cell-empty", cell.empty);
        td.classList.toggle("is-offview", cell.offview);
        if (cell.heat) td.style.setProperty("--heat", cell.heat);
        else td.style.removeProperty("--heat");
      });

      tr.querySelectorAll(".exch-spark rect").forEach((rect, i) => {
        const bar = r.spark[i];
        if (!bar) return;
        rect.setAttribute("y", bar.y);
        rect.setAttribute("height", bar.h);
        rect.setAttribute("class", bar.played ? "exch-spark-bar" : "exch-spark-gap");
      });
    });

    document.querySelectorAll("[data-year-col]").forEach((th) => {
      const sample = document.querySelector(`[data-cell="${th.dataset.yearCol}"]`);
      th.classList.toggle("is-offview", Boolean(sample && sample.classList.contains("is-offview")));
    });

    document.querySelectorAll("[data-detail-for]").forEach((tr) => {
      tr.hidden = target !== "all";
    });

    document.querySelectorAll(".exch-tape-item").forEach((item) => {
      const r = state.rows[item.dataset.ticker];
      if (!r) return;
      item.classList.toggle("is-absent", Boolean(r.hidden));
      item.querySelector('[data-field="totalText"]').textContent = r.tapeTotal;
      item.querySelector('[data-field="changeText"]').textContent = r.tapeChange;
      const delta = item.querySelector('[data-field="delta"]');
      delta.classList.toggle("is-up", r.tapeDir === "up");
      delta.classList.toggle("is-down", r.tapeDir === "down");
      delta.classList.toggle("is-flat", r.tapeDir === "flat");
      delta.querySelector("i").textContent =
        r.tapeDir === "up" ? "▲" : r.tapeDir === "down" ? "▼" : "▬";
    });

    document.querySelectorAll(".exch-legend-chip").forEach((chip) => {
      const r = state.rows[chip.dataset.ticker];
      if (!r) return;
      chip.classList.toggle("is-absent", Boolean(r.hidden));
      chip.classList.toggle("is-top", r.rank <= 3);
      chip.querySelector('[data-field="totalRoundText"]').textContent = r.chipValue;
      chip.style.order = String(r.rank);
      // The green ramp is by rank, and the combined view re-ranks everyone, so
      // the color has to move with the chip or the rail would read as sorted
      // by one thing and colored by another.
      if (r.valColor) chip.style.setProperty("--val", r.valColor);
    });

    document.querySelectorAll("[data-board]").forEach((board) => {
      const key = board.dataset.board;
      let any = false;
      board.querySelectorAll(".exch-board-row").forEach((el) => {
        const r = state.rows[el.dataset.ticker];
        const data = r && r[key];
        if (!data) return;
        el.querySelector('[data-field="amount"]').textContent = data.amount;
        el.querySelector(".exch-board-bar i").style.width = `${data.pct}%`;
        el.classList.toggle("is-absent", Boolean(data.zero));
        el.style.order = String(r.rank);
        if (!data.zero) any = true;
      });
      board.classList.toggle("is-offview", !any);
    });

    for (const [key, value] of Object.entries(state.summary)) {
      if (key === "leaderAvatar" || key === "leaderColor") continue;
      document.querySelectorAll(`[data-stat="${key}"]`).forEach((el) => {
        el.textContent = value;
      });
    }
    const img = document.querySelector("[data-stat-img]");
    if (img && state.summary.leaderAvatar) img.setAttribute("src", state.summary.leaderAvatar);
    // The leader tile's symbol and avatar ring both hang off --chip, so the
    // whole tile changes identity with one property.
    const leaderTile = document.querySelector(".exch-stat-value--sym");
    if (leaderTile && state.summary.leaderColor) {
      leaderTile.style.setProperty("--chip", state.summary.leaderColor);
    }

    document.querySelectorAll("[data-view-note]").forEach((el) => {
      el.hidden = el.dataset.viewNote !== target;
    });
    const brand = document.querySelector("[data-tape-brand]");
    if (brand) brand.textContent = target === "all" ? "ALL" : brand.dataset.league;

    reorderBlotter(state.order);
  }

  // CSS `order` can't move table rows, and each manager's breakdown row has to
  // follow its own row, so the blotter is re-appended in rank order instead.
  function reorderBlotter(order) {
    const body = document.querySelector(".exch-blotter tbody");
    if (!body) return;
    for (const ticker of order) {
      const tr = body.querySelector(`tr[data-ticker="${ticker}"]`);
      const detail = body.querySelector(`tr[data-detail-for="${ticker}"]`);
      if (tr) body.appendChild(tr);
      if (detail) body.appendChild(detail);
    }
  }

  /* ---- driver ---- */

  function go(target, { animate = true } = {}) {
    if (view === target) return;
    view = target;
    exchange.dataset.view = target;
    document.querySelectorAll("[data-view-btn]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.viewBtn === target));
    });
    remember(target);

    if (frame) cancelAnimationFrame(frame);
    const to = target === "all" ? 1 : 0;

    // A hidden tab doesn't run animation frames, so animating there would
    // strand the view half-applied until the user came back to it.
    if (!animate || reducedMotion.matches || document.hidden) {
      paint(to);
      applyState(target);
      return;
    }

    const from = 1 - to;
    let swapped = false;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / DURATION);
      paint(lerp(from, to, EASE(p)));
      // Numbers and labels flip once, halfway, rather than strobing every frame —
      // by then the lines have moved far enough that it reads as one motion.
      if (!swapped && p >= 0.5) {
        applyState(target);
        swapped = true;
      }
      if (p < 1) frame = requestAnimationFrame(step);
      else {
        frame = null;
        if (!swapped) applyState(target);
      }
    };
    frame = requestAnimationFrame(step);
  }

  function remember(target) {
    try {
      const url = new URL(window.location.href);
      if (target === "all") url.searchParams.set("view", "all");
      else url.searchParams.delete("view");
      window.history.replaceState(null, "", url);
      window.localStorage.setItem("bev:earnings-view", target);
    } catch {
      /* private mode or file:// — the toggle still works, it just won't persist */
    }
  }

  const brand = document.querySelector("[data-tape-brand]");
  if (brand) brand.dataset.league = brand.textContent.trim();

  document.querySelectorAll("[data-view-btn]").forEach((btn) => {
    btn.addEventListener("click", () => go(btn.dataset.viewBtn));
  });

  // A deep link wins over the remembered preference.
  let wanted = new URLSearchParams(window.location.search).get("view");
  if (!wanted) {
    try {
      wanted = window.localStorage.getItem("bev:earnings-view");
    } catch {
      wanted = null;
    }
  }
  if (wanted === "all") go("all", { animate: false });
}

