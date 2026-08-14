// Generic sortable-table behavior. Any <table> with headers carrying
// data-sort="<key>" gets click-to-sort; each <td> in that column should carry
// a matching data-value attribute (numeric sorts) or plain text (string sorts).
//
// A row may own a detail row beneath it (the Earnings blotter's per-league
// breakdown): mark the owner `data-row-key="x"` and the detail
// `data-detail-for="x"`. Detail rows are held out of the sort and re-attached
// under their owner afterwards, instead of being sorted as if they were
// independent rows — their cells don't line up with the columns at all.

function sortTable(table, key, order) {
  const tbody = table.querySelector("tbody");
  const headerIndex = [...table.querySelectorAll("th[data-sort]")].findIndex(
    (th) => th.dataset.sort === key
  );
  if (!tbody || headerIndex === -1) return;

  const details = new Map(
    [...tbody.querySelectorAll("tr[data-detail-for]")].map((tr) => [tr.dataset.detailFor, tr])
  );
  const rows = [...tbody.querySelectorAll("tr")].filter((tr) => !tr.hasAttribute("data-detail-for"));
  rows.sort((a, b) => {
    const cellA = a.children[headerIndex];
    const cellB = b.children[headerIndex];
    const rawA = cellA?.dataset.value ?? cellA?.textContent.trim() ?? "";
    const rawB = cellB?.dataset.value ?? cellB?.textContent.trim() ?? "";
    const numA = parseFloat(rawA);
    const numB = parseFloat(rawB);
    const isNumeric = !Number.isNaN(numA) && !Number.isNaN(numB);
    const cmp = isNumeric ? numA - numB : String(rawA).localeCompare(String(rawB));
    return order === "asc" ? cmp : -cmp;
  });
  rows.forEach((row) => {
    tbody.appendChild(row);
    const detail = details.get(row.dataset.rowKey);
    if (detail) tbody.appendChild(detail);
  });
}

function setupSortableTable(table) {
  const headers = table.querySelectorAll("th[data-sort]");
  const state = { key: null, order: "desc" };

  headers.forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      state.order = state.key === key && state.order === "desc" ? "asc" : "desc";
      state.key = key;

      headers.forEach((h) => {
        const arrow = h.querySelector(".sort-arrow");
        if (arrow) arrow.textContent = h === th ? (state.order === "desc" ? "▼" : "▲") : "";
      });

      sortTable(table, key, state.order);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("table:has(th[data-sort])").forEach(setupSortableTable);
});
