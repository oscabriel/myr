# Rehearsal

**No deploys during takes.** Nothing deploys between the first take and the last: a deploy restarts the platform's Durable Objects mid-take. Turn on the deploy recording lock before the first take and off after the last; while it is on, `infra/deploy.ts` refuses every deploy with `RecordingInProgress`. No flag or environment variable lifts it: only `bun infra/recording.ts off`, run by a person once the last take is done.

This checklist is walked once on the live stages before the recording: the read-only shots on `demo`, the shots that consume asks on `dev-oscabriel` (on a fresh copy of each example, so demo's asks stay open for the take), with the same commands [`shot-list.md`](shot-list.md) gives. Mark each line as it is walked:

- a pass: `- [x] S07 … PASS 2026-10-13 demo, 0:41`;
- a failure, with the fallback used: `- [x] S07 … FAILED: <what broke> fallback: <what the video uses>`.

Every box is ticked when the walk is done, passed or failed.

## Shots

- [ ] S01 The front door broke · web · the front page on a fresh seed
- [ ] S02 The front door broke · web · format-ordinal's ask page
- [ ] S03 Zero install · split · stock Claude Code takes add-months-clamp as bram
- [ ] S04 Zero install · terminal · `OutOfScope` in the agent's own `git push`
- [ ] S05 Zero install · terminal · the same refusal pushed by hand on parse-iso-week, then released
- [ ] S06 Zero install · split · the landing's trailers and its answer page
- [ ] S07 One weed becomes a rule · web · burrow's family: six children and the delete child
- [ ] S08 One weed becomes a rule · terminal · the ratchet in burrow's `.myr/project.ts`
- [ ] S09 One weed becomes a rule · terminal · the swarm's dry-run plan, both nudges printed
- [ ] S10 One weed becomes a rule · split · `Weakened` in the nudged agent's pane
- [ ] S11 One weed becomes a rule · web · the reasoned escape waiting on a decision
- [ ] S12 Six harnesses at once · terminal · the take: six herdr panes and the counter
- [ ] S13 Six harnesses at once · web · burrow's page updating live
- [ ] S14 Six harnesses at once · web · the delete child open
- [ ] S15 The top half is open · split · bram's 403 and ines-v's clone of the layer
- [ ] S16 The top half is open · terminal · datekit's `.myr/visibility.ts`
- [ ] S17 The top half is open · terminal · bram's staged answer refused as `HeldBackFailed`
- [ ] S18 The top half is open · split · the fix lands with its `Held-back:` trailer
- [ ] S19 The top half is open · web · the ledger: "Open with sealed evidence"
- [ ] S20 The top half is open · split · `.env.schema` beside the env shape page
- [ ] S21 The maintainer's day · web · Today as okafor
- [ ] S22 The maintainer's day · web · the front page after the swarm
- [ ] S23 The maintainer's day · terminal · `myr why` on a migrated line
- [ ] S24 Measured numbers · terminal · the README's Numbers table
- [ ] S25 Measured numbers · terminal · an anonymous clone: trailers, then the notes fetch
- [ ] S26 Measured numbers · web · the closing line over datekit's page

## Pre-flight

On the morning of the take, in this order.

- [ ] The recording lock is on, and nobody plans a deploy until the last take is done:

  ```sh
  bun infra/recording.ts on
  bun infra/recording.ts status
  ```

- [ ] Smoke passes on demo:

  ```sh
  bun scripts/smoke.ts --stage demo
  ```

- [ ] The seeded state is fresh. The seed has no check mode, so open each page and compare:
  - `https://web-demo.oscargabriel.workers.dev/`: datekit's three asks (add-months-clamp, format-ordinal held for newcomers, parse-iso-week) and burrow's six `drop-legacy-fetch-burrow-*` children, all open and unclaimed;
  - `https://web-demo.oscargabriel.workers.dev/burrow`: `drop-legacy-fetch-delete` waiting on all six;
  - `https://web-demo.oscargabriel.workers.dev/datekit/ledger`: "Open with sealed evidence", with export's 7 sealed checks and parser's 4;
  - `https://web-demo.oscargabriel.workers.dev/datekit/env`: SENTRY_AUTH_TOKEN listed, `@sensitive`, with its proxy host.

  The same, from a terminal:

  ```sh
  myr projects
  myr asks --project datekit
  myr asks --project burrow
  myr ledger --project datekit
  ```

- [ ] The three on-screen people are logged in as CLI profiles, each token pasted off camera from the stage's `SESSION_TOKENS` and ended with Ctrl-D:

  ```sh
  myr login --url https://platform-demo.oscargabriel.workers.dev --profile bram --token-stdin
  myr login --url https://platform-demo.oscargabriel.workers.dev --profile ines-v --token-stdin
  myr login --url https://platform-demo.oscargabriel.workers.dev --profile okafor --token-stdin
  ```

- [ ] The stage's `SESSION_TOKENS` holds a token for each of the six swarm contributors (burrow's vouched people), and the dry run plans six of them:

  ```sh
  bun run swarm -- --stage demo --project burrow --scenario video --dry-run --allow-demo
  ```

