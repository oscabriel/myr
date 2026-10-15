import { layerManifest } from "@myr/cli/rules";
import type { AreaOf } from "@myr/cli/rules";

// The public config sits beside this file in a maintainer's work tree, where
// the layer is overlaid on main at the same paths.
import type policy from "./visibility.ts";

/**
 * The maintainers layer's held-back checks: where each one is, the area it
 * guards, the clause it enforces (an ask's want, or a README section,
 * quoted), and who wrote it. Only the counts per area and author leave the
 * layer, as the ledger's commitments.
 *
 * `knownBad` names the commits each new check must fail on before it joins
 * the suite: one per area, on the branch `known-bad/<area>`, each datekit's
 * first public tree with `known-bad/<area>.patch` applied. The seed makes
 * them, and refuses a list that doesn't match what it makes.
 *
 * The platform reads `layer.json` beside this file, its JSON form: keep the
 * two the same.
 */
export default layerManifest<AreaOf<typeof policy>>({
  checks: [
    {
      area: "export",
      author: "ines-v",
      clause: {
        quote: "Text in single quotes is printed exactly as written",
        ref: "README.md#format-patterns",
        source: "doc",
      },
      path: "checks/held-back/export/quoted-literals.test.ts",
    },
    {
      area: "export",
      author: "okonkwo",
      clause: {
        quote: "Two single quotes print one",
        ref: "README.md#format-patterns",
        source: "doc",
      },
      path: "checks/held-back/export/quote-escapes.test.ts",
    },
    {
      area: "export",
      author: "bram",
      clause: {
        quote: "The Do token of format prints the day of the month as an English ordinal",
        ref: "format-ordinal",
        source: "ask",
      },
      path: "checks/held-back/export/ordinal-in-patterns.test.ts",
    },
    {
      area: "export",
      author: "ines-v",
      clause: {
        quote:
          "A letter outside quotes that is no token throws a `RangeError`, so a typo never prints a wrong date.",
        ref: "README.md#format-patterns",
        source: "doc",
      },
      path: "checks/held-back/export/unknown-letters.test.ts",
    },
    {
      area: "export",
      author: "okonkwo",
      clause: {
        quote: "Punctuation, digits and spaces pass through as they are.",
        ref: "README.md#format-patterns",
        source: "doc",
      },
      path: "checks/held-back/export/pass-through.test.ts",
    },
    {
      area: "export",
      author: "bram",
      clause: {
        quote: "hour, 12-hour clock, and AM or PM",
        ref: "README.md#showing-dates",
        source: "doc",
      },
      path: "checks/held-back/export/twelve-hour-clock.test.ts",
    },
    {
      area: "export",
      author: "okonkwo",
      clause: {
        quote:
          "`format` takes any IANA zone (`Europe/Lisbon`, `America/New_York`) and follows its daylight saving time.",
        ref: "README.md#time-zones",
        source: "doc",
      },
      path: "checks/held-back/export/offsets.test.ts",
    },
    {
      area: "parser",
      author: "ines-v",
      clause: {
        quote: "`parseISO` never throws.",
        ref: "README.md#reading-dates",
        source: "doc",
      },
      path: "checks/held-back/parser/never-throws.test.ts",
    },
    {
      area: "parser",
      author: "okonkwo",
      clause: {
        quote: "an ordinal date: `2026-280` is the 280th day of 2026",
        ref: "README.md#reading-dates",
        source: "doc",
      },
      path: "checks/held-back/parser/ordinal-dates.test.ts",
    },
    {
      area: "parser",
      author: "bram",
      clause: {
        quote: "gives an invalid date for a week the year doesn't have",
        ref: "parse-iso-week",
        source: "ask",
      },
      path: "checks/held-back/parser/week-bounds.test.ts",
    },
    {
      area: "parser",
      author: "ines-v",
      clause: {
        quote: "Digits past the millisecond are dropped, not rounded.",
        ref: "README.md#reading-dates",
        source: "doc",
      },
      path: "checks/held-back/parser/fraction-digits.test.ts",
    },
  ],
  knownBad: [
    // known-bad/export: unescapes only the first pair of quotes.
    "f7ba08a5de930667c6769382352b58574d6b5805",
    // known-bad/parser: rounds the digits past the millisecond.
    "ec27b34dcec611e099a0039e33bf003c48c4a8b5",
  ],
  layer: "maintainers",
});
