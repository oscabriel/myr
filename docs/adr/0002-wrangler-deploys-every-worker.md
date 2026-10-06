---
status: proposed
---

# Wrangler deploys every Worker during the competition; `cf` is an ops CLI; after the deadline, cf or Alchemy

Until the competition closes on Oct 14, 2026, Wrangler deploys all three Workers (`platform`, `sandbox` and `web`). Cloudflare's `cf` CLI runs only read-mostly operations. After the deadline we move to cf or to Alchemy, whichever one's gate opens first. This departs from Cloudflare's own advice for new projects: "Prefer it over Wrangler … Wrangler is only for projects that already use it" ([cf launch post](https://blog.cloudflare.com/cloudflare-cf-cli-launch/)). We depart from it because neither alternative can yet declare what this platform deploys, and one deploy tool is safer in the recording week.

## Considered Options

- **Alchemy** (`2.0.0-beta.81`).
  - Released Alchemy cannot declare Durable Object-managed containers (`schedulingPolicy: "durable_object"`, which the Sandbox SDK 1.0 uses). Support is in open [PR #1905](https://github.com/alchemy-run/alchemy/pull/1905), so any Alchemy path today needs two tools.
  - Betas 79, 80 and 81 shipped on Sep 18, Oct 2 and Oct 5, and beta.80 had three breaking changes.
  - The Artifacts push trigger is not a reason either way. Whichever tool deploys, it is one REST call: `PUT /accounts/{account_id}/triggers/{script_name}` with a `cf.artifacts.repo.pushed` filter and a Workflow target.
- **cf with `cloudflare.config.ts`** (cf `1.0.0-beta.12`, `@cloudflare/config` `0.23.0`).
  - The config's `Trigger` union has no events trigger, and `cf migrate` drops it: "Artifact event triggers are not supported by the new config and were not migrated."
  - cf hands container builds to Wrangler.
  - The config always writes `script_name` on a Durable Object binding, so the deploy refuses the sandbox's container DO bound from its own Worker: "You cannot configure a container on a Durable Object that is defined in another Worker."
  - Wrangler would still be needed for non-Vite bundling, `tail`, single secrets, the Workers vitest plugin and `varlock-wrangler`.
  - cf shipped beta.0 to beta.12 between Sep 25 and Oct 2, with open deploy bugs ([#192](https://github.com/cloudflare/cf/issues/192), #197, #72).

## Consequences

- `infra/bootstrap.ts` makes the events-trigger call idempotently and is the one place that checks it.
- cf runs only as `bun run ops -- …`, pinned exactly, with telemetry off. A hook refuses its project commands (`dev`, `build`, `deploy`, `init`, `migrate`, `previews`), and any `delete` or `revoke` goes to the maintainer.
- The README says in one line that Wrangler deploys the Workers and cf is the ops CLI, and why.

## After the deadline

**cf**, once `@cloudflare/config` gains an events trigger and the container `script_name` fix, or cf reaches GA:
1. `cf migrate` each app.
2. Write `exports` for the Durable Objects.
3. Keep the trigger in `bootstrap.ts`.
4. Remove the sandbox's self-bindings.
5. Move web to `@cloudflare/vite-plugin@2`.
6. Fence bindings with `InferEnv` over `defineWorker` references.
7. Pass varlock values through `--secrets-file`.
8. Set `DO_NOT_TRACK=1`.

Watch cf #179, #180, #192, #197, #198 and #204.

**Alchemy**, once #1905 merges (before then, the sandbox would deploy through `Command.Exec` running Wrangler):
- **Async style:** plain `Cloudflare.Worker("X", { main, env })`, so Worker code stays tool-agnostic.
- **The events trigger as an `Action`:** it GETs, diffs only the entries it owns, and PUTs only on a difference. An `Action` reruns only when its input changes, so the input carries a per-deploy revision. Destroy is `PUT []`.
- **The binding fence:** `Cloudflare.InferEnv<typeof Platform>`, so deleting a binding is a type error.
- **Config:** local state, telemetry off (`ALCHEMY_TELEMETRY_DISABLED=1`) and an exact pin.
- **Frozen Durable Object names:** Alchemy deletes a removed Durable Object by default, so a rename is a delete and loses data. A test pins the class list.

Watch [#1950](https://github.com/alchemy-run/alchemy/pull/1950) (an events-trigger resource) and [#1916](https://github.com/alchemy-run/alchemy/pull/1916) (Artifacts reads).
