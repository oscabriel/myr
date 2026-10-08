---
status: accepted
---

# A project's rules are evaluated once per landed SHA, in a Dynamic Worker that can reach nothing

A project writes its process as TypeScript in the config folder. At each landing the Lander bundles the folder with Bun, with macros off so nothing in it runs while it is bundled. The platform then evaluates the bundle once, in a Dynamic Worker made by the Worker Loader. That Worker has no bindings, no outbound network (`fetch` and `connect` throw), no subrequests and a CPU limit, and a prelude freezes its clock and randomness to the landed commit's time and a hash of its SHA. The result is the project's policy: plain data, decoded with Schema as it leaves the sandbox, and cached in the Project DO beside the landed SHA it came from. Most rules are data. The few that are functions (whether a proposal opens without a decider, whether a claimant is admitted) are called on demand in the same kind of sandbox, with their facts passed in and the clock at zero. A project with no config folder runs on the defaults.

## Considered Options

- **Config as data only (JSON or YAML).** There would be nothing to sandbox, but a project could not compute its rules, and the typed SDK would have nothing to check them against. `packages/rules` keeps a JSON evaluator (a committed `policy.json`, or the defaults) as a fallback adapter.
- **Bundle inside the platform Worker** with Cloudflare's worker bundler. A bundler would sit in the Worker that serves git, and it would bundle on every evaluation instead of once per landing.
- **Evaluate on every push.** Every push would pay a sandbox start, and two pushes judged against the same landing could see different rules.

## Consequences

- Only a landing changes a project's rules, and no answer changes what judges it: the config folder is in the judge closure, and rules are read only at the landed SHA (ADR 0005).
- Evaluating the same SHA twice gives the same policy (principle 8; `packages/rules/test/replay.test.ts`).
- A config folder that fails to bundle or to evaluate leaves the policy of the previous landed SHA in place, and the failure is logged.
- The SDK a project imports must run with no clock, no randomness and no network of its own, so rules get time and identity only through their facts.
