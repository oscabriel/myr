# Stages

A stage is one full copy of the platform on Cloudflare: its own Workers, Workflows, Artifacts namespace, database, KV namespace and bucket. `infra/stages.ts` is the one table of stage names and resource names. Every other file, both `wrangler.jsonc` files included, matches it, and `packages/config/test/bootstrap.test.ts` checks that they do.

| Stage | What it is for |
| --- | --- |
| `dev-<user>` | One person's iteration. Today there is one, `dev-oscabriel`. Deploy it as often as you like. |
| `demo` | The recording and the submission. Deploy it deliberately, and never while a take is being recorded (H7). |

There is no `prod` stage before the deadline (spec §8 D13). The top level of each `wrangler.jsonc` is stage `local`, for tests and `wrangler dev`, and it is never deployed. A new person's stage is added to `stages` in `stages.ts` and gets an `env` block in each `wrangler.jsonc`, in the same change.

## What a stage owns

Every name is a job name plus the stage, never the brand. For stage `<s>`:

| Resource | Name | Made by |
| --- | --- | --- |
| Workers | `platform-<s>`, `sandbox-<s>`, `web-<s>` (once `apps/web` exists) | deploy |
| Workflows | `answer-<s>`, `on-push-<s>` | deploy (they live in `platform-<s>`) |
| Artifacts namespace (public) | `projects-<s>` | bootstrap |
| D1 database (the front page) | `front-page-<s>` | bootstrap |
| KV namespace (OAuth grants) | `oauth-<s>` | bootstrap |
| R2 bucket (lane evidence) | `evidence-<s>` | bootstrap |
| R2 bucket (CLI releases, served at `/install.sh` and `/releases/*`) | `releases-<s>` | bootstrap |
| Push-event trigger | `cf.artifacts.repo.pushed` on `projects-<s>`, starting `on-push-<s>` | deploy (`triggers.events` in `apps/platform/wrangler.jsonc`), read back by bootstrap |

The `witness` namespace belongs to another project. Nothing here reads, writes or deletes it, and neither should you.

## Before the first run

1. **Log Wrangler in**, once per machine: `apps/platform/node_modules/.bin/wrangler login`. Deploys and the D1, KV and R2 creates use this login, never the infra token.
2. **Set the infra credentials**, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, as `infra/.env.schema` describes. The token uses the "Read all resources" template plus Account › Artifacts › Edit. `bun run bootstrap` and `bun run ops` get them through `varlock run --path infra/`. To check they are set without seeing them, run `bun run env:check`.
3. **Confirm the plan**: Containers and Workflows need Workers Paid (H6; confirmed on this account, spec §8.3 O2).

## Bootstrap a stage

```sh
bun run bootstrap -- --stage dev-oscabriel
```

It refuses a stage that `stages.ts` doesn't declare. Then it:

1. reads what exists: the stage's Artifacts namespace over REST, and the account's D1 databases, KV namespaces and R2 buckets through Wrangler;
2. creates only what is missing, so a second run creates nothing;
3. writes the new D1 and KV ids into the stage's block of `apps/platform/wrangler.jsonc`, touching nothing else in the file (commit that change);
4. applies the front page's migrations (`wrangler d1 migrations apply front-page-<s> --remote --env <s>`), once `apps/platform/migrations/` exists;
5. records the account's workers.dev subdomain in `infra/workers-dev.json`, so smoke knows where the stage lives;
6. checks by name that the deployed platform holds every secret its `.env.schema` requires. Before the first deploy there is no Worker to hold them, so it says which ones that deploy has to carry.

It never deletes anything and never prints or reads a secret's value.

## Secrets

`apps/platform/.env.schema` names them. Values never go in the repo.

| Name | Needed |
| --- | --- |
| `OPERATOR_TOKEN` | Always. The operator's bearer token, at least 32 characters. |
| `SESSION_TOKENS` | Optional. A JSON object from token to handle, for the demo's named people (spec §8 D9). |
| `COOKIE_KEY` | Always. Seals a sign-in in progress into its form (HMAC-SHA-256), at least 32 characters. |
| `PASSWORD_PEPPER` | Always. Every password is HMAC'd with it before PBKDF2, at least 32 characters. Changing it makes every stored password fail to verify. |

To set them for a stage, do one of these:

- **varlock (H5).** Write `NAME=varlock(prompt)` for each one into `apps/platform/.env.local`, run `./node_modules/.bin/varlock load --path apps/platform/` in your own terminal, then deploy. `varlock-wrangler` hands the values to the Worker.
- **A secrets file (dev stages only, spec §8.3 O1).** Keep a dotenv file outside the repo with mode 600, and deploy with `STAGE_SECRETS_FILE=<that file> bun run deploy -- --stage dev-<user>`. The platform's deploy step gets only the names `.env.schema` declares, as its environment, and that environment overrides any `.env` value. Nothing prints them. A deploy to `demo` refuses the file before it runs anything.
- **By hand**, one at a time: `apps/platform/node_modules/.bin/wrangler secret put <NAME> --env <s>` in `apps/platform`, with the value on stdin.

