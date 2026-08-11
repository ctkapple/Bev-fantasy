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
  let rankMotion = null;
  let rankMotionSequence = 0;
  let pointerDrag = null;
  let pointerAutoScrollFrame = null;
  let notice = null;
  let pollSnapshotState = { status: "idle", data: null };
  let pollSnapshotPromise = null;
  let deliberateSnapshotTeamId = null;
  let hoveredSnapshotTeamId = null;
  let mobileSnapshotState = "hidden";
  let mobileSnapshotShowAll = false;
  let suppressMobileSnapshotClickUntil = 0;

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const desktopSnapshotQuery = window.matchMedia("(min-width: 1024px)");
  const POINTER_DRAG_THRESHOLD = 6;
  const POINTER_EDGE_SCROLL_ZONE = 72;
  const POINTER_MAX_SCROLL_SPEED = 12;
  const SNAPSHOT_STALE_MS = 72 * 60 * 60 * 1000;

  function readManagerInfo() {
    const configNode = document.querySelector("#ap-poll-manager-info");
    if (!configNode) return {};
    try {
      return JSON.parse(configNode.textContent);
    } catch {
      return {};
    }
  }

  const avatarByOwnerName = new Map(
    Object.values(readManagerInfo()).map((manager) => [manager.name, manager.avatar])
  );

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

  function snapshotInteractionsEnabled() {
    return pollState?.poll?.status === "open"
      && Boolean(selectedVoterId);
  }

  function displayedSnapshotTeamId() {
    return hoveredSnapshotTeamId || deliberateSnapshotTeamId;
  }

  function pollTeamById(teamId) {
    return pollState?.teams?.find((team) => team.id === teamId) || null;
  }

  function snapshotDateLabel(generatedAt) {
    const date = new Date(generatedAt);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  }

  function snapshotFooterMarkup(snapshot) {
    const updatedLabel = snapshotDateLabel(snapshot?.generatedAt);
    if (!updatedLabel) return "";
    const age = Date.now() - new Date(snapshot.generatedAt).getTime();
    const isStale = age > SNAPSHOT_STALE_MS;
    return `<footer class="poll-snapshot-footer${isStale ? " is-stale" : ""}">
      <span>Sleeper projections &bull; 0.5 PPR &bull; ${isStale ? "Last updated" : "Updated"} ${escapeHtml(updatedLabel)}</span>
      <span>Projections can change.</span>
    </footer>`;
  }

  function snapshotPlayerMarkup(player) {
    return `<li class="poll-snapshot-player">
      <span class="poll-player-headshot-wrap">
        <span class="poll-player-headshot-fallback" aria-hidden="true">${escapeHtml(player.position || "?")}</span>
        <img class="poll-player-headshot" data-player-headshot src="${escapeHtml(player.headshot)}" alt="" width="32" height="32" loading="lazy" decoding="async">
      </span>
      <span class="poll-snapshot-player-copy">
        <strong>${escapeHtml(player.name)}</strong>
        <small>${escapeHtml(player.position)} &bull; ${escapeHtml(player.nflTeam)}</small>
      </span>
      <strong class="poll-snapshot-points">${Number(player.projectedPoints).toFixed(1)}<span> pts</span></strong>
    </li>`;
  }

  function snapshotPanelContent(teamId, {
    playerLimit = 5,
    includeTeamHeading = true,
    label = `Top ${playerLimit} projected players`,
  } = {}) {
    const team = pollTeamById(teamId);
    let content = '<p class="poll-snapshot-empty">Select a team to preview its projected core.</p>';
    let footer = "";
    let hasPlayers = false;

    if (team) {
      if (pollSnapshotState.status === "idle" || pollSnapshotState.status === "loading") {
        content = '<p class="poll-snapshot-empty">Loading team snapshot&hellip;</p>';
      } else if (pollSnapshotState.status !== "ready" || !pollSnapshotState.data) {
        content = '<p class="poll-snapshot-empty">Projections are unavailable right now. Rankings are unaffected.</p>';
      } else {
        const snapshot = pollSnapshotState.data;
        footer = snapshotFooterMarkup(snapshot);
        if (String(snapshot.season) !== String(pollState.poll.season)) {
          content = '<p class="poll-snapshot-empty">Projections are unavailable right now. Rankings are unaffected.</p>';
        } else if (snapshot.status === "roster_unavailable") {
          content = '<p class="poll-snapshot-empty">Roster unavailable for this team.</p>';
        } else if (snapshot.status !== "ready") {
          content = '<p class="poll-snapshot-empty">Projections are unavailable right now. Rankings are unaffected.</p>';
        } else {
          const snapshotTeam = snapshot.teams?.[team.id];
          if (!snapshotTeam || snapshotTeam.status === "roster_unavailable") {
            content = '<p class="poll-snapshot-empty">Roster unavailable for this team.</p>';
          } else if (snapshotTeam.status !== "ready" || snapshotTeam.players?.length !== 5) {
            content = '<p class="poll-snapshot-empty">Projections are unavailable right now. Rankings are unaffected.</p>';
          } else {
            hasPlayers = true;
            const teamHeading = includeTeamHeading ? `<div class="poll-snapshot-team-heading">
              <strong>${escapeHtml(team.display_name)}</strong>
              <span>${escapeHtml(team.owner_label)}</span>
            </div>` : "";
            content = `${teamHeading}
            <p class="poll-snapshot-label">${escapeHtml(label)}</p>
            <ol class="poll-snapshot-players">${snapshotTeam.players.slice(0, playerLimit).map(snapshotPlayerMarkup).join("")}</ol>`;
          }
        }
      }
    }

    return { team, content, footer, hasPlayers };
  }

  function teamSnapshotMarkup() {
    const { content, footer } = snapshotPanelContent(displayedSnapshotTeamId());

    return `<section class="poll-team-snapshot-card" data-team-snapshot aria-labelledby="team-snapshot-heading">
      <h2 id="team-snapshot-heading">Team Snapshot</h2>
      <div class="poll-snapshot-content">${content}</div>
      ${footer}
    </section>`;
  }

  function mobileTeamSnapshotMarkup() {
    const team = pollTeamById(deliberateSnapshotTeamId);
    if (!team || mobileSnapshotState === "hidden") {
      return '<section class="poll-mobile-team-snapshot" data-mobile-team-snapshot hidden></section>';
    }

    if (mobileSnapshotState === "peek") {
      return `<section class="poll-mobile-team-snapshot" data-mobile-team-snapshot id="poll-mobile-snapshot-content" aria-label="Team Snapshot">
        <button type="button" class="poll-mobile-snapshot-peek" data-action="open-mobile-snapshot" aria-expanded="false" aria-controls="poll-mobile-snapshot-content">
          <span class="poll-mobile-snapshot-peek-copy">
            <small>Team Snapshot</small>
            <strong>${escapeHtml(team.owner_label)}</strong>
          </span>
          <span class="poll-mobile-snapshot-peek-action">View players <span aria-hidden="true">⌃</span></span>
        </button>
      </section>`;
    }

    const playerLimit = mobileSnapshotShowAll ? 5 : 3;
    const { content, footer, hasPlayers } = snapshotPanelContent(team.id, {
      playerLimit,
      includeTeamHeading: false,
      label: "Top projected players",
    });
    const playerToggle = hasPlayers ? `<button type="button" class="poll-mobile-snapshot-more" data-action="toggle-mobile-snapshot-players" aria-expanded="${mobileSnapshotShowAll}">
      ${mobileSnapshotShowAll ? "Show top 3" : "Show all 5"}
    </button>` : "";

    return `<section class="poll-mobile-team-snapshot is-open" data-mobile-team-snapshot id="poll-mobile-snapshot-content" aria-labelledby="mobile-team-snapshot-heading">
      <div class="poll-mobile-snapshot-drawer">
        <div class="poll-mobile-snapshot-grabber" aria-hidden="true"></div>
        <header class="poll-mobile-snapshot-header">
          <div>
            <small>Team Snapshot</small>
            <h2 id="mobile-team-snapshot-heading" aria-live="polite">${escapeHtml(team.owner_label)}</h2>
            <p>${escapeHtml(team.display_name)}</p>
          </div>
          <button type="button" class="poll-mobile-snapshot-close" data-action="collapse-mobile-snapshot" aria-label="Collapse Team Snapshot">&times;</button>
        </header>
        <div class="poll-mobile-snapshot-body">
          <div class="poll-snapshot-content">${content}</div>
          ${playerToggle}
          ${footer}
        </div>
      </div>
    </section>`;
  }

  function updateRankingSnapshotState() {
    const teamId = displayedSnapshotTeamId();
    root.querySelectorAll("[data-rank-item]").forEach((item) => {
      item.classList.toggle("is-snapshot-viewed", item.dataset.teamId === teamId);
    });
  }

  function updateTeamSnapshotPanel({ focusMobileSelector = null } = {}) {
    const panel = root.querySelector("[data-team-snapshot]");
    if (panel) panel.outerHTML = teamSnapshotMarkup();
    const mobilePanel = root.querySelector("[data-mobile-team-snapshot]");
    if (mobilePanel) mobilePanel.outerHTML = mobileTeamSnapshotMarkup();
    updateRankingSnapshotState();
    if (focusMobileSelector) {
      root.querySelector(focusMobileSelector)?.focus({ preventScroll: true });
    }
  }

  function selectSnapshotTeam(teamId) {
    if (!snapshotInteractionsEnabled() || !pollTeamById(teamId)) return;
    const changedTeam = deliberateSnapshotTeamId !== teamId;
    deliberateSnapshotTeamId = teamId;
    hoveredSnapshotTeamId = null;
    if (!desktopSnapshotQuery.matches) {
      if (mobileSnapshotState !== "open") mobileSnapshotState = "peek";
      if (changedTeam) mobileSnapshotShowAll = false;
    }
    updateTeamSnapshotPanel();
  }

  function toggleMobileSnapshotTeam(teamId) {
    if (desktopSnapshotQuery.matches || !snapshotInteractionsEnabled() || !pollTeamById(teamId)) return;
    const sameOpenTeam = deliberateSnapshotTeamId === teamId && mobileSnapshotState === "open";
    deliberateSnapshotTeamId = teamId;
    hoveredSnapshotTeamId = null;
    mobileSnapshotState = sameOpenTeam ? "peek" : "open";
    mobileSnapshotShowAll = false;
    updateTeamSnapshotPanel();
  }

  function collapseMobileSnapshot({ focusPeek = false } = {}) {
    if (desktopSnapshotQuery.matches || mobileSnapshotState !== "open") return;
    mobileSnapshotState = deliberateSnapshotTeamId ? "peek" : "hidden";
    mobileSnapshotShowAll = false;
    updateTeamSnapshotPanel({
      focusMobileSelector: focusPeek ? "[data-action='open-mobile-snapshot']" : null,
    });
  }

  function hideMobileSnapshotForDrag() {
    if (desktopSnapshotQuery.matches) return;
    root.querySelector("[data-mobile-team-snapshot]")?.classList.add("is-drag-hidden");
  }

  function restoreMobileSnapshotAfterDrag({ updatePanel = true } = {}) {
    if (desktopSnapshotQuery.matches) return;
    mobileSnapshotState = deliberateSnapshotTeamId ? "peek" : "hidden";
    mobileSnapshotShowAll = false;
    if (updatePanel) updateTeamSnapshotPanel();
  }

  function previewSnapshotTeam(teamId) {
    if (!desktopSnapshotQuery.matches || !snapshotInteractionsEnabled() || !pollTeamById(teamId)) return;
    if (hoveredSnapshotTeamId === teamId) return;
    hoveredSnapshotTeamId = teamId;
    updateTeamSnapshotPanel();
  }

  function clearSnapshotPreview() {
    if (!hoveredSnapshotTeamId) return;
    hoveredSnapshotTeamId = null;
    updateTeamSnapshotPanel();
  }

  async function loadPollSnapshot() {
    if (pollSnapshotPromise) return pollSnapshotPromise;
    pollSnapshotState = { status: "loading", data: null };
    updateTeamSnapshotPanel();
    pollSnapshotPromise = fetch(`/leagues/${encodeURIComponent(leagueSlug)}/data/poll-snapshot.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`snapshot request failed with ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (data?.schemaVersion !== 1) throw new Error("unsupported snapshot schema");
        pollSnapshotState = { status: "ready", data };
        return data;
      })
      .catch(() => {
        pollSnapshotState = { status: "unavailable", data: null };
        return null;
      })
      .finally(() => updateTeamSnapshotPanel());
    return pollSnapshotPromise;
  }

  function portraitMarkup(ownerLabel, className) {
    const avatar = avatarByOwnerName.get(ownerLabel);
    if (!avatar) {
      return `<span class="${escapeHtml(className)} poll-avatar-fallback" aria-hidden="true">${escapeHtml(ownerLabel?.charAt(0) || "?")}</span>`;
    }
    return `<img class="${escapeHtml(className)}" src="${escapeHtml(avatar)}" alt="" loading="lazy" decoding="async">`;
  }

  function interpolateColor(start, end, amount) {
    return start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount));
  }

  function rankTone(index, total) {
    const progress = total > 1 ? index / (total - 1) : 0;
    const green = [34, 197, 94];
    const orange = [249, 115, 22];
    const darkRed = [127, 29, 29];
    const tone = progress <= 0.5
      ? interpolateColor(green, orange, progress * 2)
      : interpolateColor(orange, darkRed, (progress - 0.5) * 2);
    return tone.join(" ");
  }

  function setRankMotion(teamId, direction) {
    rankMotionSequence += 1;
    rankMotion = { teamId, direction, id: rankMotionSequence };
  }

  function scheduleRankMotionCleanup(motion) {
    if (!motion) return;
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        root.querySelector(`[data-rank-motion="${motion.id}"]`)
          ?.classList.remove("is-moved-up", "is-moved-down");
      }, 480);
    });
  }

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
    const focusTarget = notice.type === "success" ? ' data-poll-success-notice tabindex="-1"' : "";
    return `<div class="poll-notice poll-notice-${escapeHtml(notice.type)}" role="${role}"${focusTarget}>
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
        ? `<ul>${submittedVoters.map((voter) => `<li>
          <span class="poll-submitted-voter">${portraitMarkup(voter.display_name, "poll-submitted-avatar")}<span>${escapeHtml(voter.display_name)}</span></span>
          <span>Submitted</span>
        </li>`).join("")}</ul>`
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
      ><span class="poll-voter-identity">${portraitMarkup(voter.display_name, "poll-voter-avatar")}<span>${escapeHtml(voter.display_name)}</span></span>${suffix}</button>`;
    }).join("");
  }

  function finalPickOptionsMarkup(question, selectedValue) {
    return pollState.teams.map((team) => {
      const selected = team.id === selectedValue;
      return `<button
        type="button"
        class="poll-voter-button poll-pick-button"
        data-action="select-final-pick"
        data-pick-question="${escapeHtml(question)}"
        data-team-id="${escapeHtml(team.id)}"
        aria-pressed="${selected}"
        ${submissionPending ? "disabled" : ""}
      >
        <span class="poll-voter-identity">
          ${portraitMarkup(team.owner_label, "poll-voter-avatar")}
          <span class="poll-pick-copy"><strong>${escapeHtml(team.display_name)}</strong><small>${escapeHtml(team.owner_label)}</small></span>
        </span>
        ${selected ? '<span class="poll-voter-state">Selected</span>' : ""}
      </button>`;
    }).join("");
  }

  function finalPickQuestionMarkup(question, label, selectedValue) {
    return `<fieldset class="poll-pick-question" data-pick-group="${escapeHtml(question)}">
      <legend>${escapeHtml(label)}</legend>
      <div class="poll-pick-grid">${finalPickOptionsMarkup(question, selectedValue)}</div>
    </fieldset>`;
  }

  function rankingMarkup() {
    const teamsById = new Map(pollState.teams.map((team) => [team.id, team]));
    const activeMotion = rankMotion;
    rankMotion = null;
    scheduleRankMotionCleanup(activeMotion);
    return `<ol class="poll-ranking" aria-label="Team ranking from first to fourteenth">
      ${ranking.map((teamId, index) => {
        const team = teamsById.get(teamId);
        if (!team) return "";
        const snapshotViewed = displayedSnapshotTeamId() === team.id;
        const motionClass = activeMotion?.teamId === team.id
          ? activeMotion.direction < 0 ? " is-moved-up" : " is-moved-down"
          : "";
        const motionAttribute = activeMotion?.teamId === team.id ? ` data-rank-motion="${activeMotion.id}"` : "";
        return `<li class="poll-rank-item${motionClass}${snapshotViewed ? " is-snapshot-viewed" : ""}" style="--poll-rank-tone: ${rankTone(index, ranking.length)}" draggable="${!submissionPending}" data-rank-item data-team-id="${escapeHtml(team.id)}"${motionAttribute}>
          <span class="poll-drag-handle" aria-hidden="true">⋮⋮</span>
          <span class="poll-rank-number" data-touch-drag-handle aria-label="Rank ${index + 1}; drag to reorder ${escapeHtml(team.display_name)}">${index + 1}</span>
          ${portraitMarkup(team.owner_label, "poll-team-avatar")}
          <span class="poll-team-copy">
            <span class="poll-team-owner-line"><strong>${escapeHtml(team.owner_label)}</strong><span class="poll-snapshot-viewing">Viewing</span></span>
            <small>${escapeHtml(team.display_name)}</small>
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
    return `<form class="poll-ballot poll-stage-card is-active${submissionPending ? " is-submitting" : ""}" data-poll-ballot novalidate aria-busy="${submissionPending}">
      <div class="poll-section-heading">
        <div>
          <p class="poll-step">Step 2</p>
          <h2 data-ballot-heading tabindex="-1">Rank all 14 teams</h2>
        </div>
        <p>Ballot for <strong>${escapeHtml(selectedVoter?.display_name)}</strong></p>
      </div>
      <p class="text-sm text-text-secondary">Drag teams into order, or use the move buttons. Rank 1 is your strongest team.</p>
      ${rankingMarkup()}

      <section class="poll-extra-questions" aria-labelledby="poll-final-picks-heading">
        <div class="poll-final-picks-heading">
          <p class="poll-step">Step 3</p>
          <h3 id="poll-final-picks-heading">Final picks</h3>
        </div>
        <p class="text-sm text-text-secondary">Each answer is required. You may choose any team, including your own.</p>
        <div class="poll-pick-question-list">
          ${finalPickQuestionMarkup("championship", "Championship favorite", championshipTeamId)}
          ${finalPickQuestionMarkup("underrated", "Most underrated", underratedTeamId)}
          ${finalPickQuestionMarkup("overrated", "Most overrated", overratedTeamId)}
        </div>
      </section>

      <div class="poll-form-message" data-form-message role="alert"></div>
      <button type="submit" class="poll-primary-button poll-submit-button" ${submissionPending ? "disabled" : ""}>
        ${submissionPending ? '<span class="poll-submit-spinner" aria-hidden="true"></span>Submitting ballot…' : "Submit final ballot"}
      </button>
      ${submissionPending ? '<span class="sr-only" role="status">Submitting ballot…</span>' : ""}
      <p class="poll-submit-note">Ballots cannot be edited after submission.</p>
    </form>`;
  }

  function renderOpen() {
    root.innerHTML = `${renderNotice()}
      ${pollHeaderMarkup(pollState, "Open")}
      <div class="poll-open-layout">
        <div class="poll-main-column">
          <section class="card poll-stage-card poll-voter-stage${selectedVoterId ? " is-complete" : ""}" aria-labelledby="voter-heading">
            <div class="poll-voter-heading">
              <p class="poll-step">Step 1</p>
              <h2 id="voter-heading">Who are you?</h2>
            </div>
            <p class="poll-voter-instructions text-sm text-text-secondary">Choose your name to begin. Submitted voters are locked.</p>
            <div class="poll-voter-grid">${voterOptionsMarkup()}</div>
          </section>
          ${ballotMarkup()}
        </div>
        <aside class="poll-sidebar">
          ${submittedVotersMarkup(pollState.voters)}
          ${teamSnapshotMarkup()}
        </aside>
      </div>
      ${mobileTeamSnapshotMarkup()}`;
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

  function resultTrendMarkup(result) {
    const currentRank = Number(result.rank);
    const hasPreviousRank = result.previous_rank !== null
      && result.previous_rank !== undefined
      && result.previous_rank !== "";
    const previousRank = Number(result.previous_rank);

    if (!hasPreviousRank || !Number.isFinite(currentRank) || !Number.isFinite(previousRank)) {
      return '<span class="poll-result-trend is-neutral" aria-label="No previous poll">&mdash;</span>';
    }

    const change = previousRank - currentRank;
    if (change > 0) {
      return `<span class="poll-result-trend is-up" aria-label="Up ${change} places"><span aria-hidden="true">&uarr;</span>${change}</span>`;
    }
    if (change < 0) {
      return `<span class="poll-result-trend is-down" aria-label="Down ${Math.abs(change)} places"><span aria-hidden="true">&darr;</span>${Math.abs(change)}</span>`;
    }
    return '<span class="poll-result-trend is-neutral" aria-label="Rank unchanged">&mdash;</span>';
  }

  function resultRowMarkup(result) {
    const rank = Number(result.rank);
    const rankClass = Number.isInteger(rank) && rank >= 1 && rank <= 3 ? ` is-rank-${rank}` : "";

    return `<li class="poll-result-row${rankClass}">
      <span class="poll-result-rank" aria-label="Rank ${escapeHtml(result.rank)}">${escapeHtml(result.rank)}</span>
      <span class="poll-results-team">
        ${portraitMarkup(result.owner_label, "poll-team-avatar")}
        <span class="poll-result-team-copy"><strong>${escapeHtml(result.display_name)}</strong><small>${escapeHtml(result.owner_label)}</small></span>
      </span>
      ${resultTrendMarkup(result)}
      <span class="poll-result-points"><strong>${escapeHtml(result.ap_points)}</strong><small>AP</small></span>
    </li>`;
  }

  function resultAwardWinners(results, field) {
    const highestVoteCount = Math.max(0, ...results.map((result) => Number(result[field]) || 0));
    if (highestVoteCount === 0) return [];
    return results.filter((result) => (Number(result[field]) || 0) === highestVoteCount);
  }

  function resultAwardMarkup(results, field, title, submissionCount) {
    const winners = resultAwardWinners(results, field);

    return `<article class="poll-award-card">
      <p class="poll-award-label">${escapeHtml(title)}</p>
      ${winners.length > 0 ? `<div class="poll-award-winners">
        ${winners.map((winner) => {
          const voteCount = Number(winner[field]) || 0;
          const percentage = submissionCount > 0 ? Math.round((voteCount / submissionCount) * 100) : 0;
          return `<div class="poll-award-winner">
            <span class="poll-results-team">
              ${portraitMarkup(winner.owner_label, "poll-team-avatar")}
              <span class="poll-result-team-copy"><strong>${escapeHtml(winner.display_name)}</strong><small>${escapeHtml(winner.owner_label)}</small></span>
            </span>
            <span class="poll-award-total"><strong>${voteCount}</strong><small>${voteCount === 1 ? "vote" : "votes"} &middot; ${percentage}%</small></span>
          </div>`;
        }).join("")}
      </div>` : '<p class="poll-award-empty">No votes recorded</p>'}
    </article>`;
  }

  function renderPublished() {
    const results = Array.isArray(pollState.results) ? pollState.results : [];
    const topResults = results.slice(0, 10);
    const submissionCount = Number(pollState.submission_count) || 0;
    const showChampionship = hasResultField(results, "championship_votes");
    const showUnderrated = hasResultField(results, "underrated_votes");
    const showOverrated = hasResultField(results, "overrated_votes");

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
            <h2 id="poll-results-title">AP Poll Top 10</h2>
          </div>
          <p>${submissionCount} ballots counted</p>
        </div>
        <div class="poll-result-column-labels" aria-hidden="true">
          <span>Rank</span><span>Team</span><span>Trend</span><span>AP points</span>
        </div>
        ${topResults.length > 0
          ? `<ol class="poll-result-list">${topResults.map(resultRowMarkup).join("")}</ol>`
          : '<p class="poll-results-empty">No aggregate results were returned.</p>'}
      </section>
      ${(showChampionship || showUnderrated || showOverrated) ? `<section class="poll-awards-section" aria-labelledby="poll-awards-title">
        <div class="poll-section-heading">
          <div>
            <p class="poll-step">Final picks</p>
            <h2 id="poll-awards-title">League superlatives</h2>
          </div>
        </div>
        <div class="poll-awards-grid">
          ${showChampionship ? resultAwardMarkup(results, "championship_votes", "Championship Favorite", submissionCount) : ""}
          ${showUnderrated ? resultAwardMarkup(results, "underrated_votes", "Most Underrated", submissionCount) : ""}
          ${showOverrated ? resultAwardMarkup(results, "overrated_votes", "Most Overrated", submissionCount) : ""}
        </div>
      </section>` : ""}`;
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
      const previousPollId = pollState?.poll?.id || null;
      const previousSeason = pollState?.poll?.season || null;
      pollState = await callRpc("ap_poll_get_state", { p_league_slug: leagueSlug });
      if (previousPollId && previousPollId !== pollState?.poll?.id) {
        deliberateSnapshotTeamId = null;
        hoveredSnapshotTeamId = null;
      }
      if (previousSeason && String(previousSeason) !== String(pollState?.poll?.season)) {
        pollSnapshotState = { status: "idle", data: null };
        pollSnapshotPromise = null;
      }
      renderState();
      if (pollState?.poll?.status === "open") void loadPollSnapshot();
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
    const ballotHeading = root.querySelector("[data-ballot-heading]");
    ballotHeading?.focus({ preventScroll: true });
    root.querySelector("[data-poll-ballot]")?.scrollIntoView({
      behavior: reducedMotionQuery.matches ? "auto" : "smooth",
      block: "start",
    });
  }

  function moveRank(teamId, direction) {
    if (submissionPending) return;
    const index = ranking.indexOf(teamId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= ranking.length) return;
    [ranking[index], ranking[destination]] = [ranking[destination], ranking[index]];
    setRankMotion(teamId, direction);
    renderOpen();
    const preferredAction = direction < 0 ? "move-up" : "move-down";
    const fallbackAction = direction < 0 ? "move-down" : "move-up";
    const movedItem = root.querySelector(`[data-rank-item][data-team-id="${CSS.escape(teamId)}"]`);
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
    if (message) {
      root.querySelectorAll("[data-pick-group]").forEach((group) => {
        const invalid = !group.querySelector('[aria-pressed="true"]');
        group.setAttribute("aria-invalid", String(invalid));
        group.classList.toggle("has-error", invalid);
      });
    }
  }

  function selectFinalPick(question, teamId) {
    if (submissionPending || !pollState?.teams?.some((team) => team.id === teamId)) return;
    if (question === "championship") championshipTeamId = teamId;
    else if (question === "underrated") underratedTeamId = teamId;
    else if (question === "overrated") overratedTeamId = teamId;
    else return;

    renderOpen();
    root.querySelector(
      `[data-pick-question="${CSS.escape(question)}"][data-team-id="${CSS.escape(teamId)}"]`
    )?.focus({ preventScroll: true });
  }

  function focusSuccessNotice() {
    const successNotice = root.querySelector("[data-poll-success-notice]");
    if (!successNotice) return;
    successNotice.focus({ preventScroll: true });
    successNotice.scrollIntoView({
      behavior: reducedMotionQuery.matches ? "auto" : "smooth",
      block: "start",
    });
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
      deliberateSnapshotTeamId = null;
      hoveredSnapshotTeamId = null;
      mobileSnapshotState = "hidden";
      mobileSnapshotShowAll = false;
      submissionPending = false;
      await loadPoll({ showLoading: false });
      focusSuccessNotice();
    } catch (error) {
      submissionPending = false;
      renderOpen();
      showFormMessage(submissionErrorMessage(error));
    }
  }

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      const item = event.target.closest("[data-rank-item]");
      if (item) {
        if (desktopSnapshotQuery.matches) {
          selectSnapshotTeam(item.dataset.teamId);
        } else if (Date.now() < suppressMobileSnapshotClickUntil) {
          suppressMobileSnapshotClickUntil = 0;
        } else {
          toggleMobileSnapshotTeam(item.dataset.teamId);
        }
      } else if (!event.target.closest("[data-mobile-team-snapshot]")) {
        collapseMobileSnapshot();
      }
      return;
    }
    if (!desktopSnapshotQuery.matches
      && mobileSnapshotState === "open"
      && !button.closest("[data-mobile-team-snapshot]")
      && !button.closest("[data-rank-item]")) {
      collapseMobileSnapshot();
    }
    const action = button.dataset.action;
    if (action === "retry-load") {
      notice = null;
      loadPoll();
    } else if (action === "select-voter") {
      selectVoter(button.dataset.voterId);
    } else if (action === "move-up" || action === "move-down") {
      const item = button.closest("[data-rank-item]");
      if (item) {
        selectSnapshotTeam(item.dataset.teamId);
        moveRank(item.dataset.teamId, action === "move-up" ? -1 : 1);
      }
    } else if (action === "open-mobile-snapshot") {
      mobileSnapshotState = deliberateSnapshotTeamId ? "open" : "hidden";
      mobileSnapshotShowAll = false;
      updateTeamSnapshotPanel({
        focusMobileSelector: event.detail === 0 ? "[data-action='collapse-mobile-snapshot']" : null,
      });
    } else if (action === "collapse-mobile-snapshot") {
      collapseMobileSnapshot({ focusPeek: event.detail === 0 });
    } else if (action === "toggle-mobile-snapshot-players") {
      mobileSnapshotShowAll = !mobileSnapshotShowAll;
      updateTeamSnapshotPanel({ focusMobileSelector: "[data-action='toggle-mobile-snapshot-players']" });
    } else if (action === "select-final-pick") {
      selectFinalPick(button.dataset.pickQuestion, button.dataset.teamId);
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || mobileSnapshotState !== "open") return;
    event.preventDefault();
    collapseMobileSnapshot({ focusPeek: true });
  });

  root.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-poll-ballot]")) return;
    event.preventDefault();
    submitBallot();
  });

  root.addEventListener("focusin", (event) => {
    const item = event.target.closest("[data-rank-item]");
    if (item) selectSnapshotTeam(item.dataset.teamId);
  });

  root.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse" || draggedTeamId || pointerDrag?.active) return;
    const item = event.target.closest("[data-rank-item]");
    if (!item) return;
    const previousItem = event.relatedTarget?.closest?.("[data-rank-item]");
    if (previousItem === item) return;
    previewSnapshotTeam(item.dataset.teamId);
  });

  root.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse" || draggedTeamId || pointerDrag?.active) return;
    const item = event.target.closest("[data-rank-item]");
    if (!item) return;
    const nextItem = event.relatedTarget?.closest?.("[data-rank-item]");
    if (nextItem === item) return;
    if (nextItem) previewSnapshotTeam(nextItem.dataset.teamId);
    else clearSnapshotPreview();
  });

  root.addEventListener("error", (event) => {
    if (!event.target.matches?.("[data-player-headshot]")) return;
    event.target.closest(".poll-player-headshot-wrap")?.classList.add("has-image-error");
  }, true);

  root.addEventListener("dragstart", (event) => {
    const item = event.target.closest("[data-rank-item]");
    if (!item || submissionPending) return;
    draggedTeamId = item.dataset.teamId;
    selectSnapshotTeam(draggedTeamId);
    hideMobileSnapshotForDrag();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedTeamId);
    requestAnimationFrame(() => item.classList.add("is-dragging"));
  });

  root.addEventListener("dragover", (event) => {
    const item = event.target.closest("[data-rank-item]");
    if (!item || !draggedTeamId) return;
    if (item.dataset.teamId === draggedTeamId) {
      clearDropIndicators();
      clearRankPreview();
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = item.getBoundingClientRect();
    const insertBefore = event.clientY < bounds.top + bounds.height / 2;
    const previewRanking = proposedRanking(draggedTeamId, item.dataset.teamId, insertBefore);
    clearDropIndicators();
    updateRankPreview(previewRanking, draggedTeamId);
    const draggedItem = root.querySelector(`[data-rank-item][data-team-id="${CSS.escape(draggedTeamId)}"]`);
    draggedItem?.classList.remove("is-dragging-up", "is-dragging-down");
    draggedItem?.classList.add(
      ranking.indexOf(item.dataset.teamId) < ranking.indexOf(draggedTeamId)
        ? "is-dragging-up"
        : "is-dragging-down"
    );
    item.classList.add("is-drag-over", insertBefore ? "is-drop-before" : "is-drop-after");
  });

  root.addEventListener("drop", (event) => {
    const item = event.target.closest("[data-rank-item]");
    if (!item || !draggedTeamId || item.dataset.teamId === draggedTeamId) return;
    event.preventDefault();
    const targetId = item.dataset.teamId;
    const bounds = item.getBoundingClientRect();
    const insertBefore = event.clientY < bounds.top + bounds.height / 2;
    const reordered = proposedRanking(draggedTeamId, targetId, insertBefore);
    if (!reordered) return;
    const targetIndex = reordered.indexOf(draggedTeamId);
    const previousIndex = ranking.indexOf(draggedTeamId);
    ranking = reordered;
    setRankMotion(draggedTeamId, targetIndex < previousIndex ? -1 : 1);
    draggedTeamId = null;
    restoreMobileSnapshotAfterDrag({ updatePanel: false });
    renderOpen();
  });

  root.addEventListener("dragend", () => {
    draggedTeamId = null;
    clearDragClasses();
    restoreMobileSnapshotAfterDrag();
  });

  function clearDropIndicators() {
    root.querySelectorAll(".is-drag-over, .is-drop-before, .is-drop-after").forEach((node) => {
      node.classList.remove("is-drag-over", "is-drop-before", "is-drop-after");
    });
  }

  function proposedRanking(teamId, targetId, insertBefore) {
    if (!teamId || !targetId || teamId === targetId) return null;
    const reordered = ranking.filter((id) => id !== teamId);
    let targetIndex = reordered.indexOf(targetId);
    if (targetIndex < 0) return null;
    if (!insertBefore) targetIndex += 1;
    reordered.splice(targetIndex, 0, teamId);
    return reordered;
  }

  function updateRankPreview(previewRanking, draggedId) {
    if (!previewRanking) {
      clearRankPreview();
      return;
    }
    const previewRankByTeam = new Map(previewRanking.map((teamId, index) => [teamId, index + 1]));
    root.querySelectorAll("[data-rank-item]").forEach((item) => {
      const currentRank = ranking.indexOf(item.dataset.teamId) + 1;
      const previewRank = previewRankByTeam.get(item.dataset.teamId) || currentRank;
      const rankNumber = item.querySelector(".poll-rank-number");
      if (rankNumber) {
        rankNumber.textContent = `${previewRank}`;
        rankNumber.setAttribute(
          "aria-label",
          rankNumber.getAttribute("aria-label")?.replace(/^Rank \d+;/, `Rank ${previewRank};`) || `Rank ${previewRank}`
        );
      }
      item.classList.toggle("is-rank-preview-shifted", previewRank !== currentRank);
      item.classList.toggle(
        "is-rank-preview-destination",
        item.dataset.teamId === draggedId && previewRank !== currentRank
      );
    });
  }

  function clearRankPreview() {
    root.querySelectorAll("[data-rank-item]").forEach((item) => {
      const currentRank = ranking.indexOf(item.dataset.teamId) + 1;
      const rankNumber = item.querySelector(".poll-rank-number");
      if (rankNumber && currentRank > 0) {
        rankNumber.textContent = `${currentRank}`;
        rankNumber.setAttribute(
          "aria-label",
          rankNumber.getAttribute("aria-label")?.replace(/^Rank \d+;/, `Rank ${currentRank};`) || `Rank ${currentRank}`
        );
      }
      item.classList.remove("is-rank-preview-shifted", "is-rank-preview-destination");
    });
  }

  function clearDragClasses() {
    root.querySelectorAll(".is-dragging, .is-pointer-dragging, .is-dragging-up, .is-dragging-down").forEach((node) => {
      node.classList.remove("is-dragging", "is-pointer-dragging", "is-dragging-up", "is-dragging-down");
      node.style.removeProperty("--poll-drag-y");
    });
    clearDropIndicators();
    clearRankPreview();
    root.classList.remove("is-touch-reordering");
  }

  function pointerDropTarget(clientX, clientY) {
    if (!pointerDrag?.active) return;
    const targetItem = document.elementsFromPoint(clientX, clientY)
      .map((node) => node.closest?.("[data-rank-item]"))
      .find((item) => item && item.dataset.teamId !== pointerDrag.teamId);
    clearDropIndicators();
    pointerDrag.targetId = targetItem?.dataset.teamId || null;
    const draggedItem = root.querySelector(`[data-rank-item][data-team-id="${CSS.escape(pointerDrag.teamId)}"]`);
    draggedItem?.classList.remove("is-dragging-up", "is-dragging-down");
    if (!targetItem) {
      clearRankPreview();
      return;
    }
    const bounds = targetItem.getBoundingClientRect();
    pointerDrag.insertBefore = clientY < bounds.top + bounds.height / 2;
    updateRankPreview(
      proposedRanking(pointerDrag.teamId, targetItem.dataset.teamId, pointerDrag.insertBefore),
      pointerDrag.teamId
    );
    const dragDirection = ranking.indexOf(targetItem.dataset.teamId) < ranking.indexOf(pointerDrag.teamId)
      ? "is-dragging-up"
      : "is-dragging-down";
    draggedItem?.classList.add(dragDirection);
    targetItem.classList.add("is-drag-over", pointerDrag.insertBefore ? "is-drop-before" : "is-drop-after");
  }

  function updatePointerDragVisual() {
    if (!pointerDrag?.active) return;
    const draggedItem = root.querySelector(`[data-rank-item][data-team-id="${CSS.escape(pointerDrag.teamId)}"]`);
    if (draggedItem) {
      const travel = pointerDrag.lastY - pointerDrag.startY + window.scrollY - pointerDrag.startScrollY;
      draggedItem.style.setProperty("--poll-drag-y", `${travel}px`);
    }
    pointerDropTarget(pointerDrag.lastX, pointerDrag.lastY);
  }

  function runPointerAutoScroll() {
    pointerAutoScrollFrame = null;
    if (!pointerDrag?.active || pointerDrag.scrollSpeed === 0) return;
    window.scrollBy(0, pointerDrag.scrollSpeed);
    updatePointerDragVisual();
    pointerAutoScrollFrame = requestAnimationFrame(runPointerAutoScroll);
  }

  function updatePointerAutoScroll(clientY) {
    if (!pointerDrag) return;
    if (clientY < POINTER_EDGE_SCROLL_ZONE) {
      pointerDrag.scrollSpeed = -Math.ceil(
        POINTER_MAX_SCROLL_SPEED * (1 - clientY / POINTER_EDGE_SCROLL_ZONE)
      );
    } else if (clientY > window.innerHeight - POINTER_EDGE_SCROLL_ZONE) {
      pointerDrag.scrollSpeed = Math.ceil(
        POINTER_MAX_SCROLL_SPEED * (1 - (window.innerHeight - clientY) / POINTER_EDGE_SCROLL_ZONE)
      );
    } else {
      pointerDrag.scrollSpeed = 0;
    }
    if (pointerDrag.scrollSpeed !== 0 && pointerAutoScrollFrame === null) {
      pointerAutoScrollFrame = requestAnimationFrame(runPointerAutoScroll);
    }
  }

  function finishPointerDrag({ cancelled = false } = {}) {
    if (!pointerDrag) return;
    const completedDrag = pointerDrag;
    pointerDrag = null;
    if (pointerAutoScrollFrame !== null) {
      cancelAnimationFrame(pointerAutoScrollFrame);
      pointerAutoScrollFrame = null;
    }
    clearDragClasses();
    if (!completedDrag.active) return completedDrag;

    restoreMobileSnapshotAfterDrag({ updatePanel: false });
    if (cancelled || !completedDrag.targetId) {
      updateTeamSnapshotPanel();
      return completedDrag;
    }

    const previousIndex = ranking.indexOf(completedDrag.teamId);
    const reordered = proposedRanking(
      completedDrag.teamId,
      completedDrag.targetId,
      completedDrag.insertBefore
    );
    if (!reordered) {
      updateTeamSnapshotPanel();
      return completedDrag;
    }
    const targetIndex = reordered.indexOf(completedDrag.teamId);
    if (targetIndex === previousIndex) {
      updateTeamSnapshotPanel();
      return completedDrag;
    }
    ranking = reordered;
    setRankMotion(completedDrag.teamId, targetIndex < previousIndex ? -1 : 1);
    renderOpen();
    return completedDrag;
  }

  root.addEventListener("pointerdown", (event) => {
    const item = event.target.closest("[data-rank-item]");
    if (event.pointerType === "mouse") {
      if (item && desktopSnapshotQuery.matches) selectSnapshotTeam(item.dataset.teamId);
      if (item && event.target.closest(".poll-rank-actions button")) item.draggable = false;
      return;
    }
    if (submissionPending || !item || event.target.closest(".poll-rank-actions button")) return;
    pointerDrag = {
      pointerId: event.pointerId,
      teamId: item.dataset.teamId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startScrollY: window.scrollY,
      active: false,
      targetId: null,
      insertBefore: true,
      scrollSpeed: 0,
    };
    item.setPointerCapture?.(event.pointerId);
  });

  root.addEventListener("pointermove", (event) => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    pointerDrag.lastX = event.clientX;
    pointerDrag.lastY = event.clientY;
    if (!pointerDrag.active) {
      const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
      if (distance < POINTER_DRAG_THRESHOLD) return;
      pointerDrag.active = true;
      root.classList.add("is-touch-reordering");
      hideMobileSnapshotForDrag();
      root.querySelector(`[data-rank-item][data-team-id="${CSS.escape(pointerDrag.teamId)}"]`)?.classList.add("is-pointer-dragging");
    }
    event.preventDefault();
    updatePointerDragVisual();
    updatePointerAutoScroll(event.clientY);
  });

  root.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") {
      root.querySelectorAll("[data-rank-item]").forEach((item) => {
        item.draggable = !submissionPending;
      });
      return;
    }
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const completedDrag = finishPointerDrag();
    suppressMobileSnapshotClickUntil = Date.now() + 500;
    if (completedDrag && !completedDrag.active) toggleMobileSnapshotTeam(completedDrag.teamId);
  });

  root.addEventListener("pointercancel", (event) => {
    if (event.pointerType === "mouse") {
      root.querySelectorAll("[data-rank-item]").forEach((item) => {
        item.draggable = !submissionPending;
      });
      return;
    }
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    finishPointerDrag({ cancelled: true });
  });

  loadPoll();
}
