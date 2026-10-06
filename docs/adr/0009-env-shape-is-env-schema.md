---
status: accepted
---

# The env shape is the project's `.env.schema`, parsed and never resolved

A project's env shape is its committed `.env.schema`, in the [@env-spec](https://github.com/dmno-dev/varlock/discussions/17) format that varlock reads. The platform parses it at the landed SHA with `@env-spec/parser` and never resolves it: no `exec`, no plugins, and no imports from outside the repo. Function-valued flags count as sensitive. Values are stored only for `@sensitive` items, as write-only values, envelope-encrypted in the Project DO under a master key held as a Worker secret. Unlanded code sees a placeholder for every `@sensitive` item. For a `@proxy` item, the platform swaps the real value in on matching outbound HTTPS requests ([Sandbox outbound interception](https://developers.cloudflare.com/sandbox/network/call-an-authenticated-api/)).

## Considered Options

- **An `env.ts` in the config folder.** Only the platform would read it, while the app kept its own env loading, and the two shapes would drift. One file now serves the app, local tools, agents and the platform.
- **Cloudflare Secrets Store for project values.** It holds [up to 100 secrets per account, in one store](https://developers.cloudflare.com/secrets-store/manage-secrets/).

## Consequences

- `.env.schema` and committed `.env.*` files, except `*.local`, are in the judge closure. An answer cannot add or change an env item, such as adding a `@proxy` domain or turning off `@sensitive`; a decider lands it.
- This repo's own env uses varlock. Tools run through `varlock run`. Workers deploy through `varlock-wrangler` ([`@varlock/cloudflare-integration`](https://varlock.dev/integrations/cloudflare/)), which passes non-sensitive values as `--var` and sensitive ones through `--secrets-file`. Agents read the env only through `varlock load --agent`, with values redacted.
- No Worker imports varlock's runtime. Its `init` patches `console` and the global `Response` and scans every streamed body, and the gateway streams git packs.
- The format is varlock's, and the README credits it.
