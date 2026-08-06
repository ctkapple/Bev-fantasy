function readJson(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

function pairKey(id1, id2) {
  return [id1, id2].sort().join("-");
}

function render(managers, matchupsByPair, id1, id2) {
  const result = document.getElementById("h2h-result");
  if (!result) return;
  if (!id1 || !id2 || id1 === id2) {
    result.innerHTML = `<p class="text-text-secondary">Please select two different managers to compare head-to-head</p>`;
    return;
  }
  const games = matchupsByPair[pairKey(id1, id2)] || [];
  if (games.length === 0) {
    result.innerHTML = `<p class="text-text-secondary">These managers haven't played each other yet.</p>`;
    return;
  }

  let wins1 = 0;
  let wins2 = 0;
  let ties = 0;
  let closest = null;
  const gamesSorted = [...games].sort((a, b) => Number(a.season) - Number(b.season) || a.week - b.week);

  for (const g of gamesSorted) {
    const [score1, score2] = g.m1 === id1 ? [g.score1, g.score2] : [g.score2, g.score1];
    if (score1 > score2) wins1++;
    else if (score2 > score1) wins2++;
    else ties++;
    const margin = Math.abs(score1 - score2);
    if (!closest || margin < closest.margin) closest = { season: g.season, week: g.week, margin };
  }

  const name1 = managers[id1]?.displayName || "Unknown";
  const name2 = managers[id2]?.displayName || "Unknown";

  result.innerHTML = `
    <div class="text-2xl font-bold mb-2">${wins1} - ${wins2}${ties ? ` - ${ties}` : ""}</div>
    <p class="text-text-secondary text-sm mb-4">${name1} vs ${name2} across ${games.length} matchup${games.length === 1 ? "" : "s"}</p>
    ${closest ? `<p class="text-sm">Closest game: '${closest.season} Wk${closest.week} — decided by ${closest.margin.toFixed(1)} pts</p>` : ""}
    <div class="mt-6 overflow-x-auto">
      <table class="stat-table mx-auto max-w-md">
        <thead><tr><th class="px-3 py-2">Season</th><th class="px-3 py-2">Wk</th><th class="px-3 py-2 text-right">${name1}</th><th class="px-3 py-2 text-right">${name2}</th></tr></thead>
        <tbody>
          ${gamesSorted
            .map((g) => {
              const [s1, s2] = g.m1 === id1 ? [g.score1, g.score2] : [g.score2, g.score1];
              return `<tr><td class="px-3 py-2">${g.season}</td><td class="px-3 py-2">${g.week}</td><td class="px-3 py-2 text-right ${s1 > s2 ? "win" : ""}">${s1.toFixed(1)}</td><td class="px-3 py-2 text-right ${s2 > s1 ? "win" : ""}">${s2.toFixed(1)}</td></tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  const managers = readJson("h2h-managers");
  const matchupsByPair = readJson("h2h-matchups");
  const sel1 = document.getElementById("manager1-select");
  const sel2 = document.getElementById("manager2-select");
  if (!managers || !matchupsByPair || !sel1 || !sel2) return;

  const update = () => render(managers, matchupsByPair, sel1.value, sel2.value);
  sel1.addEventListener("change", update);
  sel2.addEventListener("change", update);
});
