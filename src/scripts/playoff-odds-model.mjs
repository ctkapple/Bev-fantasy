import { addResult, schedulePairings, seededOddsRandom } from "./odds-simulation.mjs";

const SIMULATIONS = 100_000;
const MIN_SCORED_WEEKS = 3;

function winRate({ wins, losses, ties }) {
  return (wins + ties / 2) / (wins + losses + ties || 1);
}

function compareStandings(a, b) {
  return winRate(b) - winRate(a) || b.pf - a.pf || b.pa - a.pa;
}

function playoffSeeds(ranked, { divisions, playoffTeams }) {
  if (divisions === 0) return ranked.slice(0, playoffTeams);
  const winners = [...new Set(ranked.map(team => team.division))]
    .map(division => ranked.find(team => team.division === division));
  return [...winners, ...ranked.filter(team => !winners.includes(team))].slice(0, playoffTeams);
}

function bracketConfirms(seeds, bracket, byeCount) {
  if (!bracket?.some(match => match.p === 1)) return false;
  // The live endpoint can contain provisional pairings. Once the season ends,
  // confirm each first-round matchup and each bye against the published bracket.
  const firstRound = bracket.filter(match => match.r === 1 && match.p == null);
  if (firstRound.length * 2 !== seeds.length - byeCount) return false;
  const openingSlots = seeds.slice(byeCount).map(team => team.rosterId);
  for (let i = 0; i < openingSlots.length / 2; i += 1) {
    const a = openingSlots[i];
    const b = openingSlots[openingSlots.length - 1 - i];
    if (!firstRound.some(({ t1, t2 }) => (t1 === a && t2 === b) || (t1 === b && t2 === a))) return false;
  }
  const openingIds = new Set(openingSlots);
  const directEntrants = new Set(bracket.filter(match => match.r === 2 && match.p == null)
    .flatMap(({ t1, t2 }) => [t1, t2]).filter(id => id != null && !openingIds.has(id)));
  return directEntrants.size === byeCount && seeds.slice(0, byeCount).every(team => directEntrants.has(team.rosterId));
}

function readScoreHistory(data, standings, scoredWeeks) {
  const history = new Map(standings.map(team => [team.rosterId, []]));
  for (let week = data.firstWeek; week <= data.completedWeek; week += 1) {
    const rows = data.matchupsByWeek[week];
    if (rows?.length !== standings.length || new Set(rows.map(row => row.roster_id)).size !== standings.length) {
      return null;
    }
    for (const { roster_id: id, points } of rows) {
      if (!Number.isFinite(points) || !history.has(id)) return null;
      history.get(id).push(Math.round(points * 100));
    }
  }
  return [...history.values()].every(scores => scores.length === scoredWeeks) ? history : null;
}

async function simulate(data, standings, schedule, history) {
  const random = seededOddsRandom();
  const idIndex = new Map(standings.map((team, index) => [team.rosterId, index]));
  const scheduleIndexes = schedule.map(week => week.map(pair => pair.map(id => idIndex.get(id))));
  const scoresByTeam = standings.map(team => history.get(team.rosterId));
  const counts = new Map(standings.map(team => [team.rosterId, Array(data.playoffTeams + 1).fill(0)]));
  const scores = Array(standings.length);
  const simulated = standings.map(team => ({ ...team, coin: 0 }));
  const ranked = [...simulated];

  for (let run = 0; run < SIMULATIONS; run += 1) {
    // Keep the tab responsive while a phone simulates the full schedule.
    if (run && run % 5000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    for (let i = 0; i < standings.length; i += 1) {
      const base = standings[i];
      const team = simulated[i];
      team.wins = base.wins;
      team.losses = base.losses;
      team.ties = base.ties;
      team.pf = base.pf;
      team.pa = base.pa;
      team.coin = random();
      ranked[i] = team;
    }
    for (const week of scheduleIndexes) {
      for (let i = 0; i < simulated.length; i += 1) {
        const history = scoresByTeam[i];
        scores[i] = history[Math.floor(random() * history.length)];
        simulated[i].pf += scores[i];
      }
      for (const [a, b] of week) {
        simulated[a].pa += scores[b];
        simulated[b].pa += scores[a];
        addResult(simulated[a], scores[a], scores[b]);
        addResult(simulated[b], scores[b], scores[a]);
      }
      if (data.medianGame) {
        const ordered = [...scores].sort((a, b) => a - b);
        const median = (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2;
        simulated.forEach((team, i) => addResult(team, scores[i], median));
      }
    }
    ranked.sort((a, b) => compareStandings(a, b) || a.coin - b.coin);
    playoffSeeds(ranked, data).forEach((team, index) => { counts.get(team.rosterId)[index] += 1; });
  }

  for (const outcomes of counts.values()) {
    outcomes[data.playoffTeams] = SIMULATIONS - outcomes.reduce((total, count) => total + count, 0);
  }
  return counts;
}

function makeBoard(standings, counts, byeCount, trials, status) {
  const rows = standings.map(team => {
    const outcomes = counts.get(team.rosterId);
    const qualify = trials - outcomes[outcomes.length - 1];
    return { ...team, outcomes, qualify };
  }).sort((a, b) => b.qualify - a.qualify || compareStandings(a, b) || a.rosterId - b.rosterId);
  return { status, rows, trials, byeCount };
}

export async function projectPlayoffOdds(data) {
  if (!data) return { status: "unavailable" };
  const { standings, playoffTeams, divisions, firstWeek, lastRegularWeek, completedWeek } = data;
  if (![6, 7].includes(playoffTeams) || ![0, 2].includes(divisions)) return { status: "unsupported" };
  const scoredWeeks = completedWeek - firstWeek + 1;
  const regularComplete = completedWeek >= lastRegularWeek;
  if (!regularComplete && scoredWeeks < MIN_SCORED_WEEKS) return { status: "early" };

  const expectedGames = scoredWeeks * (data.medianGame ? 2 : 1);
  if (!Number.isInteger(scoredWeeks) || !Array.isArray(standings) || standings.length !== data.rosterCount ||
      standings.length <= playoffTeams || new Set(standings.map(team => team.rosterId)).size !== standings.length ||
      standings.some(team => !Number.isFinite(team.pf) || !Number.isFinite(team.pa) ||
        team.wins + team.losses + team.ties !== expectedGames) ||
      (divisions && new Set(standings.map(team => team.division)).size !== divisions) ||
      (divisions && standings.some(team => !Number.isInteger(team.division) || team.division < 1))) {
    return { status: "standings" };
  }

  const byeCount = 8 - playoffTeams;
  if (regularComplete) {
    const ranked = [...standings].sort((a, b) => compareStandings(a, b) || a.rosterId - b.rosterId);
    const seeds = playoffSeeds(ranked, data);
    if (!bracketConfirms(seeds, data.winnersBracket, byeCount)) return { status: "bracket" };
    const counts = new Map(standings.map(team => {
      const seed = seeds.indexOf(team);
      const outcomes = Array(playoffTeams + 1).fill(0);
      outcomes[seed === -1 ? playoffTeams : seed] = 1;
      return [team.rosterId, outcomes];
    }));
    return makeBoard(standings, counts, byeCount, 1, "final");
  }

  const history = readScoreHistory(data, standings, scoredWeeks);
  if (!history) return { status: "scores" };
  const schedule = schedulePairings(data, standings);
  if (!schedule) return { status: "schedule" };
  const counts = await simulate(data, standings, schedule, history);
  return makeBoard(standings, counts, byeCount, SIMULATIONS, "simulated");
}
