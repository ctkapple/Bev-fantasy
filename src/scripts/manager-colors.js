// Single source of truth for "what color is this manager?" — imported by
// ap-poll.js (client) and by src/_data/people.js, which .eleventy.js reads at
// build time for the Earnings equity curve. Before this file existed the poll
// owned the only palette and the earnings chart colored its lines by *rank*
// (top-3 orange/amber, everyone else a dim ramp), so the same person was a
// different color on every page.
//
// Two maps rather than one because the two pages count different things. The
// AP Poll's unit is an SB3 *franchise* — "Kevin & Chris" is one team that casts
// one ballot. The Earnings exchange's unit is a *person*, because JRWLL and
// BestBall pay Kevin and Chris separately and the cross-league combine splits
// a co-owned franchise's winnings between its two owners. FRANCHISE_COLORS is
// therefore byte-identical to what the poll has always shipped; PERSON_COLORS
// adds the four split-outs and leaves the ten solo managers on their poll hex.

export const FRANCHISE_COLORS = {
  "Will Dooling": "#a855f7",
  "Andrew Johnstone": "#14b8a6",
  "Matt Manzo": "#2563eb",
  "Kevin & Chris": "#f8fafc",
  "Patrick Gavin": "#ec4899",
  "Matt Pitman": "#991b1b",
  "Johnny Jones": "#c2410c",
  "Malcolm Zeroka": "#f87171",
  "Adam Ellis": "#38bdf8",
  "Brian Harty": "#a78bfa",
  "Connor Cademartori": "#16a34a",
  "Peter & Sean": "#eab308",
  "Sam Abate": "#166534",
  "Kevin Morency": "#f472b6",
};

// Keyed by person id (see people.js). The two co-owned franchises split their
// poll color between their owners so the pairs still read as related: Kevin &
// Chris's near-white becomes a bright/dim slate pair, Peter & Sean's yellow
// becomes a bright/dark amber pair.
export const PERSON_COLORS = {
  "will-dooling": "#a855f7",
  "andrew-johnstone": "#14b8a6",
  "matt-manzo": "#2563eb",
  "kevin-flaherty": "#e2e8f0",
  "chris-cole": "#94a3b8",
  "patrick-gavin": "#ec4899",
  "matt-pitman": "#991b1b",
  "johnny-jones": "#c2410c",
  "malcolm-zeroka": "#f87171",
  "adam-ellis": "#38bdf8",
  "brian-harty": "#a78bfa",
  "connor-cademartori": "#16a34a",
  "sean-richardson": "#eab308",
  "peter-coluntino": "#a16207",
  "sam-abate": "#166534",
  "kevin-morency": "#f472b6",
};

// Stroke variants for the equity curve. The poll never draws more than a
// handful of lines at once and does it against a card background; the earnings
// chart draws all sixteen at once on the dark page, where two of the poll hexes
// are effectively invisible (Pitman's #991b1b, Sam's #166534) and three pairs
// collide (Will/Brian purple, Pat/Morency pink, Connor/Sam green). Only the
// *stroke* moves — legend chips, tape entries, and blotter accents keep the
// exact poll hex, so the cross-page identity still holds.
//
// Anyone not listed here draws with their PERSON_COLORS value unchanged.
const LINE_OVERRIDES = {
  "matt-pitman": "#dc2626", // #991b1b is near-black on the page background
  "sam-abate": "#4ade80", // #166534 likewise, and needs air from Connor's green
  "connor-cademartori": "#22c55e", // brightened a step for that same separation
  "kevin-flaherty": "#cbd5e1", // #e2e8f0 outshines every other line as a stroke
  "peter-coluntino": "#ca8a04", // #a16207 reads as brown at 2px
  "malcolm-zeroka": "#fca5a5", // lightened so it can't be read as Pitman's red
  "brian-harty": "#c4b5fd", // lightened away from Will's purple
  "matt-manzo": "#3b82f6",
  "johnny-jones": "#f97316",
  "kevin-morency": "#d946ef", // pushed to fuchsia so Pat's pink stays distinct
};

export const LINE_COLORS = Object.fromEntries(
  Object.entries(PERSON_COLORS).map(([id, hex]) => [id, LINE_OVERRIDES[id] || hex])
);
