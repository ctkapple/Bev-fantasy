const SIMULATIONS = 5000;

function winPct({ wins, losses, ties }) {
  return (wins + ties / 2) / (wins + losses + ties || 1);
}

function compareStandings(a, b) {
  return winPct(b) - winPct(a) || b.pf - a.pf || a.rosterId - b.rosterId;
}

function nonPlayoffOrder(standings, seeds) {
  const playoffIds = new Set(seeds.map(roster => roster.rosterId));
  return standings.filter(roster => !playoffIds.has(roster.rosterId))
    .sort((a, b) => a.ppts - b.ppts || compareStandings(b, a));
}

function getPlayoffPlan(bracket, standings, playoffTeams) {
  const matches = [...(bracket ?? [])].sort((a, b) => a.r - b.r || a.m - b.m);
  const final = matches.find(match => match.p === 1);
  if (!final) return null;

  // Direct bracket entrants include the team with the bye. Map them to seed
  // numbers so this same bracket can run with different simulated qualifiers.
  const entrants = new Set(matches.flatMap(match => [
    match.t1_from ? null : match.t1, match.t2_from ? null : match.t2,
  ]));
  const seeds = standings.filter(roster => entrants.has(roster.rosterId));
  if (seeds.length !== playoffTeams) return null;

  const matchesById = new Map(matches.map(match => [match.m, match]));
  const titlePath = new Set();
  function addTitleMatch(match) {
    if (!match || titlePath.has(match.m)) return;
    titlePath.add(match.m);
    addTitleMatch(matchesById.get(match.t1_from?.w));
    addTitleMatch(matchesById.get(match.t2_from?.w));
  }
  addTitleMatch(final);
  return { matches, seeds, titlePath, seedIndex: new Map(seeds.map((r, i) => [r.rosterId, i])) };
}

function playoffOrder(seeds, plan, winner, useResults) {
  const seedIndex = new Map(seeds.map((roster, index) => [roster.rosterId, index]));
  const results = new Map();
  const eliminated = new Map();
  const placements = new Map();
  const teamIn = (rosterId, from) => {
    if (from) return results.get(from.w ?? from.l)?.[from.w == null ? "l" : "w"];
    return seeds[plan.seedIndex.get(rosterId)]?.rosterId;
  };

  for (const match of plan.matches) {
    const a = teamIn(match.t1, match.t1_from);
    const b = teamIn(match.t2, match.t2_from);
    const actual = useResults && seedIndex.has(match.w) && seedIndex.has(match.l) && match.w !== match.l;
    if (!actual && (a == null || b == null || a === b)) continue;

    const w = actual ? match.w : winner(a, b, seedIndex);
    const l = actual ? match.l : w === a ? b : a;
    results.set(match.m, { w, l });
    if (plan.titlePath.has(match.m)) eliminated.set(l, match.r);
    if (match.p >= 1 && match.p < seeds.length) {
      placements.set(w, match.p);
      placements.set(l, match.p + 1);
    }
  }

  const finishingOrder = Array(seeds.length).fill(null);
  for (const [id, place] of placements) finishingOrder[place - 1] = seeds[seedIndex.get(id)];
  const unplaced = seeds.filter(roster => !placements.has(roster.rosterId))
    .sort((a, b) => (eliminated.get(b.rosterId) || 0) - (eliminated.get(a.rosterId) || 0));
  return finishingOrder.map(roster => roster || unplaced.shift()).reverse();
}

