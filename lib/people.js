import { PERSON_COLORS, LINE_COLORS } from "../src/scripts/manager-colors.js";

/**
 * The canonical person registry the Earnings tab joins every league's ledger
 * through. Exposed to templates as the `people` global by src/_data/people.js.
 *
 * Why this exists: each league's ledger is hand-entered and keyed by whatever
 * that league calls the entity — JRWLL and BestBall by person ("Kevin
 * Flaherty"), SB3 by franchise ("Kevin & Chris", a co-owned team). Summing
 * money across leagues is impossible without deciding what a single entity is,
 * so this file decides: **the entity is a person**, and a co-owned franchise's
 * money is split between its owners.
 *
 * `identities[slug]` is either a bare string (that league's name for this
 * person) or `{ name, share }` where `share` is the fraction of the franchise's
 * winnings *and* buy-in that belongs to them. Shares within one franchise must
 * sum to 1 — validate-build.js enforces that, because a typo there silently
 * mints or destroys money on the chart.
 *
 * A person absent from a league simply has no key for it. That's how the
 * cross-league view knows Kevin Morency has no BestBall line and Chris Cole no
 * JRWLL line, rather than plotting them at $0.
 */
const PEOPLE = {
  "will-dooling": {
    name: "Will Dooling",
    ticker: "WILL",
    avatar: "/assets/will.png",
    identities: { jrwll: "Will Dooling", sb3: "Will Dooling", bb: "Will Dooling" },
  },
  "kevin-flaherty": {
    name: "Kevin Flaherty",
    ticker: "FLTZ",
    avatar: "/assets/kev.jpg",
    identities: {
      jrwll: "Kevin Flaherty",
      sb3: { name: "Kevin & Chris", share: 0.5 },
      bb: "Kevin Flaherty",
    },
  },
  "chris-cole": {
    name: "Chris Cole",
    ticker: "COLE",
    avatar: "/assets/chris.png",
    identities: { sb3: { name: "Kevin & Chris", share: 0.5 } },
  },
  "sean-richardson": {
    name: "Sean Richardson",
    ticker: "RICH",
    avatar: "/assets/sean.jpg",
    identities: {
      jrwll: "Sean Richardson",
      sb3: { name: "Peter & Sean", share: 0.5 },
      bb: "Sean Richardson",
    },
  },
  "peter-coluntino": {
    name: "Peter Coluntino",
    ticker: "PETE",
    avatar: "/assets/pete-and-richy.png",
    identities: { sb3: { name: "Peter & Sean", share: 0.5 }, bb: "Peter Coluntino" },
  },
  "malcolm-zeroka": {
    name: "Malcolm Zeroka",
    ticker: "ZERO",
    avatar: "/assets/Malcolm.jpg",
    identities: { jrwll: "Malcolm Zeroka", sb3: "Malcolm Zeroka", bb: "Malcolm Zeroka" },
  },
  "matt-pitman": {
    name: "Matt Pitman",
    ticker: "PTMN",
    avatar: "/assets/pitman.png",
    identities: { jrwll: "Matt Pitman", sb3: "Matt Pitman", bb: "Matt Pitman" },
  },
  "brian-harty": {
    name: "Brian Harty",
    ticker: "HART",
    avatar: "/assets/brian.png",
    identities: { jrwll: "Brian Harty", sb3: "Brian Harty", bb: "Brian Harty" },
  },
  "matt-manzo": {
    name: "Matt Manzo",
    ticker: "MNZO",
    avatar: "/assets/Manzo.png",
    identities: { jrwll: "Matt Manzo", sb3: "Matt Manzo", bb: "Matt Manzo" },
  },
  "andrew-johnstone": {
    name: "Andrew Johnstone",
    ticker: "ANDY",
    avatar: "/assets/andy.jpg",
    identities: { jrwll: "Andrew Johnstone", sb3: "Andrew Johnstone", bb: "Andrew Johnstone" },
  },
  "adam-ellis": {
    name: "Adam Ellis",
    ticker: "ADAM",
    avatar: "/assets/adam.png",
    identities: { jrwll: "Adam Ellis", sb3: "Adam Ellis", bb: "Adam Ellis" },
  },
  "connor-cademartori": {
    name: "Connor Cademartori",
    ticker: "CADS",
    avatar: "/assets/connor.jpg",
    identities: {
      jrwll: "Connor Cademartori",
      sb3: "Connor Cademartori",
      bb: "Connor Cademartori",
    },
  },
  "patrick-gavin": {
    name: "Patrick Gavin",
    ticker: "PGAV",
    avatar: "/assets/pat.png",
    identities: { jrwll: "Patrick Gavin", sb3: "Patrick Gavin", bb: "Patrick Gavin" },
  },
  "johnny-jones": {
    name: "Johnny Jones",
    ticker: "JPJ",
    avatar: "/assets/johhny.png",
    identities: { jrwll: "Johnny Jones", sb3: "Johnny Jones", bb: "Johnny Jones" },
  },
  "sam-abate": {
    name: "Sam Abate",
    ticker: "ABTE",
    avatar: "/assets/Sam.png",
    identities: { sb3: "Sam Abate", bb: "Sam Abate" },
  },
  "kevin-morency": {
    name: "Kevin Morency",
    ticker: "KEV",
    avatar: "/assets/kevm.png",
    identities: { sb3: "Kevin Morency" },
  },
};

for (const [id, person] of Object.entries(PEOPLE)) {
  person.id = id;
  person.color = PERSON_COLORS[id];
  person.lineColor = LINE_COLORS[id];
  person.symbol = "$" + person.ticker;
}

export { PEOPLE };
