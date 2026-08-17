// The site-wide prompt deliberately reads only the public aggregate poll state.
// It remains absent whenever no SB3 ballot is open.
const banner = document.querySelector("#live-poll-banner");
const navLink = document.querySelector("[data-live-poll-link]");

if (banner || navLink) {
  const SUPABASE_URL = "https://gkxpwopjmfdxymhsbnyh.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_DYoO_OPd_F9_HiXsiKFXpQ_xkjuimGy";
  const POLL_URL = "/sb3/poll/";
  const DISMISSED_POLL_KEY = "bev-fantasy:dismissed-live-poll";

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function isDismissed(pollId) {
    try {
      return window.localStorage.getItem(DISMISSED_POLL_KEY) === pollId;
    } catch {
      return false;
    }
  }

  function dismiss(pollId) {
    banner.hidden = true;
    banner.replaceChildren();
    try {
      window.localStorage.setItem(DISMISSED_POLL_KEY, pollId);
    } catch {
      // Dismissal still lasts for this page when storage is unavailable.
    }
  }

  async function loadLivePollBanner() {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ap_poll_get_state`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_league_slug: "sb3" }),
      });
      const payload = await response.json();
      const state = Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
      const poll = state?.poll;

      if (!response.ok || poll?.status !== "open") return;

      if (navLink) navLink.hidden = false;
      if (!banner || isDismissed(poll.id)) return;

      const submitted = Number(state.submission_count) || 0;
      const eligible = Number(state.eligible_voter_count) || 0;
      banner.innerHTML = `<div class="live-poll-banner-inner">
        <div class="live-poll-banner-copy">
          <span class="live-poll-banner-eyebrow"><span aria-hidden="true"></span>Live AP Poll</span>
          <strong>${escapeHtml(poll.label)}</strong>
        </div>
        <div class="live-poll-banner-progress">
          <span>Ballots submitted</span>
          <strong>${submitted} of ${eligible}</strong>
          <progress value="${submitted}" max="${Math.max(eligible, 1)}">${submitted} of ${eligible}</progress>
        </div>
        <div class="live-poll-banner-actions">
          <a href="${POLL_URL}" class="live-poll-banner-action">Cast your ballot</a>
          <button type="button" class="live-poll-banner-dismiss" aria-label="Dismiss live AP Poll prompt">&times;</button>
        </div>
      </div>`;
      banner.querySelector(".live-poll-banner-dismiss")?.addEventListener("click", () => dismiss(poll.id));
      banner.hidden = false;
    } catch {
      // The normal page content stays available if the public poll endpoint is down.
    }
  }

  void loadLivePollBanner();
}
