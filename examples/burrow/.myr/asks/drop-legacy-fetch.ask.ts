import { kinds, territory } from "@myrtechnology/cli/rules";

export default kinds.migrate.ask({
  context: [
    "http.get hands back a failed request as a value, where legacyFetch threw, so each caller decides what a failure means",
  ],
  count: "bun scripts/count-callers.ts legacyFetch --json",
  from: "legacyFetch",
  outOfScope: ["The module-level state the lint warns about: its ratchet"],
  territory: territory.paths("packages/**"),
  to: "http.get",
  want: "Replace every call to legacyFetch with http.get, then delete legacyFetch",
});