- [ ] ines-v has set SENTRY_AUTH_TOKEN's value, off camera, with a made-up value on stdin: `myr env set SENTRY_AUTH_TOKEN --project datekit --yes` as profile `ines-v`. The env page then says who set it and when.
- [ ] okafor is signed in on the web (`https://web-demo.oscargabriel.workers.dev/auth/signin`), in the browser profile used for S21.
- [ ] The staged commits are ready, and nothing else is:
  - `~/demo/datekit-bram`: a clone of datekit's main with two commits on top, the Do token as an English ordinal (every public test passes), then the one-line change in `examples/datekit/layers/maintainers/known-bad/export.patch`;
  - `~/demo/datekit-hand`: made during S05, with one README line committed before its push.
- [ ] The harnesses are logged in and on the versions rehearsed, and herdr opens a fresh `demo` session. Amp updates first: its interactive mode refuses new threads until it does. Claude Code's auto-updater stays off for the take (`DISABLE_AUTOUPDATER=1` in the environment the swarm starts from), since an update mid-take changes its startup questions. pi is signed in to the `opencode-go` provider pell's qwen flash and the other two pi contributors run on (`pi auth check --provider opencode-go` says `ready`; see [`swarm-scenario.md`](swarm-scenario.md)). herdr's agent names must be unique in a session, so close the last swarm workspace, or start a new session, before the take:

  ```sh
  amp update
  claude --version
  opencode --version
  amp --version
  pi --version
  herdr --version
  herdr --session demo
  ```

- [ ] The CLI on `PATH` is the one the demo platform's install line serves, and Claude Code has no plugin, MCP server or skill for `~/demo/datekit`.
- [ ] Panes laid out: one terminal (or herdr's six plus the counter for S12) beside one browser window at 1280 px; one colour scheme for every take; terminal font large enough to read at 1080p.
- [ ] Notifications off: system do-not-disturb, chat apps closed, the browser's notifications blocked.
- [ ] The recording order in `shot-list.md` is printed beside the screen.

## After the last take

- [ ] The recording lock is off, so deploys run again:

  ```sh
  bun infra/recording.ts off
  ```

## Beat timings

Filled in by the walk: how long each beat ran, against its range in [`script.md`](script.md). If the total runs over 10:00, cut the env paragraph and S20 first.

| Beat | Range | Walked | Notes |
| --- | --- | --- | --- |
| The front door broke | 0:00–0:45 | | |
| Zero install | 0:45–1:30 | | |
| One weed becomes a rule | 1:30–2:15 | | |
| Six harnesses at once | 2:15–3:45 | | |
| The top half is open | 3:45–5:00 | | |
| The maintainer's day | 5:00–5:45 | | |
| Measured numbers | 5:45–6:30 | | |
