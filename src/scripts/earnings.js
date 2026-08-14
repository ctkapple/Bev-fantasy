// Earnings tab ("the exchange"): isolation behavior for the cumulative equity
// curve. The chart itself is rendered server-side as inline SVG by
// earnings.njk — this file only ever toggles classes on it, so the page paints
// its full chart before any JS runs.
//
// Two ways in: hovering a line (transient) and clicking a legend chip or
// blotter row (sticky, until clicked again). A sticky pick wins over hover so
// moving the mouse across the chart can't silently drop the manager you locked.

const card = document.querySelector("[data-earnings-chart]");

if (card) {
  const series = [...card.querySelectorAll(".exch-series")];
  const chips = [...card.querySelectorAll(".exch-legend-chip")];
  const rows = [...document.querySelectorAll(".exch-blotter tbody tr[data-ticker]")];

  let pinned = null;
  let hovered = null;

  function render() {
    const active = pinned || hovered;
    card.classList.toggle("is-isolating", Boolean(active));
    series.forEach((g) => g.classList.toggle("is-active", g.dataset.ticker === active));
    chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.ticker === pinned)));
  }

  function hover(ticker) {
    hovered = ticker;
    render();
  }

  function pin(ticker) {
    pinned = pinned === ticker ? null : ticker;
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
    if (event.key === "Escape" && pinned) pin(pinned);
  });
}
