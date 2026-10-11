# Stages

A stage is one full copy of the platform on Cloudflare: its own Workers, Workflows, Artifacts namespaces (public and private), database, KV namespace and buckets. `infra/stages.ts` is the one table of stage names and resource names. Every other file, both `wrangler.jsonc` files included, matches it, and `packages/config/test/bootstrap.test.ts` checks that they do.

This file has five parts, then how to run a stage, and it ends with what is left for a person to do:

1. [Stages](#1-stages)
2. [Resources per stage](#2-resources-per-stage)
3. [Throwaway ledger summary](#3-throwaway-ledger-summary)
4. [Teardown policy](#4-teardown-policy)
5. [URLs](#5-urls)
6. [Running a stage](#running-a-stage)
7. [Human steps: status and next action](#human-steps-status-and-next-action)

Sections 1 to 5 hold the state as of 2026-10-08, 18:00 UTC, read from the account with read-only calls; the demo stage and the teardown plan were read again at 18:15 UTC and had not changed. The W9 deploys of 2026-10-09 (06:39 to 07:22 UTC, issue 914) are added to sections 1, 3 and 5; the imports and the two dev deploys of 08:01 and 08:06 UTC (issue 915) to sections 1, 3 and 5; the teardown record is unchanged. The W10 deploys of 2026-10-09 (18:55 to 19:51 UTC, issue 1009) and the `code-cache-<s>` buckets are added to sections 1, 2, 3 and 5. The human steps at the end hold their status as of 2026-10-08, 18:30 UTC.

## 1. Stages

| Stage | What it is for | State on 2026-10-08 |
| --- | --- | --- |
| `dev-oscabriel` | One person's iteration. Deploy it as often as you like. | Bootstrapped 2026-10-07 and deployed (platform, sandbox, web). Re-checked 2026-10-08: bootstrap created nothing, and the platform holds every required secret. The feature-frozen build was deployed at 14:51 UTC on 2026-10-08, and the whole core loop (`bun scripts/smoke.ts --stage dev-oscabriel --loop`) passed on it twice in a row. **W9** (2026-10-09): deployed at 06:41 UTC (`a4543f6`), 06:57 (`177ee96`, the code cache fix) and 07:12 UTC (`ecc2107`, the drafter fix), smoke 8 of 8 each time (`platform-root` included). The deployed-web checks pass on datekit (12 of 12) and on burrow (11 of 12: burrow has no answer landing on dev, so `why.e2e.ts` has no ask to name). `smoke --loop --draft` passed once at 07:15 UTC on `smoke-20261009-071255`: `@cf/moonshotai/kimi-k2.7-code`, red first on attempt 1 of 3, 59 s from proposal to draft, 160 s for the whole loop; estimated Workers AI cost about $0.01 per attempt (about 1.6k tokens in and 1 to 2k out, 480 to 750 neurons on the same call replayed). Eight open-source repos imported and kept from 07:35 UTC (issue 915; [Imported projects (kept)](#imported-projects-kept)); redeployed at 08:01 (`73adbab`) and 08:06 UTC (`a29af4e`) for the history-read fixes, smoke 8 of 8 each time; and at 08:45 UTC (`009640c`, the wave's close-out: the sign-in link without its `#fragment`, a README's `<style>` dropped whole, admission ids under long names, the people page's disclosure words), smoke 8 of 8. Demo was not redeployed for it: none of those changes what demo's pages or the take need. **W10** (2026-10-09): bootstrap made `code-cache-dev-oscabriel` at 18:54 UTC (a second run made nothing); deployed at 18:55 (`bd3598e`, the W10 build), 19:12 (`c0fe1c5`, trees kept in the code store, reverted by `2421226` after it slowed a repo's first walk), 19:24 (`8310fed`, a small file's history read whole at each commit), 19:31 (`69fe19f`), 19:36 and 19:38 UTC (`e90a730`, the second only to start every isolate afresh), smoke 8 of 8 each time; verify's bytes on `e90a730`: platform entry 1,679,621 of 1,900,000, sandbox 570,582 of 656,000, web entry 710,962 of 818,000 (JavaScript 3,565,596 of 4,075,000). Cold first views of why and of a file's log on changesets and click went from 18.6 to 39.6 s on the W9 build to 5.3 to 7.7 s, and the same address asked again answers in 0.1 to 1.7 s, under a second once an isolate has served it, after a redeploy too (issue 1009's comments hold the table). `smoke --loop` passed at 19:41 UTC on `smoke-20261009-193937`, its project and repo in the ledger before init finished. The deployed-web checks pass 13 of 13 on datekit and on burrow (why included: an opening's landing links the ask it opened), and `imports.e2e.ts` with `tags.e2e.ts` 74 of 74 once the tests `net::ERR_NETWORK_CHANGED` broke on this machine were asked again. **W11** (2026-10-10): deployed at about 01:00 UTC (`57bb629`, the W11 build), smoke 8 of 8; the deployed-web checks then failed 1 of 13, `datekit/format-ordinal.md`, because the new index banner came before the brief's `#` title (and before `/<project>/llms.txt`'s heading). Fixed test-first in `53896c9` (the banner goes under the title) and redeployed at about 01:14 UTC (`ca95612`), smoke 8 of 8, the deployed-web checks 13 of 13 on datekit and on burrow. The platform's `/` lists every project's own posture (datekit and its copies read "Open with sealed evidence"); with about 40 projects each list reads about 40 ledgers, and the platform's `/` answered in 0.2 to 1.1 s. **W12** (2026-10-10): bootstrap applied `0005_standing_postures.sql` (it created nothing); deployed at about 11:25 UTC (`7b8b393`, the Control room build with the review fixes), smoke 11 of 11, `web-agent-skills` over its 500 ms budget (3.3 s cold, 1.0 to 1.7 s after: a warning, not a failure). `smoke --loop` passed at 11:30 UTC on `smoke-20261010-113046`. The deployed-web checks pass 13 of 13 on datekit and on burrow; `/assets/*` answer `public, max-age=31536000, immutable`, and `/` answers `Accept: text/markdown` with 200. **W12 perf** (2026-10-10): deployed `5881ff2` (the minified web with its source maps uploaded, Workers Cache in front of the web, server highlighting), smoke 11 of 11 (cold-isolate warnings on the web's Markdown and skills reads). The deployed-web checks pass 13 of 13 on datekit and on burrow. `/datekit/tree/main` went MISS then HIT, 60 to 120 ms against 1.5 to 2 s from the Worker, with `vary: Cookie`; with a cookie, and on `/today`, BYPASS with `private, no-store`. `src/add.ts`'s blob page carries its highlighted file in a declarative shadow root. **Exit codes and `movedBy`** (2026-10-10): deployed at about 18:23 UTC (`a23e097`: the CLI's exit codes, ADR 0028, and `StaleBase`'s `movedBy`, ADR 0029), smoke 11 of 11 (`web-agent-skills` 4.7 s on a cold isolate, the Markdown reads 0.8 to 1.4 s: warnings). The deployed-web checks pass 13 of 13 on datekit and on burrow, and `/llms-full.txt` carries the Exit codes section and the `movedBy` guide. The CLI from this build, against the stage: `UnknownProject` and `UnknownAsk` exit 66, `status` signed out 77, an unreachable platform 69. `smoke --loop` passed at 18:28 UTC on `smoke-20261010-182620` (108.8 s, the landing 30.3 s). No conflicting answer was landed live, so `movedBy` has been seen only in the tests (the core loop names alice's landing). **W13** (2026-10-10): deployed at about 20:55 UTC (`18b5418`: the landing at `/`, `/home`, a short command's words kept whole), smoke 11 of 11 (`web-llms-txt`, `web-project-llms-txt`, `web-ask-md` and `web-agent-skills` over their 500 ms budgets on cold isolates, warnings). Thirty more open-source repos imported and kept from 20:57 to 21:29 UTC (issue 1331; [Imported projects (kept)](#imported-projects-kept)). Redeployed at about 22:08 UTC (`643ab22`: an adoption heard as a landing, 1316; a README symlink read where it points, 1317), smoke 11 of 11 (`web-agent-skills` 8.7 s on a new isolate with 76 projects' skills, a warning); `imports.e2e.ts` with `landing.e2e.ts` then passed 226 of 226 once two `net::ERR_NETWORK_CHANGED` tests were asked again, axum's home with its README included. **W13 close-out** (2026-10-11): deployed at about 00:45 UTC (`f224a14`: the landing's projects read on the server with each posture's badge, the root preload ceiling at 268,000 on the user's sign-off; an import's source kept on its record and shown on its page, ADR 0031), `verify` green and smoke 11 of 11 (`web-agent-skills` 7.1 s on a cold isolate, a warning). Then `scripts/import-examples.ts --stage dev-oscabriel --sources` kept the source of all 38 imports through a repeat `initProject` by the operator (the dry run listed the 38 first); a second run on `click` answered the same, and `/click` shows "Imported from https://github.com/pallets/click · branch main". Nothing was imported, seeded, drafted, claimed or landed, and the ledger did not change. |
| `demo` | The recording and the submission. Deploy it deliberately, and never while a take is being recorded (H7). | Bootstrapped 2026-10-08: six resources created, migrations `0001` to `0004` applied, and a second run created nothing. Its secrets are set. Deployed at 15:39 UTC on 2026-10-08 (the build the dev stage proved), and smoke passed. Seeded at 15:44 UTC with `datekit` (its maintainers layer and both sealed suites admitted) and `burrow` (the `drop-legacy-fetch` family), nothing claimed. The rehearsal (17:08 to 17:39 UTC) only read it, apart from ines-v's `env set SENTRY_AUTH_TOKEN` with a made-up value, which stays set for the take. At 18:13 UTC smoke passed 7 of 7, the deployed web's Playwright check passed 5 of 5, and burrow's six `drop-legacy-fetch-burrow-*` children were open and unclaimed. Each later deploy is listed, with its reason, in [Deploys of demo](#deploys-of-demo). **W9** (2026-10-09): deployed at 07:18 UTC (`ecc2107`; smoke failed only `platform-root`, a 404 from the W8 version as the upload finished, and passed 8 of 8 a minute later) and again at 07:22 UTC (`1a7bb89`, the same Worker code; smoke 8 of 8). The deployed-web checks pass 11 of 12 on datekit: `why.e2e.ts` needs an answer landing and demo has none, by design. Nothing was seeded, drafted, claimed or imported; it still holds `datekit` and `burrow`, and burrow's `drop-legacy-fetch` and its seven children are unclaimed. **W10** (2026-10-09): bootstrap made `code-cache-demo` at 19:49 UTC (a second run made nothing); deployed at 19:50 UTC (`34f8ec8`, the Worker code of `e90a730`), smoke 8 of 8. The deployed-web checks pass 13 of 13 on datekit with `WEB_WHY_PATH=.myr/asks/format-ordinal.ask.ts`, why included: the opening's row links its ask. The first run, four seconds after the deploy, failed the three pages that read the front page's projection and the project's home; a run a minute later passed all 13. `listProjects`, `listAsks burrow` and `listAsks datekit` read the same before and after: `datekit` and `burrow` only, every ask unclaimed. Nothing was seeded, drafted, claimed, imported or landed. Redeployed at 20:16 UTC (`4a23695`) with the wave's last fold-ins, smoke 8 of 8, the deployed-web checks 13 of 13 on datekit and on burrow; nothing else changed on demo. **W11** (2026-10-10): deployed at about 01:17 UTC (`ca95612`), smoke 8 of 8, the deployed-web checks 13 of 13 on datekit (with `WEB_WHY_PATH=.myr/asks/format-ordinal.ask.ts`) and on burrow. The platform's `/` read `burrow` Open with 7 open asks and `datekit` Open with 3 before; after, the same counts, and datekit reads "Open with sealed evidence", as its ledger does (D1). Nothing was seeded, drafted, claimed, imported or landed. **W12** (2026-10-10): bootstrap applied `0005_standing_postures.sql`; deployed at about 11:40 UTC (`905fec1`, the Worker code of `7b8b393`), smoke 11 of 11 (`web-agent-skills` 1.2 s, over its 500 ms budget, a warning). The deployed-web checks pass 13 of 13 on datekit (with `WEB_WHY_PATH=.myr/asks/format-ordinal.ask.ts`) and on burrow. The platform's `/` read `burrow` Open with 7 open asks and `datekit` Open with sealed evidence with 3, before and after. Nothing was seeded, drafted, claimed, imported or landed. **W12 perf** (2026-10-10): deployed `6269bf9` (the Worker code of `5881ff2`: the minified web, Workers Cache, server highlighting), smoke 11 of 11 (`web-llms-txt`, `web-project-llms-txt` and `web-ask-md` over their 500 ms budgets on the new version's cold isolates, warnings). The deployed-web checks pass 13 of 13 on datekit (with `WEB_WHY_PATH=.myr/asks/format-ordinal.ask.ts`) and on burrow. `/datekit` is a cache HIT at 50 to 80 ms with `vary: Accept, Cookie`, and BYPASS with `private, no-store` when the request carries a cookie. The platform's `/` read `burrow` with 7 open asks and `datekit` with 3, before and after. Nothing was seeded, drafted, claimed, imported or landed. **W13** (2026-10-10): deployed at about 22:18 UTC (`3a4d9c2`, the Worker code of `643ab22`), smoke 11 of 11 (`web-llms-txt`, `web-project-llms-txt`, `web-ask-md` and `web-agent-skills` over their 500 ms budgets on new isolates, warnings). The deployed-web checks pass 13 of 13 on datekit (with `WEB_WHY_PATH=.myr/asks/format-ordinal.ask.ts`) plus `landing.e2e.ts`'s 2, and 12 of 12 on burrow. `/` is the landing and `/asks` the front page. The platform's `/` read `burrow` Open with 7 open asks and `datekit` Open with sealed evidence with 3, before and after. Nothing was seeded, drafted, claimed, imported or landed. |

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
| R2 bucket (code history kept by commit: a why and a path's log, bound only by the platform as `CODE_CACHE`) | `code-cache-<s>` | bootstrap |
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
| R2 | `code-cache-dev-oscabriel` | bootstrap | 2026-10-09 18:54 | keep (needs the user to delete) |
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
| R2 | `code-cache-demo` | bootstrap | 2026-10-09 19:49 | keep (needs the user to delete) |
| Worker | `platform-demo`: made by the first `wrangler secret put` as a placeholder to hold the secrets; the first deploy gave it its code and its workers.dev route. | `wrangler secret put`, then deploy | 2026-10-08 13:58 (code 15:39) | keep (needs the user to delete) |
| Secrets on `platform-demo` | `OPERATOR_TOKEN`, `SESSION_TOKENS`, `COOKIE_KEY`, `PASSWORD_PEPPER`, `MASTER_KEY` | generated, set with `wrangler secret put` and carried by deploy (see [Secrets](#secrets)) | 2026-10-08 13:58 | keep (needs the user to delete); rotate before going public |
| Worker | `sandbox-demo` | deploy | 2026-10-08 15:39 | keep (needs the user to delete) |
| Container applications | `sandbox-checker-demo` (started on `standard-3`) and `sandbox-lander-demo` (`standard-2`), with their images `sandbox-demo-checker-check` and `sandbox-demo-lander-land` in the account's container registry | deploy | 2026-10-08 15:39 | keep (needs the user to delete) |
| Worker | `web-demo` | deploy | 2026-10-08 15:39 | keep (needs the user to delete) |
| Workflow | `answer-demo`, `on-push-demo` | deploy | 2026-10-08 15:39 | keep (needs the user to delete) |
| Push-event trigger | `projects-demo` → `on-push-demo` | deploy (read back by bootstrap) | 2026-10-08 15:39 | keep (needs the user to delete) |
| Seeded projects | `datekit` (with its `datekit--maintainers` layer repo in `layers-demo`) and `burrow` in `projects-demo` | seed | 2026-10-08 15:40 to 15:44 | keep: the recording takes them. Don't reseed over them; a fresh copy is `seed --as`. |

## 3. Throwaway ledger summary

A throwaway is something a smoke run, a swarm run or a `seed --as` copy makes on a stage, beside the stage's own resources. Each run appends one JSON line for each throwaway to `infra/created.jsonl` (`infra/created.ts`), and teardown acts only on those lines. When teardown deletes one, it appends a `deleted` line naming it (`deletedAt`, then its kind, name, namespace and stage). No line is ever rewritten or removed.

On 2026-10-08 at 18:00 UTC the ledger held 69 entries, all on `dev-oscabriel`: 16 projects and 53 repos. 914's runs on 2026-10-09 added 8 (3 projects, 5 repos), so it held 77. 915's imports on 2026-10-09 added 22 (8 projects, 8 repos, and 6 `tags backfilled` repo lines), so it held 99. 1009's `smoke --loop` on 2026-10-09 added 3 (a project, its repo and its claim's fork), so it holds 102, the imports listed under [Imported projects (kept)](#imported-projects-kept) and the rest below. None is marked deleted yet. A read-only listing found every one of the 53 repos still there:

| When (UTC) | By | Kind | Name | Where |
| --- | --- | --- | --- | --- |
| 2026-10-08 12:37 | swarm | repo | `burrow--drop-legacy-fetch-burrow-auth--wren` (a released claim's fork of the stage's `burrow`) | `projects-dev-oscabriel` |
| 2026-10-08 14:40 to 14:58 | smoke | project, repo, repo | four core-loop runs, `smoke-20261008-143944`, `smoke-20261008-144139`, `smoke-20261008-145551` and `smoke-20261008-145715`: each one's project, its repo, and its claim's fork `<project>--parse-year--bram` | `projects-dev-oscabriel` |
| 2026-10-08 14:52 to 14:54 | seed | project, repo, repo | `burrow-lint-807`, a `seed --as` copy of burrow that proved the Checker runs burrow's lint lane, with its repo and wren's claim fork `burrow-lint-807--drop-legacy-fetch-burrow-auth--wren` | `projects-dev-oscabriel` |
| 2026-10-08 16:07 to 16:21 | seed, swarm | 2 projects, 8 repos | the harness checks' copies: `datekit-803` (its repo, its layer repo `datekit-803--maintainers`, and bram's claim forks `--parse-iso-week--bram`, `--format-ordinal--bram` and `--add-months-clamp--bram`) and `burrow-803` (its repo, and tamsin's and ivo's claim forks) | `projects-dev-oscabriel`, the layer in `layers-dev-oscabriel` |
| 2026-10-08 16:29 to 16:41 | seed, swarm | 2 projects, 14 repos | the swarm's two live runs: `burrow-swarm-1` and `burrow-swarm-2`, each a `seed --as` copy of burrow with its repo and the six contributors' claim forks `<project>--drop-legacy-fetch-burrow-<package>--<handle>` | `projects-dev-oscabriel` |
| 2026-10-08 16:49 to 16:57 | smoke | 5 projects, 10 repos | five core-loop runs, `smoke-20261008-164858`, `smoke-20261008-165040`, `smoke-20261008-165218`, `smoke-20261008-165400` and `smoke-20261008-165645`, each with its repo and its claim's fork `<project>--parse-year--bram` | `projects-dev-oscabriel` |
| 2026-10-08 17:12 to 17:39 | seed, swarm | 2 projects, 10 repos | the rehearsal's copies: `datekit-805` (its repo, its layer repo `datekit-805--maintainers`, and bram's three claim forks) and `burrow-805` (its repo, and the claim forks of tamsin, ivo, marisol and dagny) | `projects-dev-oscabriel`, the layer in `layers-dev-oscabriel` |
| 2026-10-09 06:59 to 07:13 | smoke | 3 projects, 5 repos | three `--loop --draft` runs (914): `smoke-20261009-065926` (its repo and `--parse-year--bram`; its draft failed on the model's JSON), `smoke-20261009-071213` (its repo only: init made it, then its first push answered 500 seconds after a deploy, so the loop wrote nothing and 914 added both lines through `infra/created.ts`) and `smoke-20261009-071255` (its repo and `--parse-year--bram`; the draft passed and its ask opened there) | `projects-dev-oscabriel` |
| 2026-10-09 19:39 to 19:40 | smoke | project, repo, repo | one core-loop run (1009), `smoke-20261009-193937`: its project and repo, written at 19:39:42 before its init finished, and its claim's fork `--parse-year--bram` | `projects-dev-oscabriel` |

The live runs before the ledger existed left throwaways that it doesn't hold, all on `dev-oscabriel`. A read-only listing on 2026-10-08 at 18:00 UTC found each one still there:

- In `projects-dev-oscabriel`, 75 repos. Of these, 53 are the ledger's. `datekit` and `burrow` are the stage's seeded examples, and their forks `datekit--me--ines-v`, `datekit--format-ordinal--bram` and `datekit--add-months-clamp--bram` belong to them. The other 19 are test projects and their forks: `w3live-muyjz31t`, `w3live-muyk0528`, `w3live-muyk72qm`, `w3live-muykamf1`, `w3live-muyklikt` (with `--parse-iso--alice`), `w3live-muyl0wps` (with `--parse-iso--alice`), `w3live-muyl2z12` (with `--parse-iso--alice`), `scratch-onpush-muykseuk`, `w4-rehearsal` (with `--first-day--alice`, `--canada-sunday--alice`, `--brazil-sunday--alice` and `--mexico-sunday--alice`), and `w4-ratchet` (with `--no-any-in-parser--alice` and `--pad-day--bob`).
- In `layers-dev-oscabriel`, 3 repos: datekit's `datekit--maintainers` and the ledger's two copies' layers.
- The secret `S8B_PROBE` on `platform-dev-oscabriel`.
- The test accounts `w3tester-muyk9zdx` and `w5web-muz3airr` in `front-page-dev-oscabriel` (no identity or credit rows), and their OAuth grants in `oauth-dev-oscabriel`: one for `w5web-muz3airr` and two for `w3tester-muyk9zdx`.
- The Project Durable Objects and front-page rows of those test projects. They are harmless and are not deleted.

Imported projects (kept). `bun scripts/import-examples.ts --stage dev-oscabriel` imports the open-source repos the code browser is previewed on (anyhow, ky, gum, click, awesome, changesets, stb and fuzzel), one at a time, and records each in the ledger with `by: "import"`: one `project` line and one `repo` line in `projects-dev-oscabriel`, plus a `tags backfilled` note when `--tags` pushed their tags. They are not throwaways: teardown lists them as "kept imports" and never selects them, nor any fork of them, as it keeps the seeded examples. Deleting one is a person's Cloudflare delete. The script refused `demo` until 2026-10-11, when the user approved the same 38 imports onto demo (issue 1332, [Deploys of demo](#deploys-of-demo)); they are kept there as on dev, and the video shows them beside the fictional two.

#### Imported projects (kept)

Imported on 2026-10-09 between 07:35 and 07:42 UTC (issue 915), one at a time, by `bun --env-file=<dev secrets file> scripts/import-examples.ts --stage dev-oscabriel --only <p>`, with `--tags` under `bunx varlock run --path infra/ --` for every source that has tags. **Artifacts' import brings no tags**: anyhow's repo served 0 of its 105 after the import (`git ls-remote <platform>/anyhow.git 'refs/tags/*'`), and every other import with tags also came with none, so each was backfilled. An import of a `master` default leaves `refs/heads/master` frozen beside `main`. "Policy" is whether the config at the adopted commit evaluated: with no config folder the defaults apply and the run block comes from the repo's CI, and where the finder finds no test command there, the policy never evaluates (the people page says it has not been evaluated) and the platform lands no contribute-skill commit on top. Commits are the source branch's commits at import (`git rev-list --count`), plus the platform's one commit where the policy evaluated. The import time is the script's run, the backfill included. `bun infra/teardown.ts --stage dev-oscabriel` (read-only) lists all sixteen lines as kept imports and selects none.

| Project | Source | Branch | Commits | Tags | Policy | Web | Imported (UTC) | Took |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `anyhow` | https://github.com/dtolnay/anyhow | `master` | 932 + 1 | 0, then 105 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/anyhow | 07:35 | 25 s, backfill 7 s |
| `ky` | https://github.com/sindresorhus/ky | `main` | 592 + 1 | 0, then 99 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/ky | 07:38 | 42 s |
| `gum` | https://github.com/charmbracelet/gum | `main` | 684 | 0, then 29 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/gum | 07:39 | 17 s |
| `click` | https://github.com/pallets/click | `main` | 3,379 | 0, then 71 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/click | 07:39 | 33 s |
| `awesome` | https://github.com/sindresorhus/awesome | `main` | 1,209 | none at the source | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/awesome | 07:40 | 15 s |
| `changesets` | https://github.com/changesets/changesets | `main` | 985 + 1 | 0, then 740 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/changesets | 07:40 | 66 s |
| `stb` | https://github.com/nothings/stb | `master` | 2,232 | none at the source | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/stb | 07:41 | 50 s |
| `fuzzel` | https://codeberg.org/dnkl/fuzzel | `master` | 1,499 | 0, then 38 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/fuzzel | 07:42 | 26 s |
| `hono` | https://github.com/honojs/hono | `main` | 2,878 + 1 | 0, then 468 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/hono | 20:57 | 103 s |
| `express` | https://github.com/expressjs/express | `master` | 6,181 + 1 | 0, then 306 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/express | 20:59 | 111 s |
| `fastify` | https://github.com/fastify/fastify | `main` | 4,894 + 1 | 0, then 333 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/fastify | 21:01 | 104 s |
| `zustand` | https://github.com/pmndrs/zustand | `main` | 1,382 + 1 | 0, then 137 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/zustand | 21:03 | 67 s |
| `immer` | https://github.com/immerjs/immer | `main` | 1,571 + 1 | 0, then 170 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/immer | 21:04 | 60 s |
| `nanoid` | https://github.com/ai/nanoid | `main` | 1,289 + 1 | 0, then 134 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/nanoid | 21:05 | 59 s |
| `commander` | https://github.com/tj/commander.js | `master` | 1,517 + 1 | 0, then 126 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/commander | 21:06 | 59 s |
| `execa` | https://github.com/sindresorhus/execa | `main` | 877 + 1 | 0, then 67 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/execa | 21:07 | 62 s |
| `chalk` | https://github.com/chalk/chalk | `main` | 380 + 1 | 0, then 46 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/chalk | 21:08 | 47 s |
| `mitt` | https://github.com/developit/mitt | `main` | 139 + 1 | 0, then 12 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/mitt | 21:09 | 38 s |
| `clsx` | https://github.com/lukeed/clsx | `master` | 82 + 1 | 0, then 15 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/clsx | 21:09 | 40 s |
| `ripgrep` | https://github.com/BurntSushi/ripgrep | `master` | 2,287 | 0, then 272 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/ripgrep | 21:10 | 77 s |
| `serde` | https://github.com/serde-rs/serde | `master` | 4,366 + 1 | 0, then 323 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/serde | 21:11 | 96 s |
| `axum` | https://github.com/tokio-rs/axum | `main` | 2,017 + 1 | 0, then 223 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/axum | 21:13 | 73 s |
| `fd` | https://github.com/sharkdp/fd | `master` | 2,044 + 1 | 0, then 45 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/fd | 21:14 | 51 s |
| `hyperfine` | https://github.com/sharkdp/hyperfine | `master` | 1,212 | 0, then 30 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/hyperfine | 21:15 | 37 s |
| `bubbletea` | https://github.com/charmbracelet/bubbletea | `main` | 1,890 + 1 | 0, then 109 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/bubbletea | 21:16 | 63 s |
| `fzf` | https://github.com/junegunn/fzf | `master` | 3,750 + 1 | 0, then 179 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/fzf | 21:17 | 73 s |
| `cobra` | https://github.com/spf13/cobra | `main` | 1,106 | 0, then 29 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/cobra | 21:18 | 36 s |
| `gin` | https://github.com/gin-gonic/gin | `master` | 2,023 + 1 | 0, then 38 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/gin | 21:18 | 56 s |
| `requests` | https://github.com/psf/requests | `main` | 6,495 | 0, then 162 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/requests | 21:19 | 69 s |
| `flask` | https://github.com/pallets/flask | `main` | 5,562 | 0, then 69 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/flask | 21:20 | 67 s |
| `httpx` | https://github.com/encode/httpx | `master` | 1,523 | 0, then 88 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/httpx | 21:22 | 52 s |
| `typer` | https://github.com/fastapi/typer | `master` | 1,781 | 0, then 86 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/typer | 21:22 | 54 s |
| `jinja` | https://github.com/pallets/jinja | `main` | 2,949 | 0, then 55 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/jinja | 21:23 | 58 s |
| `lua` | https://github.com/lua/lua | `master` | 5,861 | 0, then 60 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/lua | 21:24 | 102 s |
| `jq` | https://github.com/jqlang/jq | `master` | 1,963 | 0, then 19 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/jq | 21:26 | 51 s |
| `kilo` | https://github.com/antirez/kilo | `master` | 20 | none at the source | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/kilo | 21:27 | 22 s |
| `sinatra` | https://github.com/sinatra/sinatra | `main` | 4,684 | 0, then 158 backfilled | not evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/sinatra | 21:27 | 71 s |
| `nvm` | https://github.com/nvm-sh/nvm | `master` | 2,448 + 1 | 0, then 107 backfilled | evaluated | https://web-dev-oscabriel.oscargabriel.workers.dev/nvm | 21:28 | 69 s |

From `apps/web`, `WEB_URL=https://web-dev-oscabriel.oscargabriel.workers.dev bun run e2e -- imports.e2e.ts` passes 73 of 73: eight pages per project (home with the README and clone box, a nested folder, a file at `#L5`, the log, the newest commit, refs, people, why), each repo's own checks, and the timed first views. The first view of `why` and of a path's log took 64 to 81 s before `73adbab` and `a29af4e` (history read sixteen commits and versions at a time) and 14 to 28 s after them; see issue 915's comments.

The thirty well-known imports after `fuzzel` went in on 2026-10-10 between 20:57 and 21:29 UTC (issue 1331), one at a time, by `bunx varlock run --path infra/ -- bun --env-file=<dev secrets file> scripts/import-examples.ts --stage dev-oscabriel --only <p> --tags`, each warmed by the script (five pages read; axum three). Every source with tags had them backfilled; `kilo` has none at the source. Commits are the source branch's at its imported head (`git rev-list --count`), plus one where the policy evaluated; "Policy" is read as whether `main` stands on a platform commit above the source's head. `bun infra/teardown.ts --stage dev-oscabriel` (read-only) then listed 76 kept import lines, every project and repo of the 38, and selected none of them. Since 2026-10-11 each import's page names its source and branch under "Imported from" (ADR 0031), backfilled by `--sources`.

From `apps/web`, `WEB_URL=https://web-dev-oscabriel.oscargabriel.workers.dev bun run e2e -- imports.e2e.ts landing.e2e.ts` passed 225 of 226 once its stale checks were brought up to the pages (the clone step is the facts' "Take part", the people rows are list items, the why page has no "Why each line is there" line, and gum's newest commit is an empty version bump) and the `net::ERR_NETWORK_CHANGED` tests were asked again. The one failure was `axum`'s home: its root `README.md` is a symlink to `axum/README.md`, and the home showed only a regular file as the README. 1317 reads a README symlink where it points, inside the repo, and after its deploy all 226 pass.

**Not listed:** a project enters the front page's `projects` table on its first event, and before 1316 an import whose policy never evaluates had none. Since 1316 an adoption is heard as a landing, so every later import is listed; these 17 were adopted before it and stay unlisted until something happens in them (a teardown cannot free their names: each project's Durable Object stays). So 17 of the 38 (`gum`, `click`, `awesome`, `stb`, `fuzzel`, `ripgrep`, `hyperfine`, `cobra`, `requests`, `flask`, `httpx`, `typer`, `jinja`, `lua`, `jq`, `kilo`, `sinatra`) answer at their own addresses but are missing from `listProjects`, the platform's `/`, the landing and `/asks`; and `import-examples` without `--only` takes them for new imports.

`demo` has no throwaways: `projects-demo` holds `datekit` and `burrow`, and `layers-demo` holds `datekit--maintainers`. Nothing that makes throwaways is meant to run there before the take: the core-loop smoke and the swarm's rehearsals run on the dev stage, the swarm on a `seed --as` copy. The take's swarm on demo's `burrow` will record its claim forks in the ledger; teardown never selects them (section 4).

## 4. Teardown policy

- This build deletes only throwaway resources recorded in `infra/created.jsonl` that it no longer needs.
- It never deletes a stage's Workers, namespaces, D1, KV or R2 without the user.
- It never touches `witness`.

No agent deletes a Cloudflare resource itself. Teardown first prints its plan: the ledger's entries that still exist, minus every stage's own names and `witness`. The deletes in that plan, together with the pre-ledger leftovers in section 3 that still exist, are written into one script that the user reads and then runs in their own terminal. A stage itself is torn down only by hand, by the user, as [Tear down a stage](#tear-down-a-stage) says.

### The teardown tool

```sh
bunx varlock run --path infra/ -- bun infra/teardown.ts                 # print the plan
bunx varlock run --path infra/ -- bun infra/teardown.ts --apply         # delete exactly that plan
bunx varlock run --path infra/ -- bun infra/teardown.ts --keep burrow-805 --stage dev-oscabriel
```

It reads the ledger, asks the account which of its repos and namespaces still exist (with the infra token, one name at a time), and prints the plan: what it would delete, what is already gone, and what the ledger holds but no plan may select. Without `--stage` it covers every declared stage the ledger names. `--keep <project>` leaves a `seed --as` copy's repo and every `<project>--…` fork out of the plan. Only `--apply` deletes, repos first and newest first, so a fork goes before what it forks, and a namespace last, since Artifacts deletes only an empty one. Repos go through `@repo/artifacts`' REST adapter. Each one deleted gets its `deleted` line at once, so a run that stops partway is finished by running it again. While `infra/.recording` exists, `--apply` is refused with `RecordingInProgress` before anything is read.

No plan ever holds:

- a name the ledger doesn't hold, whatever it is called;
- either Artifacts namespace of any declared stage (`projects-<s>`, `layers-<s>`), or anything in `witness`, which is never even read;
- the seeded examples `datekit`, `datekit--maintainers` and `burrow`, or any fork of `datekit` or `burrow`. A claim made on demo's `burrow` during the take is recorded in the ledger and has to outlive teardown;
- a Worker, a D1 database, a KV namespace or an R2 bucket. Those are not Artifacts, so no listing names them;
- a project's Durable Object or front-page row. A project entry stays, and the plan says so.

### The teardown record

| When (UTC) | What |
| --- | --- |
| 2026-10-08 18:00 | `bun infra/teardown.ts` printed the plan for `dev-oscabriel`: **52 repos to delete**. These are all of the ledger's repos except `burrow--drop-legacy-fetch-burrow-auth--wren`, a fork of the stage's `burrow` that is never selectable. 50 are in `projects-dev-oscabriel`: nine smoke runs' repos and forks, `burrow-lint-807`, `burrow-803`, `datekit-803`, `burrow-swarm-1`, `burrow-swarm-2`, `burrow-805` and `datekit-805`, each with its claim forks. 2 are in `layers-dev-oscabriel`: `datekit-803--maintainers` and `datekit-805--maintainers`. The 16 projects' Durable Objects and front-page rows stay. Nothing was deleted. |
| 2026-10-08 18:00 | The build's agent wrote the user's teardown script. It runs the plan with `--apply`. It also deletes the 19 pre-ledger test repos in section 3, wren's fork of `burrow` (only while dev's web still shows that ask open and unclaimed), `S8B_PROBE`, the two test accounts and their three OAuth grants. Each one is checked again just before its delete. The script refuses to run while `infra/.recording` exists. |
| when the user runs it | The ledger's `deleted` lines record each repo the tool deleted, and when. Commit `infra/created.jsonl` afterwards. |
| 2026-10-11 02:31 to 02:33 | Run, on the user's approval ("do the next steps you marked as for me yourself, they're approved"). The plan printed first listed **63 repos to delete** in `projects-dev-oscabriel` (the ledger's throwaways, grown since 2026-10-08 by the smoke runs of 914, 1009, W12 and the exit-codes deploy) and kept every import (38 projects, 38 repos) and `burrow--drop-legacy-fetch-burrow-auth--wren`; `--apply` deleted 63 of 63, each marked `deleted` in the ledger, and a plan printed after it lists nothing to delete. The 22 throwaway projects' Durable Objects and front-page rows stay, as the policy says. The pre-ledger leftovers in section 3, the test accounts and the grants were not touched: they are outside the ledger, and the user's own script holds them. |

Kept, and why:

- **The demo stage, whole.** It holds the recording and the submission.
- **The dev stage's own resources** (section 2) and its seeded `datekit` (with `datekit--maintainers`) and `burrow`. The user decides whether to tear the stage down after submission.
- **Dev's forks of datekit.** `datekit--me--ines-v` is ines-v's working fork. `datekit--format-ordinal--bram` holds bram's landed answer and its verdict notes. `datekit--add-months-clamp--bram` belongs to a claim that is open again.
- **Every project's Durable Object and front-page row.** They are harmless, and not billed at this size. A test project's row stays on dev's front page after its repo is gone.
- **Finished `Answer` Workflow instances** on `platform-dev-oscabriel`. They are records, not resources.
- **Any `--as` copy the user still wants.** Add `--keep <project>` to the script's two teardown lines.

## 5. URLs

The account's workers.dev subdomain is in `infra/workers-dev.json`. The demo's rows are filled in when it is deployed.

| Stage | What | URL | State on 2026-10-08 |
| --- | --- | --- | --- |
| `dev-oscabriel` | platform | `https://platform-dev-oscabriel.oscargabriel.workers.dev` | deployed (`/health` answers 200); the core loop passed live twice on the 14:51 deploy; the W9 build since 2026-10-09 (`ecc2107` at 07:12), whose `/` answers 200 with HTML, or Markdown for `Accept: text/markdown`; the W10 build since 2026-10-09 19:36 (`e90a730`) |
| `dev-oscabriel` | web | `https://web-dev-oscabriel.oscargabriel.workers.dev` | deployed (`/` answers 200); W9's code browser, why, people and proposal pages pass the deployed-web checks; the eight imports (`/anyhow`, `/ky`, `/gum`, `/click`, `/awesome`, `/changesets`, `/stb`, `/fuzzel`) pass `imports.e2e.ts` |
| `dev-oscabriel` | CLI install | `https://platform-dev-oscabriel.oscargabriel.workers.dev/install.sh` | served from `releases-dev-oscabriel` |
| `dev-oscabriel` | Google redirect URI (H4) | `https://platform-dev-oscabriel.oscargabriel.workers.dev/oauth/google/callback` | not registered |
| `dev-oscabriel` | sandbox | none: it has no workers.dev route, and only the platform reaches it | deployed; the Checker's containers start on `standard-3` (2 vCPU, 8 GiB), the Lander's on `standard-2` |
| `demo` | platform | `https://platform-demo.oscargabriel.workers.dev` | deployed 2026-10-08 15:39 (`/health` answers 200), and smoke passed; seeded with `datekit` and `burrow`. An anonymous `git clone <platform>/datekit.git` works, and a contributor's token gets 403 on `datekit--maintainers.git`. Redeployed with the W9 build on 2026-10-09 07:22 (`1a7bb89`); `/` answers 200. |
| `demo` | web | `https://web-demo.oscargabriel.workers.dev` | deployed (`/` answers 200); the Playwright check of the deployed web passes; after the W9 deploy, 11 of 12 (all but why, which needs an answer landing demo has not got); after the W10 deploy (2026-10-09 19:50, `34f8ec8`), 13 of 13, why included |
| `demo` | CLI install | `https://platform-demo.oscargabriel.workers.dev/install.sh` | served from `releases-demo`: release `0.1.0-demo.802` (`bun run release -- --build --upload --stage demo --version 0.1.0-demo.802`, 2026-10-08 15:51), which installs and reads the demo |
| `demo` | Google redirect URI (H4) | `https://platform-demo.oscargabriel.workers.dev/oauth/google/callback` | not registered; the demo's deploy printed it |
| `demo` | sandbox | none: it has no workers.dev route | deployed; the Checker's containers start on `standard-3` (2 vCPU, 8 GiB), the Lander's on `standard-2` |

## Running a stage

### Before the first run

1. **Log Wrangler in**, once per machine: `apps/platform/node_modules/.bin/wrangler login`. Deploys and the D1, KV and R2 creates use this login, never the infra token. Once the login is stale, `wrangler d1 list` fails with `Authentication error [code: 10000]`, and `wrangler whoami` refreshes it.
2. **Set the infra credentials**, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, as `infra/.env.schema` describes. The token uses the "Read all resources" template plus Account › Artifacts › Edit. `bun run bootstrap` and `bun run ops` get them through `varlock run --path infra/`. To check they are set without seeing them, run `bun run env:check`.
3. **Confirm the plan**: Containers and Workflows need Workers Paid (H6, confirmed on this account: see [the human steps](#human-steps-status-and-next-action)).

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

- **A generated secrets file (both stages).** Keep a dotenv file for the stage outside the repo with mode 600, holding crypto-random values (32 bytes in base64url each, and `MASTER_KEY` as 64 hex characters). Deploy with `STAGE_SECRETS_FILE=<that file> bun run deploy -- --stage <s>`. The platform's deploy step gets only the names `.env.schema` declares, as its environment, and that environment overrides any `.env` value. Nothing prints them. `dev-oscabriel` has used one since its first deploy. `demo` has had one since 2026-10-08, by a recorded decision made under the user's blanket approval, and the same values were set on `platform-demo` with `wrangler secret put` before its first deploy. Both stages' values were generated by the build's agent, so rotate them before the repo goes public (H5 in [the human steps](#human-steps-status-and-next-action)).
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
| 2026-10-09 07:18 and 07:22 (914) | `ecc2107`, then `1a7bb89` (the same Worker code; only smoke's `platform-root` patience changed) | The W9 build (the platform's `/` page, the code browser, why, people, drafted asks): the user approved W9 after the build closed, `infra/.recording` was absent, and `dev-oscabriel` passed smoke, the deployed-web checks and `smoke --loop --draft` on this Worker code first. The first run's smoke failed `platform-root` on a 404 the W8 version gave as the upload finished; the second passed 8 of 8. Nothing is seeded, drafted, claimed or imported on demo; burrow's children were checked unclaimed before and after. |
| 2026-10-09 19:50 (1009) | `34f8ec8` (the Worker code of `e90a730`), the W10 build | The W10 build, at the user's request ("fix all of those, then redeploy demo"): an opening's landing now links the ask it opened, so why on demo's datekit and burrow names an ask; why and a file's log are kept by commit in the new `code-cache-demo` bucket and walk a small file by reading it whole (fast cold, under a second warm); the people page says why a policy has not evaluated; the home page's README comes with the server's render; tags list by package; footnote links jump; the drafting fixes (a draft keeps its note and an earlier ready draft; the proposal pages' signed-out and unread states). `infra/.recording` was absent, and `dev-oscabriel` passed smoke, `smoke --loop` and the deployed-web checks on this Worker code first. Bootstrap adds one empty bucket; nothing is seeded, drafted, claimed, imported or landed on demo. |
| 2026-10-09 20:16 (1099) | `4a23695` (the Worker code of `2587726`), the wave's last fold-ins | The user's request ("fix all of those, then redeploy demo") once the wave's leftovers were fixed, and what demo shows changed: an opening is now heard as a landing (the project page's landings list shows new openings, code views refresh live when an ask opens), the log and commit pages link an opening's ask, a why row no longer says "Open ask" twice, and the CLI writes decider globs as code. `infra/.recording` was absent, and `dev-oscabriel` passed smoke 8 of 8 and the deployed-web checks (datekit 13 of 13, burrow 13 of 13) on this Worker code first (20:13-20:15 UTC). No bootstrap step; nothing is seeded, drafted, claimed, imported or landed on demo. Deployed 20:16:30-20:18:19 (verify again; platform startup 105 ms, web 13 ms), smoke 8 of 8; the deployed-web checks a minute later: datekit 13 of 13 (with `WEB_WHY_PATH=.myr/asks/format-ordinal.ask.ts`) and burrow 13 of 13 (`WEB_PROJECT=burrow` alone), why included on both. `listProjects` and `listAsks` for both read the same before and after, every ask unclaimed. |
| 2026-10-10 about 01:17 (W11) | `ca95612`, the W11 build with the banner fix | At the user's request ("yes", asked whether to deploy W11 to demo after dev passed). What demo shows changed: datekit's posture badge reads "Open with sealed evidence" everywhere (D1), the Agents page and its nav entry, `/llms-full.txt` and the index banner under each Markdown title, the answer page's links to its base and landing commits, clearer refusal words (a limit's refusal names its kind and its wait), code reads on MCP, and a fork that takes branches only. `infra/.recording` was absent, and `dev-oscabriel` had passed smoke and the deployed-web checks on the same build. This row was written just after the deploy, not before it. |
| 2026-10-10 about 11:40 (W12) | `7b8b393`, the W12 build with the review fixes | At the user's request ("you deploy everything", their answer to who deploys W12). What demo shows changes throughout: every page sits in the Control room shell (rail, main pane, facts inspector; a bottom bar on phones), the front page and a project's home arrive server-rendered with families drawn as fans and posture once per project, the ask and answer pages lead with state and whose move, Today has sections and every choice its consequence, the code browser is a full-viewport app, the person page sets credit in words, For agents is one reference, and the platform's own sign-in and `/` pages share the web's tokens. `/` and `/<project>` answer Markdown to agents. Bootstrap first applies migration `0005_standing_postures.sql` (the kept postures behind project lists). `infra/.recording` was absent, and `dev-oscabriel` had passed smoke, `smoke --loop` and the deployed-web checks (13 of 13 on datekit and on burrow) on the same build. Nothing is seeded, drafted, claimed, imported or landed on demo. |
| 2026-10-10 (W12 perf) | `5881ff2`, the W12 performance sign-offs | At the user's request ("Yes, do it, and all recommended steps", their sign-off on 1297's items). What demo shows changes in speed, not in words: the web's server build is minified (JavaScript 4.07 MB to 2.77 MB with highlighting, entry 696 KB to 309 KB) with its source maps uploaded; Workers Cache keeps the web's anonymous pages at the edge (a request with any cookie or an `Authorization` is never served or stored from it, ADR 0026); a blob page's file and a commit page's first files arrive highlighted from the server in a fixed set of languages (ADR 0027). `infra/.recording` was absent, and `dev-oscabriel` passed smoke 11 of 11, the deployed-web checks (13 of 13 on datekit and on burrow), a cache MISS then HIT at 60 to 120 ms with `vary: Cookie`, BYPASS with a cookie and on `/today`, and server-highlighted HTML on a blob page, on the same build. No bootstrap step; nothing is seeded, drafted, claimed, imported or landed on demo. |
| 2026-10-10 (W13, 1332) | `643ab22`, the W13 build: group A, 1331's import check, 1316 and 1317 | At the user's request ("do all recommended next steps",, which named this deploy; the build plan approves a W13 deploy of demo ahead of time) once `dev-oscabriel` passed smoke and the imports and landing checks on the same code. What demo shows changes at its addresses: `/` is now the landing (what the platform is, the open asks first, the gate's refusal as git prints it, the projects), the front page moves to `/asks`, `/home` is a signed-in person's own page, a short command's words stay whole, and a project's adoption is heard as a landing. The shot list's `/` shots move to `/asks` before the take (1399). Nothing is imported, seeded, drafted, claimed or landed on demo; its `datekit` and `burrow` are only read. |
| 2026-10-11 (W13 close-out, 1332) | `99a517b` (the Worker code of `f224a14`): the landing's projects read on the server with each posture's badge, and an import's source kept on its record and shown on its page (ADR 0031) | At the user's request ("do the next steps you marked as for me yourself, they're approved": the demo deploy, the 38 imports onto demo and dev's teardown were the three held). What demo shows changes: `/` names its projects in the HTML as sent, each with its posture badge, and a project page shows "Imported from" for an import. The deploy comes first because the imports that follow it keep their source only on a platform that holds this code. `infra/.recording` is absent, and `dev-oscabriel` passed `verify`, smoke 11 of 11 and the source backfill of all 38 imports on the same code. No bootstrap step. After it, `scripts/import-examples.ts --stage demo --sources` imports the 38 open-source repos onto demo, kept as on dev, the first imports demo has had; nothing is seeded, drafted, claimed or landed. This row is written before the deploy. |

### Smoke-test a stage

```sh
bun run smoke -- --stage dev-oscabriel
bun run smoke -- --stage dev-oscabriel --url http://localhost:8787
```

The second form points smoke at another origin, such as `wrangler dev --env dev-oscabriel` in `apps/platform`. Plain `wrangler dev` serves stage `local`, which no `--stage` names, so its `health` probe fails. Smoke finds the stage's web at `https://web-<s>.<subdomain>.workers.dev`; with `--url` it probes a web only when `--web-url <origin>` names one.

Smoke only reads, from the platform and then the web. Every probe runs even when others fail, and the output names each probe that failed and why. It also prints how long each probe took. A probe the platform answers with its own failure (a 5xx, or an RPC defect) asks again every second for up to 30 s, since a fresh deploy gives those for its first seconds (seen on `dev-oscabriel`'s first deploy). So does a 404 from the web's two probes and from `platform-root`: a first deploy's hostname, or the version before a deploy that adds a route, answers 404 for a moment (seen on demo's W9 deploy). Any other wrong answer fails the probe at once.

| Probe | Passes when |
| --- | --- |
| `health` | `GET /health` answers `200 {"ok":true,"stage":"<s>"}`, naming the stage asked for |
| `oauth-metadata` | `GET /.well-known/oauth-protected-resource` answers 200 with JSON that names its `resource` |
| `mcp-needs-credential` | `POST /mcp` without a credential answers 401 |
| `anonymous-unknown-project` | an anonymous `/rpc` `listAsks` for `no-such-project` answers with a typed `UnknownProject` |
| `missing-repo-404` | `GET /no-such-project.git/info/refs?service=git-upload-pack` answers 404 |
| `platform-root` | the platform's `GET /` answers 200 with a page that names its MCP endpoint (`/mcp`) and the CLI's `install.sh` |
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

## Human steps: status and next action

Only a person can take these steps. No agent buys or registers anything, pushes, adds a git remote, publishes to npm, reads the closed env files or deletes a Cloudflare resource. The status is as of 2026-10-08, 18:30 UTC. "Agent" means the build's agent.

| Step | Status | What the agent prepared | Your exact next action |
| --- | --- | --- | --- |
| H1: a custom domain | Not done, and optional. Both stages live on workers.dev. | Nothing needs it. | Only if you want one: buy the domain, which is a purchase and yours to make, then ask the agent. It adds `routes` to each `wrangler.jsonc` and deploys `demo` outside a take, with the reason in [Deploys of demo](#deploys-of-demo). |
| H2: the npm org, and publishing the CLI | Open, and optional for the submission: both stages already serve the CLI from their own install line ([section 5](#5-urls)). | `bun run release -- --build` stages the package `@myr/cli` in `apps/cli/release/npm/`. Under an agent, `--publish` checks the staged package and prints the command without running it. Known before publishing: `--version` prints `0.0.0` in the built CLI, and the npm build cannot evaluate a TypeScript config folder on its own. | Create the npm org `myr` and run `npm login`. Then, from the repo root in your own terminal (not inside an agent session), run `bun run release -- --build --publish --version 0.1.0`. |
| H3: the GitHub org and the public repo | Open, due before submission (Oct 14). | Every commit is on local `main`. No remote exists and nothing has been pushed. `bun run verify` passes on the last commit. | Rotate the generated secrets first (H5). Create the org `getmyr` and an empty public repo `getmyr/myr`, then run `git remote add origin https://github.com/getmyr/myr.git` and `git push -u origin main`. |
| H4: a Google OAuth client | Not done, and optional. Sign-in works with platform accounts (a handle and a password). | Migrations `0003_identities.sql` and later are applied on both stages. Each deploy printed its redirect URI: `https://platform-demo.oscargabriel.workers.dev/oauth/google/callback` and `https://platform-dev-oscabriel.oscargabriel.workers.dev/oauth/google/callback`. | Only if you want "Continue with Google": create a Web client in the Google Cloud console with the stage's redirect URI above, exactly as printed. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` together to the stage's secrets ([Secrets](#secrets)), then deploy the stage outside a take. |
| H5: secret values | Done by the agent on both stages, under a recorded decision that extends generated secrets to `demo` ([Secrets](#secrets)). No secret is missing. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are optional and come only with H4. | Five values per stage (`OPERATOR_TOKEN`, `SESSION_TOKENS`, `COOKIE_KEY`, `PASSWORD_PEPPER`, `MASTER_KEY`). Each was generated and is kept only in that stage's secrets file, outside the repo with mode 600, and was never printed or committed. `SESSION_TOKENS` on `demo` holds bram, ines-v, okafor, okonkwo, lin-h and the swarm's six (wren, tamsin, ivo, marisol, dagny, pell). | **After the last take and before the repo goes public (H3), rotate both stages' generated secrets.** Write new values into each stage's secrets file, then run `STAGE_SECRETS_FILE=<that file> bun run deploy -- --stage <s>`, outside a take. Keep a copy of each `MASTER_KEY` off this machine. Rotating `PASSWORD_PEPPER` breaks every stored password, and rotating `MASTER_KEY` loses every stored env value, so set demo's `SENTRY_AUTH_TOKEN` again with `env set`. Rotating `SESSION_TOKENS` means each CLI profile logs in again. |
| H6: Workers Paid | Confirmed. | The account's subscriptions, read again on 2026-10-08, list `workers_paid` and `r2_paid` as Paid. Containers and both Workflows run on both stages. | Nothing. |
| H7: the recording | Open. `demo` is deployed, seeded and smoke-clean, with nothing claimed, and every shot was walked once on 2026-10-08. | `docs/demo/` holds the script, the shot list and the rehearsal checklist, with each failed shot's fallback. While `infra/.recording` exists, `infra/deploy.ts` refuses every deploy and teardown's `--apply` refuses to run. | Walk the pre-flight in `docs/demo/rehearsal.md` on the morning of the take. Run `bun infra/recording.ts on` before the first take and `bun infra/recording.ts off` after the last. Any fix you want shown first (for example datekit's "Open" badge on the front page, or a seeded person signing in on the web) is a code change and a `demo` deploy, which must happen before you turn the lock on. |
| H8: submitting | Open, due Oct 14 by noon PDT (the form closes at 11:59 PM PDT). | The demo URL is `https://web-demo.oscargabriel.workers.dev` ([section 5](#5-urls)). | Submit the form with the repo URL (after H3), the video (H7) and the demo URL. Optionally, reply once to @zeke's call for entries. |
| H9: `docker login` | Not needed so far. No image pull has been rate-limited on either stage. | Nothing. | Only if a deploy's image pull is rate-limited, run `docker login` in your own terminal and deploy again. |
| Deleting the throwaways | Half done. The ledger's 63 throwaway repos on `dev-oscabriel` were deleted on 2026-10-11 ([The teardown record](#the-teardown-record)); the pre-ledger leftovers, the test accounts and the grants are still the user's script's. | `bun infra/teardown.ts` printed its plan (52 repos on `dev-oscabriel`, the same at 18:15 UTC). The user's teardown script runs it with `--apply`, then removes the leftovers from before the ledger that still exist, and skips any that are gone. | After the last take and before Oct 14, read the teardown script the build left for you and run it in your own terminal. Then commit `infra/created.jsonl`, which by then holds a `deleted` line for each repo removed. |
| ChatGPT usage for the swarm's tamsin | Not blocking. The fallback was taken on 2026-10-08. | OpenCode's ChatGPT sign-in hit its usage limit during the swarm's rehearsal, and it resets on Oct 16, after the deadline. The roster runs tamsin on `opencode-go/gpt-6-luna` (OpenCode Go). | Nothing. To show `openai/gpt-5.5` in the take instead, raise the ChatGPT plan's limit (a purchase, yours) and change tamsin's line in `scripts/lib/swarm/roster.ts` back. Before the take, check OpenCode Go's and Amp's usage headroom: a six-agent run used about 3.2M input tokens on OpenCode Go. |
| OpenCode Zen key for the swarm's pell | Not blocking. The fallback was taken on 2026-10-08. | pi here has no OpenCode Zen key, so the roster runs pell on `opencode-go/qwen3.8-flash`, as in the swarm's rehearsal. | Nothing. To show Gemini flash in the take instead, add OpenCode Zen's key to pi and change pell's line in `scripts/lib/swarm/roster.ts` back. |
