import { PEOPLE } from "../../lib/people.js";

/**
 * Global `people` data: the canonical person registry (lib/people.js), exposed
 * to templates so the Earnings tab can join every league's ledger through it.
 *
 * Deliberately a lone default export with the registry itself living in lib/.
 * An 11ty ESM data file that also exports something named hands templates the
 * module namespace object instead of calling the default function, which fails
 * silently — the page just renders its empty state.
 */
export default function () {
  return PEOPLE;
}