Sign-in uses the platform's own accounts (handle and password), so no stage needs a third-party OAuth app. A stage's platform lives at `https://platform-<s>.<subdomain>.workers.dev`; the subdomain is in `infra/workers-dev.json` once bootstrap has run.

## Deploy a stage

```sh
bun run deploy -- --stage dev-oscabriel
```

Without `--stage`, or with a stage `stages.ts` doesn't declare, it refuses before it runs anything. It takes no other flag, and `verify` always runs first (AGENTS.md principle 11). In order, it runs:

1. `bun run verify`. If the gate is red, nothing after it runs.
2. The `sandbox` deploy (`wrangler deploy --env <s>`), first, because the platform's `SANDBOX` binding names it.
3. The `platform` deploy (`varlock-wrangler deploy --env <s>`), which resolves `.env.schema` and sends the secrets.
4. The `web` build and deploy, once `apps/web` exists.
5. A read-back of the push-event trigger (`bun run bootstrap -- --stage <s> --check-triggers`), because Wrangler's output doesn't prove it exists.
6. `bun scripts/smoke.ts --stage <s>`.

Then it prints the redirect URI a Google OAuth client registers for the stage (`<platform origin>/oauth/google/callback`, H4). Google sign-in stays off until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, and `migrations/0003_identities.sql` must be applied before they are.

Every command runs with `WRANGLER_SEND_METRICS=false`, and with its own folder's `node_modules/.bin` first on `PATH`, so each app deploys with its pinned Wrangler. The first failing step stops the deploy and names that step.

## Smoke-test a stage

```sh
bun run smoke -- --stage dev-oscabriel
bun run smoke -- --stage dev-oscabriel --url http://localhost:8787
```

The second form points smoke at another origin, such as `wrangler dev --env dev-oscabriel` in `apps/platform`. Plain `wrangler dev` serves stage `local`, which no `--stage` names, so its `health` probe fails. Smoke finds the stage's web at `https://web-<s>.<subdomain>.workers.dev`; with `--url` it probes a web only when `--web-url <origin>` names one.

Smoke only reads, from the platform and then the web. Every probe runs even when others fail, and the output names each probe that failed and why. It also prints how long each probe took. A probe the platform answers with its own failure (a 5xx, or an RPC defect) asks again every second for up to 30 s, since a fresh deploy gives those for its first seconds (seen on `dev-oscabriel`'s first deploy); any other wrong answer fails the probe at once.

| Probe | Passes when |
| --- | --- |
| `health` | `GET /health` answers `200 {"ok":true,"stage":"<s>"}`, naming the stage asked for |
| `oauth-metadata` | `GET /.well-known/oauth-protected-resource` answers 200 with JSON that names its `resource` |
| `mcp-needs-credential` | `POST /mcp` without a credential answers 401 |
| `anonymous-unknown-project` | an anonymous `/rpc` `listAsks` for `no-such-project` answers with a typed `UnknownProject` |
| `missing-repo-404` | `GET /no-such-project.git/info/refs?service=git-upload-pack` answers 404 |
| `web-front-page` | the web's `GET /` answers 200 with HTML |
| `web-llms-txt` | the web's `GET /llms.txt` answers 200 with Markdown that opens with its title; the web builds it from the platform's project list, so it passes only when the web reaches the platform through its service binding |

## Tear down a stage

None of this is automated: the scripts never delete, and nobody runs `wrangler delete` or cf's `delete` without the user's OK (`wrangler delete` auto-confirms in a non-interactive shell). Tear down only what this build created, which means only names from the table above, and never `witness`. A person runs these in their own terminal. Wrangler's commands run from the app's folder with that app's `node_modules/.bin/wrangler`.

1. The Workers: `wrangler delete --env <s>` in `apps/web` (if deployed), then `apps/platform`, then `apps/sandbox`. Then `wrangler workflows delete answer-<s>` and `wrangler workflows delete on-push-<s>`, if they remain.
2. The Artifacts repos, then the namespace. List the repos with `bun run ops -- artifacts namespaces repos list --namespace projects-<s>`, delete each one with `bun run ops -- artifacts namespaces repos delete <repo> --namespace projects-<s> --force`, then `bun run ops -- artifacts namespaces delete --namespace projects-<s>`. A namespace has to be empty before it can be deleted.
3. The database: `wrangler d1 delete front-page-<s>`.
4. The KV namespace: `wrangler kv namespace delete --namespace-id <id>`. The id is in the stage's block of `apps/platform/wrangler.jsonc`.
5. The buckets: empty `evidence-<s>` and `releases-<s>`, then run `wrangler r2 bucket delete evidence-<s>` and `wrangler r2 bucket delete releases-<s>`.
6. Put the stage's placeholder ids back in `apps/platform/wrangler.jsonc`.
