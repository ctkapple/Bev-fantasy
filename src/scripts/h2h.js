// Head-to-Head comparison. Ported from the original updateH2H() in jrwll.html:
// two manager cards (avatar, total/avg points, longest win streak, biggest
// blowout, "Certified <opponent> Hater") flanking a center column with the
// all-time record and the closest game between them.

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

function topPlayer(pointsById, playerInfo) {
  const ids = Object.keys(pointsById || {});
  if (ids.length === 0) return { name: "N/A", points: "0.00" };
  const topId = ids.reduce((a, b) => (pointsById[a] > pointsById[b] ? a : b));
  return {
    name: playerInfo?.[topId]?.name || "Unknown Player",
    points: pointsById[topId].toFixed(2),
  };
}

function managerCard(m, stats, opponentName, nemesis, hasWin, isReigning) {
  return `
    <div class="lg:col-span-2 bg-bg/40 p-4 rounded-xl border border-border flex flex-col items-center space-y-3">
      <img src="${m.avatar}" alt="${m.displayName}"
        class="w-24 h-24 rounded-full object-cover border-4 border-accent-500 cursor-pointer hover:scale-110 transition-transform"
        onclick="window.expandAvatar && window.expandAvatar(this.src)">
      <p class="font-extrabold text-xl lg:text-2xl text-accent-500">${m.displayName}${isReigning ? ' <span title="Reigning Champ">👑</span>' : ""}</p>
      <div class="text-sm text-text-secondary space-y-2 text-left w-full">
        <p class="flex justify-between"><span>Total Points:</span> <span class="font-bold text-text-primary">${stats.totalPoints.toFixed(2)}</span></p>
        <p class="flex justify-between"><span>Avg Points:</span> <span class="font-bold text-text-primary">${stats.avgPoints.toFixed(2)}</span></p>
        <p class="flex justify-between"><span>Longest Win Streak:</span> <span class="font-bold text-text-primary">${stats.longestStreak}</span></p>
      </div>
      <hr class="w-full border-t border-border my-2">
      <div class="text-sm text-text-secondary space-y-2 text-left w-full">
        <p class="font-bold text-text-primary">💥 Biggest Blowout:</p>
        ${
          hasWin
            ? `<p class="text-xs ml-2">${stats.blowout.own.toFixed(2)} to ${stats.blowout.opp.toFixed(2)} (Margin: ${stats.blowout.margin.toFixed(2)})</p>
               <p class="text-xs ml-2 text-text-muted">${stats.blowout.season}, Week ${stats.blowout.week}</p>`
            : '<p class="text-xs ml-2">Still searching for that first W</p>'
        }
        <p class="font-bold text-text-primary mt-2">💀 Certified ${opponentName} Hater:</p>
        <p class="text-xs ml-2">${nemesis.name} — ${nemesis.points} total points</p>
      </div>
    </div>`;
}

