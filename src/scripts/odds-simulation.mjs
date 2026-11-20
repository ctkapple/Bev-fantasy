export function seededOddsRandom() {
  let seed = 48619;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function addResult(roster, score, opponentScore) {
  if (score > opponentScore) roster.wins += 1;
  else if (score < opponentScore) roster.losses += 1;
  else roster.ties += 1;
}

export function schedulePairings(data, standings) {
  const remaining = [];
  const rosterIds = new Set(standings.map(roster => roster.rosterId));
  for (let week = data.completedWeek + 1; week <= data.lastRegularWeek; week += 1) {
    const groups = new Map();
    const scheduled = new Set();
    for (const matchup of data.matchupsByWeek[week] || []) {
      const { roster_id: rosterId, matchup_id: matchupId } = matchup;
      if (matchupId == null || !rosterIds.has(rosterId) || scheduled.has(rosterId)) continue;
      scheduled.add(rosterId);
      if (!groups.has(matchupId)) groups.set(matchupId, []);
      groups.get(matchupId).push(rosterId);
    }
    const pairs = [...groups.values()];
    if (scheduled.size !== rosterIds.size || pairs.some(pair => pair.length !== 2)) return null;
    remaining.push(pairs);
  }
  return remaining;
}