function schedulePairings(data, standings) {
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

function simulate(data, standings, projected, seeds, plan, regularComplete) {
  const schedule = schedulePairings(data, standings);
  const history = new Map(standings.map(roster => [roster.rosterId, []]));
  for (let week = data.firstWeek; week <= data.completedWeek; week += 1) {
    for (const matchup of data.matchupsByWeek[week] || []) {
      if (Number.isFinite(matchup.points)) history.get(matchup.roster_id)?.push(matchup.points);
    }
  }
  if (!schedule || [...history.values()].some(scores => scores.length < 3)) return null;

  // Resample weekly scores and use the observed Max PF–PF gap to estimate
  // the extra points an optimal lineup would have scored each future week.
  const weeksPlayed = data.completedWeek - data.firstWeek + 1;
  const surplus = new Map(standings.map(r => [r.rosterId, Math.max(0, r.ppts - r.pf) / weeksPlayed]));
  const slots = new Map(projected.map((roster, slot) => [roster.rosterId, slot]));
  const exact = new Map(standings.map(roster => [roster.rosterId, 0]));
  const first = new Map(exact);
  let seed = 48619;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  function weeklyScore(rosterId) {
    const scores = history.get(rosterId);
    return scores[Math.floor(random() * scores.length)];
  }
  function addResult(roster, score, opponentScore) {
    if (score > opponentScore) roster.wins += 1;
    else if (score < opponentScore) roster.losses += 1;
    else roster.ties += 1;
  }
  function simulatedWinner(a, b, seedIndex) {
    const margin = weeklyScore(a) - weeklyScore(b);
    return margin > 0 || (margin === 0 && seedIndex.get(a) < seedIndex.get(b)) ? a : b;
  }

  for (let run = 0; run < SIMULATIONS; run += 1) {
    const simulated = standings.map(roster => ({ ...roster }));
    const byId = new Map(simulated.map(roster => [roster.rosterId, roster]));
    for (const week of schedule) {
      const scores = new Map();
      for (const roster of simulated) {
        const score = weeklyScore(roster.rosterId);
        scores.set(roster.rosterId, score);
        roster.pf += score;
        roster.ppts += score + surplus.get(roster.rosterId) * (0.5 + random());
      }
      for (const [a, b] of week) {
        addResult(byId.get(a), scores.get(a), scores.get(b));
        addResult(byId.get(b), scores.get(b), scores.get(a));
      }
      if (data.medianGame) {
        const rankedScores = [...scores.values()].sort((a, b) => a - b);
        const median = (rankedScores[Math.floor((rankedScores.length - 1) / 2)] + rankedScores[Math.floor(rankedScores.length / 2)]) / 2;
        for (const roster of simulated) addResult(roster, scores.get(roster.rosterId), median);
      }
    }
    simulated.sort(compareStandings);
    const qualifiers = regularComplete ? seeds : simulated.slice(0, data.playoffTeams);
    const nonPlayoff = nonPlayoffOrder(simulated, qualifiers);
    const firstId = nonPlayoff[0].rosterId;
    first.set(firstId, first.get(firstId) + 1);
    const order = plan ? [...nonPlayoff, ...playoffOrder(qualifiers, plan, simulatedWinner, regularComplete)] : nonPlayoff;
    order.forEach(({ rosterId }, slot) => {
      if (slots.get(rosterId) === slot) exact.set(rosterId, exact.get(rosterId) + 1);
    });
  }
  return { exact, first };
}

export function projectDraftBoard(data) {
  const standings = [...data.rosterSnapshots].sort(compareStandings);
  const regularComplete = data.completedWeek >= data.lastRegularWeek;
  const plan = getPlayoffPlan(data.winnersBracket, standings, data.playoffTeams);
  const seeds = regularComplete && plan ? plan.seeds : standings.slice(0, data.playoffTeams);
  const nonPlayoff = nonPlayoffOrder(standings, seeds);
  const chooseHigherSeed = (a, b, seedIndex) => seedIndex.get(a) < seedIndex.get(b) ? a : b;
  const playoff = regularComplete && plan ? playoffOrder(seeds, plan, chooseHigherSeed, true) : [...seeds].reverse();
  const projected = [...nonPlayoff, ...playoff];
  const byRosterId = new Map(standings.map(roster => [roster.rosterId, roster]));
  const owners = data.tradedPicks && new Map(data.tradedPicks
    .filter(pick => Number(pick.season) === Number(data.season) + 1 && pick.round === 1)
    .map(pick => [pick.roster_id, pick.owner_id]));

  const locked = new Set();
  if (regularComplete && plan) {
    nonPlayoff.forEach(roster => locked.add(roster.rosterId));
    const complete = match => byRosterId.has(match.w) && byRosterId.has(match.l) && match.w !== match.l;
    const placementMatches = plan.matches.filter(match => match.p >= 1 && match.p < playoff.length && complete(match));
    for (const match of placementMatches) {
      locked.add(match.w);
      locked.add(match.l);
    }
    if (locked.size === projected.length - 1 || plan.matches.every(complete)) {
      playoff.forEach(roster => locked.add(roster.rosterId));
    }
  }
  const estimates = locked.size === projected.length ? null : simulate(data, standings, projected, seeds, plan, regularComplete);
  const rows = projected.map((origin, index) => {
    const { rosterId } = origin;
    const isPlayoff = index >= nonPlayoff.length;
    const isLocked = locked.has(rosterId);
    const holder = owners ? byRosterId.get(owners.get(rosterId) ?? rosterId) : null;
    return {
      origin, holder, slot: index + 1, isPlayoff, isLocked,
      isChampionPick: isLocked && index === projected.length - 1 && isPlayoff,
      slotOdds: isLocked ? 1 : estimates && (!isPlayoff || plan) ? estimates.exact.get(rosterId) / SIMULATIONS : null,
      firstOdds: regularComplete && plan ? Number(index === 0) : estimates ? estimates.first.get(rosterId) / SIMULATIONS : null,
    };
  });
  return { rows, regularComplete, hasBracket: Boolean(plan), final: locked.size === projected.length };
}
