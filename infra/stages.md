# Stages

A stage is one full copy of the platform on Cloudflare: its own Workers, Workflows, Artifacts namespaces (public and private), database, KV namespace and buckets. `infra/stages.ts` is the one table of stage names and resource names. Every other file, both `wrangler.jsonc` files included, matches it, and `packages/config/test/bootstrap.test.ts` checks that they do.

This file has six parts, then how to run a stage:

1. [Stages](#1-stages)
2. [Resources per stage](#2-resources-per-stage)
3. [Throwaway ledger summary](#3-throwaway-ledger-summary)
4. [Teardown policy](#4-teardown-policy)
5. [Human steps status](#5-human-steps-status)
6. [URLs](#6-urls)

Sections 1 to 6 hold the state as of 2026-10-08, 16:00 UTC, read from the account with read-only calls.

## 1. Stages

| Stage | What it is for | State on 2026-10-08 |
| --- | --- | --- |
| `dev-oscabriel` | One person's iteration. Deploy it as often as you like. | Bootstrapped 2026-10-07 and deployed (platform, sandbox, web). Re-checked 2026-10-08: bootstrap created nothing, and the platform holds every required secret. The feature-frozen build was deployed at 14:51 UTC on 2026-10-08, and the whole core loop (`bun scripts/smoke.ts --stage dev-oscabriel --loop`) passed on it twice in a row. |
| `demo` | The recording and the submission. Deploy it deliberately, and never while a take is being recorded (H7). | Bootstrapped 2026-10-08: six resources created, migrations `0001` to `0004` applied, and a second run created nothing. Its secrets are set. Deployed at 15:39 UTC on 2026-10-08 (the build the dev stage proved), and smoke passed. Seeded at 15:44 UTC with `datekit` (its maintainers layer and both sealed suites admitted) and `burrow` (the `drop-legacy-fetch` family), nothing claimed. Each later deploy is listed, with its reason, in [Deploys of demo](#deploys-of-demo). |

There is no `prod` stage before the deadline. The top level of each `wrangler.jsonc` is stage `local`, for tests and `wrangler dev`, and it is never deployed. A new person's stage is added to `stages` in `stages.ts` and gets an `env` block in each `wrangler.jsonc`, in the same change.

## 2. Resources per stage

Every name is a job name plus the stage, never the brand. For stage `<s>`:

| Resource | Name | Made by |
| --- | --- | --- |
| Workers | `platform-<s>`, `sandbox-<s>`, `web-<s>` | deploy |
| Workflows | `answer-<s>`, `on-push-<s>` | deploy (they live in `platform-<s>`) |
| Artifacts namespace (public) | `projects-<s>` | bootstrap |
| Artifacts namespace (private: every project's layer repos, bound only by the platform) | `layers-<s>` | bootstrap |
| D1 database (the front page) | `front-page-<s>` | bootstrap |
| KV namespace (OAuth grants) | `oauth-<s>` | bootstrap |
| R2 bucket (lane evidence) | `evidence-<s>` | bootstrap |
| R2 bucket (CLI releases, served at `/install.sh` and `/releases/*`) | `releases-<s>` | bootstrap |
| Push-event trigger | `cf.artifacts.repo.pushed` on `projects-<s>`, starting `on-push-<s>` | deploy (`triggers.events` in `apps/platform/wrangler.jsonc`), read back by bootstrap |

The `witness` namespace belongs to another project. Nothing here reads, writes or deletes it, and neither should you.

Every resource in the two tables below belongs to its stage. The times are the account's own creation times, in UTC. A KV namespace has no creation time, so its row gives the bootstrap run that made it.

### `dev-oscabriel`

| Resource | Name | Created by | When | Keep? |
| --- | --- | --- | --- | --- |
| Artifacts namespace | `projects-dev-oscabriel` | bootstrap | 2026-10-07 20:17 | keep (needs the user to delete) |
| D1 | `front-page-dev-oscabriel` | bootstrap | 2026-10-07 20:17 | keep (needs the user to delete) |
| KV | `oauth-dev-oscabriel` | bootstrap | 2026-10-07 (first run) | keep (needs the user to delete) |
| R2 | `evidence-dev-oscabriel` | bootstrap | 2026-10-07 20:17 | keep (needs the user to delete) |
| Worker | `sandbox-dev-oscabriel` | deploy | 2026-10-07 20:19 | keep (needs the user to delete) |
| Worker | `platform-dev-oscabriel` | deploy | 2026-10-07 20:19 | keep (needs the user to delete) |
| Workflow | `answer-dev-oscabriel` | deploy | 2026-10-07 20:19 | keep (needs the user to delete) |
| Workflow | `on-push-dev-oscabriel` | deploy | 2026-10-07 20:19 | keep (needs the user to delete) |
| Push-event trigger | `projects-dev-oscabriel` → `on-push-dev-oscabriel` | deploy | 2026-10-07 | keep (needs the user to delete) |
| R2 | `releases-dev-oscabriel` | bootstrap | 2026-10-08 01:02 | keep (needs the user to delete) |
| Worker | `web-dev-oscabriel` | deploy | 2026-10-08 05:17 | keep (needs the user to delete) |
| Artifacts namespace | `layers-dev-oscabriel` | bootstrap | 2026-10-08 09:58 | keep (needs the user to delete) |
| Secrets on `platform-dev-oscabriel` | `OPERATOR_TOKEN`, `SESSION_TOKENS`, `COOKIE_KEY`, `PASSWORD_PEPPER`, `MASTER_KEY` | generated, carried by deploy (see [Secrets](#secrets)) | 2026-10-07 and 2026-10-08 | keep (needs the user to delete); rotate before going public |
| Seeded projects | `datekit` (with its `datekit--maintainers` layer repo) and `burrow` in `projects-dev-oscabriel` | seed | 2026-10-07 and 2026-10-08 | keep while the dev stage is used |

### `demo`

| Resource | Name | Created by | When | Keep? |
| --- | --- | --- | --- | --- |
| Artifacts namespace | `projects-demo` | bootstrap | 2026-10-08 13:57 | keep (needs the user to delete) |
| Artifacts namespace | `layers-demo` | bootstrap | 2026-10-08 13:57 | keep (needs the user to delete) |
| D1 | `front-page-demo`, with migrations `0001` to `0004` | bootstrap | 2026-10-08 13:57 | keep (needs the user to delete) |
| KV | `oauth-demo` | bootstrap | 2026-10-08 13:57 (the run) | keep (needs the user to delete) |
| R2 | `evidence-demo` | bootstrap | 2026-10-08 13:57 | keep (needs the user to delete) |
| R2 | `releases-demo` | bootstrap | 2026-10-08 13:57 | keep (needs the user to delete) |
| Worker | `platform-demo`: made by the first `wrangler secret put` as a placeholder to hold the secrets; the first deploy gave it its code and its workers.dev route. | `wrangler secret put`, then deploy | 2026-10-08 13:58 (code 15:39) | keep (needs the user to delete) |
| Secrets on `platform-demo` | `OPERATOR_TOKEN`, `SESSION_TOKENS`, `COOKIE_KEY`, `PASSWORD_PEPPER`, `MASTER_KEY` | generated, set with `wrangler secret put` and carried by deploy (see [Secrets](#secrets)) | 2026-10-08 13:58 | keep (needs the user to delete); rotate before going public |
| Worker | `sandbox-demo` | deploy | 2026-10-08 15:39 | keep (needs the user to delete) |
| Container applications | `sandbox-checker-demo` (started on `standard-3`) and `sandbox-lander-demo` (`standard-2`), with their images `sandbox-demo-checker-check` and `sandbox-demo-lander-land` in the account's container registry | deploy | 2026-10-08 15:39 | keep (needs the user to delete) |
| Worker | `web-demo` | deploy | 2026-10-08 15:39 | keep (needs the user to delete) |
| Workflow | `answer-demo`, `on-push-demo` | deploy | 2026-10-08 15:39 | keep (needs the user to delete) |
| Push-event trigger | `projects-demo` → `on-push-demo` | deploy (read back by bootstrap) | 2026-10-08 15:39 | keep (needs the user to delete) |
| Seeded projects | `datekit` (with its `datekit--maintainers` layer repo in `layers-demo`) and `burrow` in `projects-demo` | seed | 2026-10-08 15:40 to 15:44 | keep: the recording takes them. Don't reseed over them; a fresh copy is `seed --as`. |

## 3. Throwaway ledger summary

A throwaway is something a smoke run, a swarm run or a `seed --as` copy makes on a stage, beside the stage's own resources. Each run appends one JSON line for each throwaway to `infra/created.jsonl` (`infra/created.ts`), and teardown acts only on those lines.

On 2026-10-08 at 15:00 UTC the ledger holds 16 entries, all on `dev-oscabriel`, and each still exists:

| When (UTC) | By | Kind | Name | Where |
| --- | --- | --- | --- | --- |
| 2026-10-08 12:37 | swarm | repo | `burrow--drop-legacy-fetch-burrow-auth--wren` (a released claim's fork) | `projects-dev-oscabriel` |
| 2026-10-08 14:40 to 14:58 | smoke | project, repo, repo | four core-loop runs, `smoke-20261008-143944`, `smoke-20261008-144139`, `smoke-20261008-145551` and `smoke-20261008-145715`: each one's project, its repo, and its claim's fork `<project>--parse-year--bram` | `projects-dev-oscabriel` |
| 2026-10-08 14:52 to 14:54 | seed | project, repo, repo | `burrow-lint-807`, a `seed --as` copy of burrow that proved the Checker runs burrow's lint lane, with its repo and wren's claim fork `burrow-lint-807--drop-legacy-fetch-burrow-auth--wren` | `projects-dev-oscabriel` |

The live runs before the ledger existed left throwaways that it doesn't hold, all on `dev-oscabriel`. Teardown lists them separately and checks each one still exists before it deletes anything:

- In `projects-dev-oscabriel`, 25 repos on 2026-10-08. Two of them, `datekit` and `burrow`, are the stage's seeded examples, and their working and claim forks (`datekit--me--ines-v`, `datekit--format-ordinal--bram`, `datekit--add-months-clamp--bram`) belong to them. The rest are test projects and their forks: `w3live-muyjz31t`, `w3live-muyk0528`, `w3live-muyk72qm`, `w3live-muykamf1`, `w3live-muyklikt` (with `--parse-iso--alice`), `w3live-muyl0wps` (with `--parse-iso--alice`), `w3live-muyl2z12` (with `--parse-iso--alice`), `scratch-onpush-muykseuk`, `w4-rehearsal` (with `--first-day--alice`, `--canada-sunday--alice`, `--brazil-sunday--alice` and `--mexico-sunday--alice`), and `w4-ratchet` (with `--no-any-in-parser--alice` and `--pad-day--bob`).
- The secret `S8B_PROBE` on `platform-dev-oscabriel`.
- The test accounts `w3tester-muyk9zdx` and `w5web-muz3airr` in `front-page-dev-oscabriel`, and the latter's OAuth grant in `oauth-dev-oscabriel`.
- The Project Durable Objects and front-page rows of those test projects. They are harmless and are not deleted.

`demo` has no throwaways, and nothing that makes them is meant to run there: the core-loop smoke and the swarm's rehearsals run on the dev stage, the swarm on a `seed --as` copy.

## 4. Teardown policy

- This build deletes only throwaway resources recorded in `infra/created.jsonl` that it no longer needs.
- It never deletes a stage's Workers, namespaces, D1, KV or R2 without the user.
- It never touches `witness`.

No agent deletes a Cloudflare resource itself. Teardown first prints its plan: the ledger's entries that still exist, minus every stage's own names and `witness`. The deletes in that plan, together with the pre-ledger leftovers in section 3 that still exist, are written into one script that the user reads and then runs in their own terminal. A stage itself is torn down only by hand, by the user, as [Tear down a stage](#tear-down-a-stage) says.

## 5. Human steps status

As of 2026-10-08, after the demo's bootstrap. "Agent" is the build's agent.

| Step | Status | What the agent prepared | What the user does next |
| --- | --- | --- | --- |
| H1: a custom domain | Not done, and optional. The stages live on workers.dev. | Nothing needs it. | If wanted, buy the domain and say so. The agent then adds `routes` to each `wrangler.jsonc` and redeploys `demo`. |
| H2: the npm org and publishing the CLI | Open. | `bun run release -- --build` stages the npm package in `apps/cli/release/npm/`. `--publish` runs every other step and prints the publish command. | Create the npm org, run `npm login`, then `npm publish apps/cli/release/npm --access public` in your own terminal. |
| H3: the GitHub org and the public repo | Open, due before submission (Oct 14). | Every commit is on local `main`. No remote exists and nothing has been pushed. | Create the org and an empty public repo, then `git remote add origin …` and push. Before that, rotate the generated secrets (the H5 row). |
| H4: a Google OAuth client | Not done, and optional. Sign-in works with platform accounts (a handle and a password). | The redirect URIs are in [section 6](#6-urls). Migrations `0003_identities.sql` and later are applied on both stages. | Only if Google sign-in is wanted: create a Web client with the stage's redirect URI, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` together, then redeploy. |
| H5: secret values | Done by the agent on both stages, under a recorded decision that extends generated secrets to `demo` (see [Secrets](#secrets)). Not blocking. | Five values per stage, generated and kept only in that stage's secrets file outside the repo (mode 600), never printed or committed. `SESSION_TOKENS` on `demo` holds bram, ines-v, okafor, okonkwo, lin-h and the swarm's six (wren, tamsin, ivo, marisol, dagny, pell). | **Rotate both stages' generated secrets before the repo goes public**, and keep a copy of each stage's `MASTER_KEY` somewhere other than this machine. Rotating `PASSWORD_PEPPER` breaks every stored password, rotating `MASTER_KEY` loses every stored env value unless they are re-wrapped first, and rotating `SESSION_TOKENS` means each CLI profile logs in again. |
| H6: Workers Paid | Confirmed. | The account's subscriptions, read again on 2026-10-08, list `workers_paid` as Paid. The sandbox (containers) and both Workflows have run on `dev-oscabriel` since 2026-10-07. | Nothing. |
| H7: the recording | Open (Oct 13). | `docs/demo/` holds the script, the shot list and the rehearsal checklist. The demo stage is deployed and seeded (2026-10-08, 15:44 UTC), with nothing claimed; the rehearsal comes next. The recording lock exists: while `infra/.recording` is there, `infra/deploy.ts` refuses every deploy. | Run `bun infra/recording.ts on` before the first take and `bun infra/recording.ts off` after the last (the rehearsal checklist says when). |
| H8: submitting | Open, due Oct 14 by noon PDT. | The demo URL is `https://web-demo.oscargabriel.workers.dev` (section 6). | Submit the repo URL, the video and the demo URL. |
| H9: `docker login` | Not needed so far. No image pull has been rate-limited. | Nothing. | Only if a deploy's image pull is rate-limited: run `docker login` in your own terminal. |
| OpenCode Zen key for the swarm's pell | Not blocking: the fallback was taken on 2026-10-08. | pi here still has no OpenCode Zen key, so the roster now runs pell on `opencode-go/qwen3.8-flash`, as it ran in the swarm's live rehearsal on `dev-oscabriel`. | Nothing. To show Gemini flash in the take instead, add OpenCode Zen's key to pi and swap the roster's one line back. |
| Deleting the throwaways | Open, after the rehearsal. | The teardown plan (section 4). | Read the teardown script and run it in your own terminal. |

## 6. URLs

The account's workers.dev subdomain is in `infra/workers-dev.json`. The demo's rows are filled in when it is deployed.

| Stage | What | URL | State on 2026-10-08 |
| --- | --- | --- | --- |
| `dev-oscabriel` | platform | `https://platform-dev-oscabriel.oscargabriel.workers.dev` | deployed (`/health` answers 200); the core loop passed live twice on the 14:51 deploy |
| `dev-oscabriel` | web | `https://web-dev-oscabriel.oscargabriel.workers.dev` | deployed (`/` answers 200) |
| `dev-oscabriel` | CLI install | `https://platform-dev-oscabriel.oscargabriel.workers.dev/install.sh` | served from `releases-dev-oscabriel` |
| `dev-oscabriel` | Google redirect URI (H4) | `https://platform-dev-oscabriel.oscargabriel.workers.dev/oauth/google/callback` | not registered |
| `dev-oscabriel` | sandbox | none: it has no workers.dev route, and only the platform reaches it | deployed; the Checker's containers start on `standard-3` (2 vCPU, 8 GiB), the Lander's on `standard-2` |
| `demo` | platform | `https://platform-demo.oscargabriel.workers.dev` | deployed 2026-10-08 15:39 (`/health` answers 200), and smoke passed; seeded with `datekit` and `burrow`. An anonymous `git clone <platform>/datekit.git` works, and a contributor's token gets 403 on `datekit--maintainers.git`. |
| `demo` | web | `https://web-demo.oscargabriel.workers.dev` | deployed (`/` answers 200); the Playwright check of the deployed web passes |
| `demo` | CLI install | `https://platform-demo.oscargabriel.workers.dev/install.sh` | served from `releases-demo`: release `0.1.0-demo.802` (`bun run release -- --build --upload --stage demo --version 0.1.0-demo.802`, 2026-10-08 15:51), which installs and reads the demo |
| `demo` | Google redirect URI (H4) | `https://platform-demo.oscargabriel.workers.dev/oauth/google/callback` | not registered; the demo's deploy printed it |
| `demo` | sandbox | none: it has no workers.dev route | deployed; the Checker's containers start on `standard-3` (2 vCPU, 8 GiB), the Lander's on `standard-2` |

## Running a stage

### Before the first run

1. **Log Wrangler in**, once per machine: `apps/platform/node_modules/.bin/wrangler login`. Deploys and the D1, KV and R2 creates use this login, never the infra token. Once the login is stale, `wrangler d1 list` fails with `Authentication error [code: 10000]`, and `wrangler whoami` refreshes it.
2. **Set the infra credentials**, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, as `infra/.env.schema` describes. The token uses the "Read all resources" template plus Account › Artifacts › Edit. `bun run bootstrap` and `bun run ops` get them through `varlock run --path infra/`. To check they are set without seeing them, run `bun run env:check`.
3. **Confirm the plan**: Containers and Workflows need Workers Paid (H6, confirmed on this account in section 5).

### Bootstrap a stage

```sh
bun run bootstrap -- --stage dev-oscabriel
```

It refuses a stage that `stages.ts` doesn't declare. Then it:

1. reads what exists: the stage's two Artifacts namespaces (`projects-<s>` and `layers-<s>`) over REST, and the account's D1 databases, KV namespaces and R2 buckets through Wrangler;
2. creates only what is missing, so a second run creates nothing;
3. writes the new D1 and KV ids into the stage's block of `apps/platform/wrangler.jsonc`, touching nothing else in the file (commit that change);
4. applies the front page's migrations (`wrangler d1 migrations apply front-page-<s> --remote --env <s>`);
5. records the account's workers.dev subdomain in `infra/workers-dev.json`, so smoke knows where the stage lives;
6. checks by name that the platform Worker holds every secret its `.env.schema` requires. Before the platform exists there is nothing to hold them, so it says which ones the first deploy has to carry.

It never deletes anything and never prints or reads a secret's value.

`bun run bootstrap -- --stage <s> --dry-run` does only the first step and lists what the run would create. It creates nothing and writes no file. On a stage that is complete it prints `would create 0`.

### Secrets

`apps/platform/.env.schema` names them. Values never go in the repo.

| Name | Needed |
| --- | --- |
| `OPERATOR_TOKEN` | Always. The operator's bearer token, at least 32 characters. |
| `SESSION_TOKENS` | Optional. A JSON object from token to handle, for the demo's named people (the seed's deciders, the on-screen people and the swarm's contributors). |
| `COOKIE_KEY` | Always. Seals a sign-in in progress into its form (HMAC-SHA-256), at least 32 characters. |
| `PASSWORD_PEPPER` | Always. Every password is HMAC'd with it before PBKDF2, at least 32 characters. Changing it makes every stored password fail to verify. |
| `MASTER_KEY` | Always. 64 hex characters: the 256-bit key that wraps every write-only env value. Losing it loses every stored value, so keep a copy outside the machine. |

To set them for a stage, do one of these:

- **A generated secrets file (both stages).** Keep a dotenv file for the stage outside the repo with mode 600, holding crypto-random values (32 bytes in base64url each, and `MASTER_KEY` as 64 hex characters). Deploy with `STAGE_SECRETS_FILE=<that file> bun run deploy -- --stage <s>`. The platform's deploy step gets only the names `.env.schema` declares, as its environment, and that environment overrides any `.env` value. Nothing prints them. `dev-oscabriel` has used one since its first deploy. `demo` has had one since 2026-10-08, by a recorded decision made under the user's blanket approval, and the same values were set on `platform-demo` with `wrangler secret put` before its first deploy. Both stages' values were generated by the build's agent, so rotate them before the repo goes public (section 5).
- **varlock (H5).** Write `NAME=varlock(prompt)` for each one into `apps/platform/.env.local`, run `./node_modules/.bin/varlock load --path apps/platform/` in your own terminal, then deploy. `varlock-wrangler` hands the values to the Worker.
- **By hand**, one at a time: `apps/platform/node_modules/.bin/wrangler secret put <NAME> --env <s>` in `apps/platform`, with the value on stdin. On a stage whose platform isn't deployed yet, this makes `platform-<s>` as an empty placeholder Worker that the first deploy replaces. A deploy still needs the values through one of the two ways above, since varlock-wrangler resolves every required name.

Sign-in uses the platform's own accounts (handle and password), so no stage needs a third-party OAuth app. A stage's platform lives at `https://platform-<s>.<subdomain>.workers.dev`; the subdomain is in `infra/workers-dev.json` once bootstrap has run.

### Deploy a stage

```sh
bun run deploy -- --stage dev-oscabriel
```

Without `--stage`, or with a stage `stages.ts` doesn't declare, it refuses before it runs anything. It takes no other flag, and `verify` always runs first (AGENTS.md principle 11). In order, it runs:

1. `bun run verify`. If the gate is red, nothing after it runs.
2. The `sandbox` deploy (`wrangler deploy --env <s>`), first, because the platform's `SANDBOX` binding names it.
3. The `platform` deploy (`varlock-wrangler deploy --env <s>`), which resolves `.env.schema` and sends the secrets.
4. The `web` build and deploy.
5. A read-back of the push-event trigger (`bun run bootstrap -- --stage <s> --check-triggers`), because Wrangler's output doesn't prove it exists.
6. `bun scripts/smoke.ts --stage <s>`.

Then it prints the redirect URI a Google OAuth client registers for the stage (`<platform origin>/oauth/google/callback`, H4). Google sign-in stays off until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, and `migrations/0003_identities.sql` must be applied before they are.

Every command runs with `WRANGLER_SEND_METRICS=false`, and with its own folder's `node_modules/.bin` first on `PATH`, so each app deploys with its pinned Wrangler. The first failing step stops the deploy and names that step.

A stage's first deploy can stop in the `sandbox` step with Wrangler's "Timed out while preparing the container image on Cloudflare's network." Before it uploads the Worker, Wrangler asks Cloudflare to prepare each image that is new to the stage's registry repository, and it waits at most 15 minutes. When it stops there, nothing of the Worker has been uploaded: run the same deploy again. The image is already pushed, and its preparation goes on at Cloudflare between runs.

### Deploys of demo

`demo` is deployed only with a reason written here first, and never during a take (H7).

| When (UTC) | Build | Why |
| --- | --- | --- |
| 2026-10-08 15:39 | `c7b68ff`, the build that passed the core loop live on `dev-oscabriel` | The first deploy. It took three runs: twice (15:04 to 15:19 and 15:20 to 15:35) Cloudflare kept the new `sandbox-demo-lander-land` image's preparation pending past Wrangler's limit, though the same digest had been prepared for `dev-oscabriel` in about 30 s; the third run found it ready. |

### Smoke-test a stage

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

### Tear down a stage

None of this is automated, and it is the user's alone (section 4): no script deletes a stage's resources, and nobody runs `wrangler delete` or cf's `delete` without the user's OK (`wrangler delete` auto-confirms in a non-interactive shell). Tear down only what this build created, which means only names from section 2, and never `witness`. A person runs these in their own terminal. Wrangler's commands run from the app's folder with that app's `node_modules/.bin/wrangler`.

1. The Workers: `wrangler delete --env <s>` in `apps/web`, then `apps/platform`, then `apps/sandbox`. Then `wrangler workflows delete answer-<s>` and `wrangler workflows delete on-push-<s>`, if they remain.
2. The Artifacts repos, then the namespaces, `projects-<s>` and `layers-<s>` alike. List a namespace's repos with `bun run ops -- artifacts namespaces repos list --namespace <namespace>`, delete each one with `bun run ops -- artifacts namespaces repos delete <repo> --namespace <namespace> --force`, then `bun run ops -- artifacts namespaces delete --namespace <namespace>`. A namespace has to be empty before it can be deleted.
3. The database: `wrangler d1 delete front-page-<s>`.
4. The KV namespace: `wrangler kv namespace delete --namespace-id <id>`. The id is in the stage's block of `apps/platform/wrangler.jsonc`.
5. The buckets: empty `evidence-<s>` and `releases-<s>`, then run `wrangler r2 bucket delete evidence-<s>` and `wrangler r2 bucket delete releases-<s>`.
6. Put the stage's placeholder ids back in `apps/platform/wrangler.jsonc`.
