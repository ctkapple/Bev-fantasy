import { NAME_COLORS } from "../../lib/people.js";
import { projectPlayoffOdds } from "./playoff-odds-model.mjs";
import { getPlayoffOddsData } from "./sleeper-client.js";

const byId = id => document.getElementById(`playoff-odds-${id}`);
const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => entities[char]);
const percentages = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const simulationCount = new Intl.NumberFormat("en-US");
const seedBands = [1, 4, 8, 13, 19, 27, 42, 65];
const missBands = [1, 5, 15, 30, 55, 80];
const byeView = -1;
const fallbackColors = ["#7aa5d4", "#dd926e", "#8cc49a", "#a78bfa", "#b497d0", "#cfad65", "#7dc8c4", "#c783ad"];
const messages = {
  unavailable: "Sleeper standings are currently unavailable.",
  unsupported: "Playoff odds are unavailable for this league’s current playoff format.",
  early: "Playoff odds will appear after three completed regular-season weeks.",
  standings: "Waiting for a complete standings update from Sleeper.",
  scores: "Waiting for completed weekly scores for every team.",
  schedule: "Waiting for the full remaining regular-season schedule from Sleeper.",
  bracket: "Waiting for Sleeper’s playoff bracket to match the final standings.",
};

function formatOdds(count, { trials, status }) {
  const fraction = count / trials;
  if (status === "simulated" && fraction < 0.001) return "<0.1%";
  if (status === "simulated" && fraction > 0.999) return ">99.9%";
  return percentages.format(fraction);
}

function heat(count, board, isMiss = false) {
  if (!count) {
    const desc = board.status === "final" ? "0%" : "No outcomes observed in the simulations";
    return `<span class="playoff-cell playoff-zero"><span aria-hidden="true">–</span><span class="sr-only">${desc}</span></span>`;
  }
  const percentage = count * 100 / board.trials;
  const band = 1 + (isMiss ? missBands : seedBands).filter(threshold => percentage >= threshold).length;
  return `<span class="playoff-cell" data-band="${band}">${escapeHtml(formatOdds(count, board))}</span>`;
}

function teamColor(team) {
  return Object.hasOwn(NAME_COLORS, team.managerName) ? NAME_COLORS[team.managerName] :
    fallbackColors[(team.rosterId - 1) % fallbackColors.length];
}

function identity(team, showRecord = true) {
  const name = team.teamName || team.managerName || `Roster ${team.rosterId}`;
  const managerName = team.managerName && team.managerName !== name ?
    `${escapeHtml(team.managerName)} <span aria-hidden="true">·</span> ` : "";
  const record = `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ""}`;
  const initials = name.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  const avatar = team.avatar && !team.avatar.startsWith("https://placehold.co/")
    ? `<img src="${escapeHtml(team.avatar)}" alt="" loading="lazy" decoding="async">` : "";
  return `<span class="playoff-team">
    <span class="playoff-avatar" aria-hidden="true">${escapeHtml(initials)}${avatar}</span>
    <span class="playoff-team-text"><strong>${escapeHtml(name)}</strong>
      ${showRecord ? `<span class="playoff-record">${managerName}<span>${record}</span></span>` : ""}
    </span></span>`;
}

function total(team, board, forMobile = false) {
  const label = board.status === "final" ? (team.qualify ? "Qualified" : "Missed") : formatOdds(team.qualify, board);
  const missed = board.status === "final" && !team.qualify ? " playoff-total-missed" : "";
  return `<span class="playoff-total${missed}">${forMobile ? '<span class="sr-only">Make playoffs </span>' : ""}${escapeHtml(label)}</span>`;
}

function inspect(board, playoffTeams, outcome) {
  const byes = outcome === byeView;
  const miss = outcome === playoffTeams;
  const final = board.status === "final";
  const countFor = row => byes ? row.outcomes.slice(0, board.byeCount).reduce((sum, count) => sum + count, 0) : row.outcomes[outcome];
  const ranked = board.rows.filter(row => countFor(row) > 0).sort((a, b) => countFor(b) - countFor(a));
  const title = byes || (!final && board.byeCount === 1 && outcome === 0)
    ? (final ? "1st round byes" : "1st round bye odds")
    : miss ? (final ? "Missed playoffs" : "Miss playoffs odds")
      : `Seed ${outcome + 1}${final ? "" : " odds"}`;
  const byeLabel = board.byeCount === 1 ? "Seed 1" : "Seeds 1 and 2";
  byId("inspect-title").textContent = title;
  byId("inspect-note").textContent = byes ? byeLabel : miss
    ? (final ? `${ranked.length} teams missed the playoffs` : "Highest chances of missing")
    : outcome < board.byeCount ? "First-round bye" : "";
  byId("leaders").innerHTML = ranked.slice(0, 3).map(team => `<li style="--team-color:${teamColor(team)}">
    ${final ? "" : `<strong class="playoff-leader-odds">${escapeHtml(formatOdds(countFor(team), board))}</strong>`}
    ${identity(team, false)}</li>`).join("");
  byId("grid-head").querySelectorAll("button[data-outcome]").forEach(button => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.outcome) === outcome));
  });
  byId("grid-body").querySelectorAll("[data-column]").forEach(cell => {
    const column = Number(cell.dataset.column);
    cell.classList.toggle("playoff-selected", byes ? column < board.byeCount : column === outcome);
  });
}

