const root = document.querySelector("#ap-poll-root");

if (root) {
  const SUPABASE_URL = "https://gkxpwopjmfdxymhsbnyh.supabase.co";
  // Publishable keys are intentionally browser-visible and carry only anon privileges.
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_DYoO_OPd_F9_HiXsiKFXpQ_xkjuimGy";
  const leagueSlug = root.dataset.league || "sb3";

  let pollState = null;
  let selectedVoterId = null;
  let ranking = [];
  let championshipTeamId = "";
  let underratedTeamId = "";
  let overratedTeamId = "";
  let submissionPending = false;
  let draggedTeamId = null;
  let notice = null;

  class PollRequestError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = "PollRequestError";
      Object.assign(this, details);
    }
  }

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function fisherYates(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  async function callRpc(functionName, parameters) {
    let response;
    try {
      response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parameters),
      });
    } catch (error) {
      throw new PollRequestError(
        "We could not reach the poll service. Check your connection and try again.",
        { cause: error, kind: "network" }
      );
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // A non-JSON gateway response is still handled as a recoverable request error.
    }

    if (!response.ok) {
      throw new PollRequestError(payload?.message || "The poll request could not be completed.", {
        status: response.status,
        code: payload?.code,
        details: payload?.details,
      });
    }

    return Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
  }

  function renderNotice() {
    if (!notice) return "";
    const role = notice.type === "success" ? "status" : "alert";
    return `<div class="poll-notice poll-notice-${escapeHtml(notice.type)}" role="${role}">
      <p>${escapeHtml(notice.message)}</p>
    </div>`;
  }

  function renderLoading() {
    root.innerHTML = `${renderNotice()}
      <section class="card" aria-labelledby="ap-poll-loading-title">
        <h1 id="ap-poll-loading-title" class="text-2xl font-bold text-accent-500">AP Poll</h1>
        <div class="bouncing-loader" aria-hidden="true"><div></div><div></div><div></div></div>
        <p class="text-center text-text-secondary" role="status">Loading the current poll…</p>
      </section>`;
  }

  function renderLoadError(error) {
    const message = error instanceof PollRequestError
      ? error.message
      : "The current poll could not be loaded.";
    root.innerHTML = `${renderNotice()}
      <section class="card poll-state-card" aria-labelledby="ap-poll-error-title">
        <p class="poll-eyebrow">Super Beef 3-Way</p>
        <h1 id="ap-poll-error-title" class="text-2xl font-bold">AP Poll unavailable</h1>
        <p class="text-text-secondary">${escapeHtml(message)}</p>
        <button type="button" class="poll-primary-button" data-action="retry-load">Try again</button>
      </section>`;
  }

  function progressMarkup(state) {
    const submitted = Number(state.submission_count) || 0;
    const eligible = Number(state.eligible_voter_count) || 0;
    return `<div class="poll-progress-wrap">
      <div class="poll-progress-copy">
        <span>Ballots submitted</span>
        <strong>${submitted} of ${eligible}</strong>
      </div>
      <progress class="poll-progress" value="${submitted}" max="${Math.max(eligible, 1)}">${submitted} of ${eligible}</progress>
    </div>`;
  }

  function submittedVotersMarkup(voters) {
    const submittedVoters = (voters || []).filter((voter) => voter.submitted);
    return `<section class="poll-submitted-card" aria-labelledby="submitted-voters-heading">
      <h2 id="submitted-voters-heading">Submitted voters</h2>
      ${submittedVoters.length > 0
        ? `<ul>${submittedVoters.map((voter) => `<li>${escapeHtml(voter.display_name)} <span>Submitted</span></li>`).join("")}</ul>`
        : '<p class="text-sm text-text-secondary">No ballots have been submitted yet.</p>'}
    </section>`;
  }

  function pollHeaderMarkup(state, statusLabel) {
    const poll = state.poll;
    return `<header class="card poll-hero">
      <div>
        <p class="poll-eyebrow">Super Beef 3-Way</p>
        <h1>${escapeHtml(poll.label)}</h1>
        <p class="text-text-secondary">Rank every team and help set the league's official AP Poll.</p>
      </div>
      <span class="poll-status-badge">${escapeHtml(statusLabel)}</span>
      ${progressMarkup(state)}
    </header>`;
  }

  function renderNoPoll() {
    root.innerHTML = `${renderNotice()}
      <section class="card poll-state-card" aria-labelledby="no-poll-title">
        <p class="poll-eyebrow">Super Beef 3-Way</p>
        <h1 id="no-poll-title">No current AP Poll</h1>
        <p class="text-text-secondary">There is no open, closed, or published poll to show right now. Check back when the next ballot opens.</p>
        <button type="button" class="poll-secondary-button" data-action="retry-load">Check again</button>
      </section>`;
  }

  function ensureValidRanking() {
    const teamIds = new Set((pollState?.teams || []).map((team) => team.id));
    const rankingIds = new Set(ranking);
    if (ranking.length !== teamIds.size || rankingIds.size !== teamIds.size || [...rankingIds].some((id) => !teamIds.has(id))) {
      ranking = fisherYates([...teamIds]);
    }
  }

  function voterOptionsMarkup() {
    return pollState.voters.map((voter) => {
      const selected = voter.id === selectedVoterId;
      const suffix = voter.submitted
        ? '<span class="poll-voter-state">Submitted</span>'
        : selected
          ? '<span class="poll-voter-state">Selected</span>'
          : "";
      return `<button
        type="button"
        class="poll-voter-button"
        data-action="select-voter"
        data-voter-id="${escapeHtml(voter.id)}"
        aria-pressed="${selected}"
        ${voter.submitted || submissionPending ? "disabled" : ""}
      ><span>${escapeHtml(voter.display_name)}</span>${suffix}</button>`;
    }).join("");
  }

  function teamSelectMarkup(name, label, selectedValue) {
    return `<label class="poll-question">
      <span>${escapeHtml(label)}</span>
      <select name="${escapeHtml(name)}" required ${submissionPending ? "disabled" : ""}>
        <option value="">Choose a team</option>
        ${pollState.teams.map((team) => `<option value="${escapeHtml(team.id)}" ${team.id === selectedValue ? "selected" : ""}>
          ${escapeHtml(team.display_name)} — ${escapeHtml(team.owner_label)}
        </option>`).join("")}
      </select>
    </label>`;
  }

  function rankingMarkup() {
    const teamsById = new Map(pollState.teams.map((team) => [team.id, team]));
    return `<ol class="poll-ranking" aria-label="Team ranking from first to fourteenth">
      ${ranking.map((teamId, index) => {
        const team = teamsById.get(teamId);
        if (!team) return "";
        return `<li class="poll-rank-item" draggable="${!submissionPending}" data-rank-item data-team-id="${escapeHtml(team.id)}">
          <span class="poll-drag-handle" aria-hidden="true">⋮⋮</span>
          <span class="poll-rank-number" aria-label="Rank ${index + 1}">${index + 1}</span>
          <span class="poll-team-copy">
            <strong>${escapeHtml(team.display_name)}</strong>
            <small>${escapeHtml(team.owner_label)}</small>
          </span>
          <span class="poll-rank-actions">
            <button type="button" data-action="move-up" aria-label="Move ${escapeHtml(team.display_name)} up one rank" ${index === 0 || submissionPending ? "disabled" : ""}>↑</button>
            <button type="button" data-action="move-down" aria-label="Move ${escapeHtml(team.display_name)} down one rank" ${index === ranking.length - 1 || submissionPending ? "disabled" : ""}>↓</button>
          </span>
        </li>`;
      }).join("")}
    </ol>`;
  }

  function ballotMarkup() {
    if (!selectedVoterId) return "";
    ensureValidRanking();
    const selectedVoter = pollState.voters.find((voter) => voter.id === selectedVoterId);
    return `<form class="poll-ballot" data-poll-ballot novalidate>
      <div class="poll-section-heading">
        <div>
          <p class="poll-step">Step 2</p>
          <h2>Rank all 14 teams</h2>
        </div>
        <p>Ballot for <strong>${escapeHtml(selectedVoter?.display_name)}</strong></p>
      </div>
      <p class="text-sm text-text-secondary">Drag teams into order, or use the move buttons. Rank 1 is your strongest team.</p>
      ${rankingMarkup()}

      <fieldset class="poll-extra-questions">
        <legend>Final picks</legend>
        <p class="text-sm text-text-secondary">Each answer is required. You may choose any team, including your own.</p>
        <div class="poll-question-grid">
          ${teamSelectMarkup("championship", "Championship favorite", championshipTeamId)}
          ${teamSelectMarkup("underrated", "Most underrated", underratedTeamId)}
          ${teamSelectMarkup("overrated", "Most overrated", overratedTeamId)}
        </div>
      </fieldset>

      <div class="poll-form-message" data-form-message role="alert"></div>
      <button type="submit" class="poll-primary-button poll-submit-button" ${submissionPending ? "disabled" : ""}>
        ${submissionPending ? "Submitting ballot…" : "Submit final ballot"}
      </button>
      <p class="poll-submit-note">Ballots cannot be edited after submission.</p>
    </form>`;
  }

  function renderOpen() {
    root.innerHTML = `${renderNotice()}
      ${pollHeaderMarkup(pollState, "Open")}
      <div class="poll-open-layout">
        <div class="poll-main-column">
          <section class="card" aria-labelledby="voter-heading">
            <p class="poll-step">Step 1</p>
            <h2 id="voter-heading">Who are you?</h2>
            <p class="text-sm text-text-secondary">Choose your name to begin. Submitted voters are locked.</p>
            <div class="poll-voter-grid">${voterOptionsMarkup()}</div>
          </section>
          ${ballotMarkup()}
        </div>
        <aside>${submittedVotersMarkup(pollState.voters)}</aside>
      </div>`;
  }

  function renderClosed() {
    root.innerHTML = `${renderNotice()}
      ${pollHeaderMarkup(pollState, "Closed")}
      <div class="poll-two-column">
        <section class="card poll-state-card" aria-labelledby="poll-closed-title">
          <h2 id="poll-closed-title">Voting is closed</h2>
          <p class="text-text-secondary">The ballots are in, but results have not been published yet. Only submission progress is available until publication.</p>
          <button type="button" class="poll-secondary-button" data-action="retry-load">Check for results</button>
        </section>
        ${submittedVotersMarkup(pollState.voters)}
      </div>`;
  }

  function hasResultField(results, field) {
    return results.some((result) => Object.hasOwn(result, field));
  }

  function renderPublished() {
    const results = Array.isArray(pollState.results) ? pollState.results : [];
    const showChampionship = hasResultField(results, "championship_votes");
    const showUnderrated = hasResultField(results, "underrated_votes");
    const showOverrated = hasResultField(results, "overrated_votes");
    const columnCount = 5 + Number(showChampionship) + Number(showUnderrated) + Number(showOverrated);

    root.innerHTML = `${renderNotice()}
      ${pollHeaderMarkup(pollState, "Published")}
      ${pollState.poll.is_demo ? `<div class="poll-demo-banner" role="note">
        <strong>Demo / sample data</strong>
        <span>These results come from deterministic sample ballots, not real league votes.</span>
      </div>` : ""}
      <section class="card poll-results-card" aria-labelledby="poll-results-title">
        <div class="poll-section-heading">
          <div>
            <p class="poll-step">Official results</p>
            <h2 id="poll-results-title">AP Poll rankings</h2>
          </div>
          <p>${Number(pollState.submission_count) || 0} ballots counted</p>
        </div>
        <div class="overflow-x-auto">
          <table class="stat-table poll-results-table">
            <thead><tr>
              <th scope="col">Rank</th>
              <th scope="col">Team</th>
              <th scope="col">AP points</th>
              <th scope="col">Avg. rank</th>
              <th scope="col">1st-place</th>
              ${showChampionship ? '<th scope="col">Champion</th>' : ""}
              ${showUnderrated ? '<th scope="col">Underrated</th>' : ""}
              ${showOverrated ? '<th scope="col">Overrated</th>' : ""}
            </tr></thead>
            <tbody>
              ${results.length > 0 ? results.map((result) => `<tr>
                <td class="poll-official-rank">${escapeHtml(result.rank)}</td>
                <td><strong>${escapeHtml(result.display_name)}</strong><small>${escapeHtml(result.owner_label)}</small></td>
                <td>${escapeHtml(result.ap_points)}</td>
                <td>${escapeHtml(result.average_rank ?? "—")}</td>
                <td>${escapeHtml(result.first_place_votes ?? 0)}</td>
                ${showChampionship ? `<td>${escapeHtml(result.championship_votes ?? 0)}</td>` : ""}
                ${showUnderrated ? `<td>${escapeHtml(result.underrated_votes ?? 0)}</td>` : ""}
                ${showOverrated ? `<td>${escapeHtml(result.overrated_votes ?? 0)}</td>` : ""}
              </tr>`).join("") : `<tr><td colspan="${columnCount}" class="text-center text-text-secondary">No aggregate results were returned.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderState() {
    if (!pollState?.poll) {
      renderNoPoll();
      return;
    }

    switch (pollState.poll.status) {
      case "open":
        renderOpen();
        break;
      case "closed":
        renderClosed();
        break;
      case "published":
        renderPublished();
        break;
      default:
        renderNoPoll();
    }
  }

  async function loadPoll({ showLoading = true } = {}) {
    if (showLoading) renderLoading();
    try {
      pollState = await callRpc("ap_poll_get_state", { p_league_slug: leagueSlug });
      renderState();
    } catch (error) {
      renderLoadError(error);
    }
  }

  function selectVoter(voterId) {
    const voter = pollState?.voters?.find((candidate) => candidate.id === voterId);
    if (!voter || voter.submitted || submissionPending) return;
    if (selectedVoterId !== voter.id) {
      selectedVoterId = voter.id;
      ranking = fisherYates(pollState.teams.map((team) => team.id));
      championshipTeamId = "";
      underratedTeamId = "";
      overratedTeamId = "";
      notice = null;
    }
    renderOpen();
    root.querySelector("[data-poll-ballot]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function moveRank(teamId, direction) {
    if (submissionPending) return;
    const index = ranking.indexOf(teamId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= ranking.length) return;
    [ranking[index], ranking[destination]] = [ranking[destination], ranking[index]];
    renderOpen();
    const preferredAction = direction < 0 ? "move-up" : "move-down";
    const fallbackAction = direction < 0 ? "move-down" : "move-up";
    const movedItem = root.querySelector(`[data-team-id="${CSS.escape(teamId)}"]`);
    const focusTarget = movedItem?.querySelector(`[data-action="${preferredAction}"]:not(:disabled)`)
      || movedItem?.querySelector(`[data-action="${fallbackAction}"]:not(:disabled)`);
    focusTarget?.focus();
  }

  function validateBallot() {
    if (!selectedVoterId) return "Choose your name before submitting.";
    const eligibleIds = new Set(pollState.teams.map((team) => team.id));
    const rankedIds = new Set(ranking);
    if (ranking.length !== 14 || rankedIds.size !== 14 || [...rankedIds].some((id) => !eligibleIds.has(id))) {
      return "Your ranking must contain all 14 teams exactly once. Reload the poll if the list looks incomplete.";
    }
    if (!championshipTeamId || !underratedTeamId || !overratedTeamId) {
      return "Answer all three final-pick questions before submitting.";
    }
    if (![championshipTeamId, underratedTeamId, overratedTeamId].every((id) => eligibleIds.has(id))) {
      return "One of your final picks is no longer eligible. Choose a team from each list.";
    }
    return null;
  }

  function submissionErrorMessage(error) {
    const serverMessage = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
    if (error?.code === "23505" || serverMessage.includes("already submitted") || serverMessage.includes("duplicate")) {
      return "That voter has already submitted a ballot. Refresh the poll and choose an available voter.";
    }
    if (serverMessage.includes("not accepting ballots") || serverMessage.includes("not open") || serverMessage.includes("poll not found")) {
      return "The poll closed while you were completing the ballot. Your choices are still shown below, but the ballot was not accepted.";
    }
    if (serverMessage.includes("rank every") || serverMessage.includes("eligible") || serverMessage.includes("required team")) {
      return "The ballot is no longer valid for this poll. Review the ranking and final picks, then try again.";
    }
    if (error?.kind === "network") return error.message;
    return "The ballot could not be submitted. Your choices have been preserved; please try again.";
  }

  function showFormMessage(message) {
    const messageNode = root.querySelector("[data-form-message]");
    if (!messageNode) return;
    messageNode.textContent = message;
    messageNode.classList.toggle("is-visible", Boolean(message));
    if (message) messageNode.focus?.();
  }

  async function submitBallot() {
    if (submissionPending) return;
    const validationMessage = validateBallot();
    if (validationMessage) {
      showFormMessage(validationMessage);
      return;
    }

    submissionPending = true;
    renderOpen();
    try {
      const voterName = pollState.voters.find((voter) => voter.id === selectedVoterId)?.display_name || "Voter";
      await callRpc("ap_poll_submit_ballot", {
        p_poll_id: pollState.poll.id,
        p_voter_id: selectedVoterId,
        p_ranked_team_ids: ranking,
        p_championship_team_id: championshipTeamId,
        p_underrated_team_id: underratedTeamId,
        p_overrated_team_id: overratedTeamId,
      });

      notice = { type: "success", message: `${voterName}'s ballot was submitted successfully. Thank you for voting.` };
      selectedVoterId = null;
      ranking = [];
      championshipTeamId = "";
      underratedTeamId = "";
      overratedTeamId = "";
      submissionPending = false;
      await loadPoll({ showLoading: false });
    } catch (error) {
      submissionPending = false;
      renderOpen();
      showFormMessage(submissionErrorMessage(error));
    }
  }

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "retry-load") {
      notice = null;
      loadPoll();
    } else if (action === "select-voter") {
      selectVoter(button.dataset.voterId);
    } else if (action === "move-up" || action === "move-down") {
      const item = button.closest("[data-rank-item]");
      if (item) moveRank(item.dataset.teamId, action === "move-up" ? -1 : 1);
    }
  });

  root.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLSelectElement)) return;
    if (event.target.name === "championship") championshipTeamId = event.target.value;
    if (event.target.name === "underrated") underratedTeamId = event.target.value;
    if (event.target.name === "overrated") overratedTeamId = event.target.value;
    showFormMessage("");
  });

  root.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-poll-ballot]")) return;
    event.preventDefault();
    submitBallot();
  });

  root.addEventListener("dragstart", (event) => {
    const item = event.target.closest("[data-rank-item]");
    if (!item || submissionPending) return;
    draggedTeamId = item.dataset.teamId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedTeamId);
    requestAnimationFrame(() => item.classList.add("is-dragging"));
  });

  root.addEventListener("dragover", (event) => {
    const item = event.target.closest("[data-rank-item]");
    if (!item || !draggedTeamId || item.dataset.teamId === draggedTeamId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    root.querySelectorAll(".is-drag-over").forEach((node) => node.classList.remove("is-drag-over"));
    item.classList.add("is-drag-over");
  });

  root.addEventListener("drop", (event) => {
    const item = event.target.closest("[data-rank-item]");
    if (!item || !draggedTeamId || item.dataset.teamId === draggedTeamId) return;
    event.preventDefault();
    const targetId = item.dataset.teamId;
    const bounds = item.getBoundingClientRect();
    const insertBefore = event.clientY < bounds.top + bounds.height / 2;
    const reordered = ranking.filter((id) => id !== draggedTeamId);
    let targetIndex = reordered.indexOf(targetId);
    if (!insertBefore) targetIndex += 1;
    reordered.splice(targetIndex, 0, draggedTeamId);
    ranking = reordered;
    draggedTeamId = null;
    renderOpen();
  });

  root.addEventListener("dragend", () => {
    draggedTeamId = null;
    root.querySelectorAll(".is-dragging, .is-drag-over").forEach((node) => {
      node.classList.remove("is-dragging", "is-drag-over");
    });
  });

  loadPoll();
}
