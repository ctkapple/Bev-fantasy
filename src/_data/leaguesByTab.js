import getLeagues from "./leagues.js";

/**
 * Global `leaguesByTab` data: { [templateName]: League[] }, pre-filtered so
 * each section page template's 11ty pagination only generates pages for
 * leagues that actually have that tab (e.g. `leaguesByTab.rules` is just
 * [jrwll] - sb3/bb don't have a Rules tab). Avoids conditional-permalink
 * gymnastics in the section templates themselves.
 */
export default function () {
  const result = {};
  for (const league of getLeagues()) {
    for (const tab of league.tabs) {
      if (!result[tab.template]) result[tab.template] = [];
      result[tab.template].push(league);
    }
  }
  return result;
}