function render(aggregate, id1, id2) {
  const result = document.getElementById("h2h-result");
  if (!result) return;

  if (!id1 || !id2 || id1 === id2) {
    result.innerHTML = `<p class="text-text-secondary">Please select two members to compare head-to-head</p>`;
    return;
  }

  const m1 = aggregate.managers[id1];
  const m2 = aggregate.managers[id2];
  const history = [...(aggregate.matchupsByManagerPair[pairKey(id1, id2)] || [])].sort(
    (a, b) => Number(a.season) - Number(b.season) || a.week - b.week
  );

  if (history.length === 0) {
    result.innerHTML = `<p class="text-text-secondary">These managers have not played each other in the regular season.</p>`;
    return;
  }

  let wins1 = 0;
  let wins2 = 0;
  let ties = 0;
  let totalPoints1 = 0;
  let totalPoints2 = 0;
  let currentStreak1 = 0;
  let currentStreak2 = 0;
  let longestStreak1 = 0;
  let longestStreak2 = 0;
  let closestGame = { margin: Infinity, score1: 0, score2: 0, season: "", week: 0 };
  let blowout1 = { margin: 0, own: 0, opp: 0, season: "", week: 0 };
  let blowout2 = { margin: 0, own: 0, opp: 0, season: "", week: 0 };
  const playerPointsFor1 = {};
  const playerPointsFor2 = {};

  for (const match of history) {
    const isFirst = match.m1 === id1;
    const score1 = isFirst ? match.score1 : match.score2;
    const score2 = isFirst ? match.score2 : match.score1;
    const pts1 = isFirst ? match.playerPoints1 : match.playerPoints2;
    const pts2 = isFirst ? match.playerPoints2 : match.playerPoints1;

    totalPoints1 += score1;
    totalPoints2 += score2;

    if (score1 > score2) {
      wins1++;
      currentStreak1++;
      currentStreak2 = 0;
    } else if (score2 > score1) {
      wins2++;
      currentStreak2++;
      currentStreak1 = 0;
    } else if (score1 > 0) {
      ties++;
      currentStreak1 = 0;
      currentStreak2 = 0;
    }
    longestStreak1 = Math.max(longestStreak1, currentStreak1);
    longestStreak2 = Math.max(longestStreak2, currentStreak2);

    const margin = Math.abs(score1 - score2);
    if (margin > 0 && margin < closestGame.margin) {
      closestGame = { margin, score1, score2, season: match.season, week: match.week };
    }
    if (score1 > score2 && margin > blowout1.margin) {
      blowout1 = { margin, own: score1, opp: score2, season: match.season, week: match.week };
    }
    if (score2 > score1 && margin > blowout2.margin) {
      blowout2 = { margin, own: score2, opp: score1, season: match.season, week: match.week };
    }

    for (const [pId, pts] of Object.entries(pts1 || {})) {
      playerPointsFor1[pId] = (playerPointsFor1[pId] || 0) + pts;
    }
    for (const [pId, pts] of Object.entries(pts2 || {})) {
      playerPointsFor2[pId] = (playerPointsFor2[pId] || 0) + pts;
    }
  }

  const stats1 = {
    totalPoints: totalPoints1,
    avgPoints: totalPoints1 / history.length,
    longestStreak: longestStreak1,
    blowout: blowout1,
  };
  const stats2 = {
    totalPoints: totalPoints2,
    avgPoints: totalPoints2 / history.length,
    longestStreak: longestStreak2,
    blowout: blowout2,
  };

  result.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-5 items-start gap-6 text-center">
      ${managerCard(m1, stats1, m2.displayName, topPlayer(playerPointsFor1, aggregate.playerInfo), wins1 > 0, m1.userId === aggregate.reigningChampionId)}
      <div class="flex flex-col items-center py-4 lg:col-span-1">
        <p class="text-5xl lg:text-6xl font-black tracking-tighter">${wins1}-${wins2}${ties > 0 ? `-${ties}` : ""}</p>
        <p class="text-lg text-text-secondary font-medium -mt-2">All-Time Record</p>
        <hr class="w-2/3 border-t border-border my-4">
        <div class="text-sm text-text-secondary space-y-1 w-full">
          <p class="font-bold text-text-primary">🤝 Closest Game:</p>
          <p class="text-xs">${closestGame.score1.toFixed(2)} vs ${closestGame.score2.toFixed(2)} (Margin: ${closestGame.margin.toFixed(2)})</p>
          <p class="text-xs text-text-muted">${closestGame.season}, Week ${closestGame.week}</p>
        </div>
      </div>
      ${managerCard(m2, stats2, m1.displayName, topPlayer(playerPointsFor2, aggregate.playerInfo), wins2 > 0, m2.userId === aggregate.reigningChampionId)}
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  const aggregate = readJson("h2h-aggregate");
  const sel1 = document.getElementById("manager1-select");
  const sel2 = document.getElementById("manager2-select");
  if (!aggregate || !sel1 || !sel2) return;

  const update = () => render(aggregate, sel1.value, sel2.value);
  sel1.addEventListener("change", update);
  sel2.addEventListener("change", update);
});