function renderGrid(board, playoffTeams) {
  const final = board.status === "final";
  const positions = Array.from({ length: playoffTeams }, (_, index) => index);
  byId("content").addEventListener("error", event => {
    if (event.target.matches(".playoff-avatar img")) event.target.hidden = true;
  }, true);
  byId("grid-title").textContent = final ? "Final playoff seeds" : "Seed probabilities";
  byId("seed-columns").span = playoffTeams;
  byId("grid-head").innerHTML = `
    <tr><th scope="col" rowspan="2" class="playoff-team-column">Team</th>
      <th scope="colgroup" colspan="${playoffTeams}" class="playoff-seed-group">
        <button type="button" data-outcome="${byeView}" class="playoff-bye-toggle">${final ? "Byes" : "Bye odds"}</button>Playoff seeds
      </th>
      <th scope="col" rowspan="2" class="playoff-miss"><button type="button" data-outcome="${playoffTeams}">Miss playoffs</button></th>
      <th scope="col" rowspan="2" class="playoff-make">Make playoffs</th>
    </tr>
    <tr>${positions.map(index => {
      const isBye = index < board.byeCount;
      return `<th scope="col" class="playoff-seed-header"><button type="button" data-outcome="${index}"
        aria-label="Inspect seed ${index + 1}${isBye ? ", first-round bye" : ""}">
        ${index + 1}${isBye ? '<span class="playoff-bye">Bye</span>' : ""}</button></th>`;
    }).join("")}</tr>`;
  byId("grid-body").innerHTML = board.rows.map(team => `
    <tr style="--team-color:${teamColor(team)}">
      <th scope="row">${identity(team)}</th>
      ${positions.map(index => `<td class="playoff-seed" data-column="${index}">${heat(team.outcomes[index], board)}</td>`).join("")}
      <td class="playoff-miss" data-column="${playoffTeams}">${heat(team.outcomes[playoffTeams], board, true)}</td>
      <td class="playoff-make">${total(team, board)}</td>
    </tr>`).join("");
  byId("team-list").innerHTML = board.rows.map(team => `
    <details class="playoff-mobile-team" style="--team-color:${teamColor(team)}">
      <summary>${identity(team)}${total(team, board, true)}<span class="playoff-chevron" aria-hidden="true"></span></summary>
      <dl class="playoff-outcomes">
        ${positions.map(index => `<div><dt>Seed ${index + 1}${index < board.byeCount ? " · Bye" : ""}</dt>
          <dd>${heat(team.outcomes[index], board)}</dd></div>`).join("")}
        <div class="playoff-mobile-miss"><dt>Miss playoffs</dt><dd>${heat(team.outcomes[playoffTeams], board, true)}</dd></div>
      </dl>
    </details>`).join("");
  byId("grid-head").addEventListener("click", event => {
    const button = event.target.closest("button[data-outcome]");
    if (button) inspect(board, playoffTeams, Number(button.dataset.outcome));
  });
  inspect(board, playoffTeams, byeView);
}

function rules(data, byeCount) {
  const field = data.divisions
    ? `The division winners take seeds 1 and 2. ${data.playoffTeams - 2} wild cards fill the remaining spots.`
    : `The top ${data.playoffTeams} teams qualify.`;
  const byes = byeCount === 1 ? "Seed 1 gets a first-round bye." : "Seeds 1 and 2 get first-round byes.";
  const median = data.medianGame ? " Regular-season records include the weekly median game." : "";
  const reseed = data.reseeds ? " The bracket reseeds after round one." : "";
  return `${field} ${byes}${reseed} Standings use overall record, then Points For and higher Points Against.${median}`;
}

async function render() {
  const config = byId("league-config");
  if (!config) return;
  const status = byId("status");
  const data = await getPlayoffOddsData(JSON.parse(config.textContent));
  if (data?.season) byId("title").textContent = `${data.season} Playoff Odds`;
  const board = await projectPlayoffOdds(data);
  if (!board.rows) {
    status.textContent = messages[board.status];
    return;
  }

  const final = board.status === "final";
  byId("week").textContent = final ? "Final results" : `Through Week ${data.completedWeek}`;
  byId("week").hidden = false;
  status.textContent = data.stale
    ? `Sleeper is unavailable. Showing the snapshot from ${new Date(data.fetchedAt).toLocaleString()}.` : "";
  status.hidden = !data.stale;
  byId("rules").textContent = rules(data, board.byeCount);
  byId("method").textContent = final ? "Sleeper’s opening playoff bracket confirms the final field and seeds."
    : `The estimate runs ${simulationCount.format(board.trials)} seasons on the remaining schedule. Each team draws from its own completed weekly scores. Exact standings ties are randomized. A dash marks an outcome with no examples in the simulations.`;
  renderGrid(board, data.playoffTeams);
  byId("content").hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  render().catch(error => {
    console.warn("[playoff-odds] Unable to render the board:", error);
    const status = byId("status");
    if (!status) return;
    status.textContent = messages.unavailable;
    status.hidden = false;
  });
});
