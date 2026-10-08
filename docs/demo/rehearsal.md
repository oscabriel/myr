# Rehearsal

**No deploys during takes.** Nothing deploys between the first take and the last: a deploy restarts the platform's Durable Objects mid-take. Turn on the deploy recording lock before the first take and off after the last; while it is on, `infra/deploy.ts` refuses every deploy with `RecordingInProgress`. No flag or environment variable lifts it: only `bun infra/recording.ts off`, run by a person once the last take is done.

This checklist is walked once on the live stages before the recording: the read-only shots on `demo`, the shots that consume asks on `dev-oscabriel` (on a fresh copy of each example, so demo's asks stay open for the take), with the same commands [`shot-list.md`](shot-list.md) gives. Mark each line as it is walked:

- a pass: `- [x] S07 … PASS 2026-10-13 demo, 0:41`;
- a failure, with the fallback used: `- [x] S07 … FAILED: <what broke> fallback: <what the video uses>`.

Every box is ticked when the walk is done, passed or failed. A pre-flight line that sets up the recorder's desk, not a stage, says `NOT WALKED`: only the person recording can do it.

**Walked on 2026-10-08, 17:08 to 17:39 UTC**, from `main` at `1e46e9a`, with nothing deployed; the deploy lock was on only for its own check. The read-only shots ran on `demo`, which was left as the seed made it: every ask open and unclaimed, and smoke passing at the end. The shots that consume asks ran on `dev-oscabriel`, on `datekit-805` and `burrow-805`, two `seed --as` copies, and every throwaway they made is in the ledger. On the morning of the take, untick the pre-flight and walk it again.

## Shots

- [x] S01 The front door broke · web · the front page on a fresh seed · PASS 2026-10-08 demo, 0:02: "10 open asks, 8 open to take", datekit's three and burrow's six children open. The project badges say "Open", not "Open with sealed evidence" (the front page takes a posture only from a decided change, and a fresh seed's stands without one): the ledger in S19 carries the posture.
- [x] S02 The front door broke · web · format-ordinal's ask page · PASS 2026-10-08 demo, 0:01: open, "Held for newcomers, mentored by okonkwo", asked by ines-v.
- [x] S03 Zero install · split · stock Claude Code takes add-months-clamp as bram · PASS 2026-10-08 dev-oscabriel (`datekit-805`), 2:25: Claude Code 2.1.294 on Haiku, S03's prompt run headless (`-p`) with the corrected flags. It claimed, fixed `src/add.ts`, met `OutOfScope` for README.md in `myr check`, untangled a `commit --amend` of its own, and pushed `8b0050e`, which landed as `e7fb8a9` 35 s later. 1:46 of agent time, 25 turns, $0.025. Three compound commands (`$(…)`, `for` loops) were still denied: run interactively, each is a permission prompt on camera.
- [x] S04 Zero install · terminal · `OutOfScope` in the agent's own `git push` · FAILED: the agent ran `myr check` before pushing, so the refusal never reached git (as in the harness check's zero-install run the same day) fallback: S04's own, keep the `myr check` refusal (same words, same renderer) and add S05.
- [x] S05 Zero install · terminal · the same refusal pushed by hand on parse-iso-week, then released · PASS 2026-10-08 dev-oscabriel, 0:12: on a fresh claim, `remote: OutOfScope: changes paths outside the ask's territory: README.md`, then `next: myr check` and `retryable: no`, and `! [remote rejected] HEAD -> main (OutOfScope)`. `myr release` prints `{"released": true}` as a JSON block.
- [x] S06 Zero install · split · the landing's trailers and its answer page · PASS 2026-10-08 dev-oscabriel, 0:02: `Asked-by: ines-v`, `Signed-off-by: bram`, `Assisted-by: claude-code_2-1-294_agent (claimed)`, then `Ask`, `Verdict`, `Held-back` and `Request-Id`. The answer page reads "Landed as e7fb8a9".
- [x] S07 One weed becomes a rule · web · burrow's family: six children and the delete child · PASS 2026-10-08 demo, 0:05: six children open to take, and the delete child blocked until all six land. The page's one landing credits `Decided-by: oscabriel`, the operator's handle, in a video of fictional people.
- [x] S08 One weed becomes a rule · terminal · the ratchet in burrow's `.myr/project.ts` · PASS 2026-10-08 demo, 0:03: the `no-module-level-mutable-state` block, counted by `bun run lint --format json`.
- [x] S09 One weed becomes a rule · terminal · the swarm's dry-run plan, both nudges printed · PASS 2026-10-08 demo, 0:01: six rows on four harnesses, both held asks, both nudges in full; nothing claimed.
- [x] S10 One weed becomes a rule · split · `Weakened` in the nudged agent's pane · PASS 2026-10-08 dev-oscabriel (`burrow-805`), 0:04, pushed by hand as marisol: `remote: Weakened: adds oxlint-disable without a reason`, `at: packages/catalog/src/client.ts:40`. No nudged agent has added a comment yet: none in the swarm's two live runs the same day, none in this walk's herdr run (S12). For the take, expect S10's fallback (cut it and its line).
- [x] S11 One weed becomes a rule · web · the reasoned escape waiting on a decision · PASS 2026-10-08 dev-oscabriel (`burrow-805`), 0:52, pushed by hand as dagny: every lane passed, then the answer page read "Waiting on decision dec-000001" 36 s after the push. As with S10, a nudged agent may never add the comment: then S11's fallback.
- [x] S12 Six harnesses at once · terminal · the take: six herdr panes and the counter · PASS 2026-10-08 dev-oscabriel, 2:24 for two (7:41 for six, headless, in the swarm's second live run the same day, 6 of 6 landed): `--view herdr --only tamsin,ivo` on `burrow-805`, in a herdr session of its own. Two panes and the counter strip; OpenCode and Amp each took the brief interactively, the first live prompts in herdr panes for either, and both landed on their first attempt (ivo `4ea45cb` after 1:24, tamsin `4f7430c` after 2:24). Amp's pane showed $2.29. tamsin's landing has no `Assisted-by` (OpenCode's landings carry none yet).
- [x] S13 Six harnesses at once · web · burrow's page updating live · PASS 2026-10-08 dev-oscabriel: with the page open and never reloaded, each landing showed within 13 s, billing's and then auth's.
- [x] S14 Six harnesses at once · web · the delete child open · PASS 2026-10-08 dev-oscabriel (`burrow-swarm-2`, where the swarm's second live run landed all six), 0:05: State "Open". The page still says "Waits on … to land first; a claim waits until they do" once all six have landed. Demo's, before the take, reads "Blocked".
- [x] S15 The top half is open · split · bram's 403 and ines-v's clone of the layer · PASS 2026-10-08 demo, 0:04: bram got `remote: bram may not read datekit--maintainers` and a 403 in 0.3 s; ines-v's clone holds `checks/held-back/export/` (7) and `parser/` (4).
- [x] S16 The top half is open · terminal · datekit's `.myr/visibility.ts` · PASS 2026-10-08 demo, 0:03.
- [x] S17 The top half is open · terminal · bram's staged answer refused as `HeldBackFailed` · PASS 2026-10-08 dev-oscabriel (`datekit-805`), 0:49: status read `refused: HeldBackFailed` 28 s after the push. The note holds `HeldBackFailed` in `export`, with export 6/7 and parser 4/4. Its `suite` is one value for both areas, and the ledger published another root for each (an open finding). S17 to S19 show both on screen.
- [x] S18 The top half is open · split · the fix lands with its `Held-back:` trailer · PASS 2026-10-08 dev-oscabriel, 1:06, with the URL corrected: it landed as `784740a` 41 s after the push, its last trailers `Held-back: export 7/7 @ sha256:…; parser 4/4 @ sha256:…`. The violet trailer is on the answer's page; the project page's landing list shows only the credit and `Assisted-by`, so the shot now opens `/datekit/answers/format-ordinal`.
- [x] S19 The top half is open · web · the ledger: "Open with sealed evidence" · PASS 2026-10-08 demo, 0:05: the maintainers layer, "export: 7 sealed checks by 3 people", "parser: 4 sealed checks by 3 people", both admitted.
- [x] S20 The top half is open · split · `.env.schema` beside the env shape page · PASS 2026-10-08 demo, 0:05: `SENTRY_AUTH_TOKEN`, sensitive, proxy `sentry.io` (only paths `/api/**`), "set by ines-v" after the pre-flight's `env set`.
- [x] S21 The maintainer's day · web · Today as okafor · FAILED: okafor cannot sign in on the web. The web's only sign-in is the platform's handle and password, okafor has no account, and sign-up refuses a handle that `SESSION_TOKENS` holds. So no seeded person can open Today on the web, on either stage. fallback: `myr today --project burrow` as okafor, walked on `dev-oscabriel`: dec-000001, the reasoned escape, with its words, default `decline` and expiry, in 0:01.
- [x] S22 The maintainer's day · web · the front page after the swarm · PASS 2026-10-08 demo (the fresh front page) and dev-oscabriel (`burrow-swarm-2` after six landings: six answers listed, the delete child open).
- [x] S23 The maintainer's day · terminal · `myr why` on a migrated line · PASS 2026-10-08 dev-oscabriel (`burrow-805`), 0:05: after `git pull`, `myr why packages/auth/src/session.ts:18` named landing `4f7430c`, the ask, tamsin, okafor and the verdict. The fallback is corrected: in `~/demo/datekit` the agent's own commit sits on main, so `why` names that commit, not the landing. A fresh clone gave the landing, with its `Assisted-by` and `Held-back`.
- [x] S24 Measured numbers · terminal · the README's Numbers table · PASS 2026-10-08 (the repo), with a command corrected: `-A 14` stopped one row short of the core loop table's "the whole loop"; `-A 15` shows the table whole.
- [x] S25 Measured numbers · terminal · an anonymous clone: trailers, then the notes fetch · PASS 2026-10-08 dev-oscabriel (`datekit-805`, after S03), 0:03: the log shows the credit trailers, and the note comes only with the extra fetch. On demo before the take, the fetch says `couldn't find remote ref refs/notes/myr`, since nothing has landed there yet: keep S25 after S17, S18 and S03, as the recording order does.
- [x] S26 Measured numbers · web · the closing line over datekit's page · PASS 2026-10-08 demo, 0:04.

## Pre-flight

On the morning of the take, in this order.

- [x] The recording lock is on, and nobody plans a deploy until the last take is done: PASS 2026-10-08: on at 17:08:11 UTC, `status` said so, a deploy to `dev-oscabriel` was refused with `RecordingInProgress` before it read its flags, then off.

  ```sh
  bun infra/recording.ts on
  bun infra/recording.ts status
  ```

- [x] Smoke passes on demo: PASS 2026-10-08 demo, 7 of 7 at 17:08 UTC, and again at 17:39 after the walk.

  ```sh
  bun scripts/smoke.ts --stage demo
  ```

- [x] The seeded state is fresh. The seed has no check mode, so open each page and compare: PASS 2026-10-08 demo: each page and each read below, as listed. The reads needed `MYR_URL` (now the block's first line): with neither it nor a profile, the CLI says "no platform to call".
  - `https://web-demo.oscargabriel.workers.dev/`: datekit's three asks (add-months-clamp, format-ordinal held for newcomers, parse-iso-week) and burrow's six `drop-legacy-fetch-burrow-*` children, all open and unclaimed;
  - `https://web-demo.oscargabriel.workers.dev/burrow`: `drop-legacy-fetch-delete` waiting on all six;
  - `https://web-demo.oscargabriel.workers.dev/datekit/ledger`: "Open with sealed evidence", with export's 7 sealed checks and parser's 4;
  - `https://web-demo.oscargabriel.workers.dev/datekit/env`: SENTRY_AUTH_TOKEN listed, `@sensitive`, with its proxy host.

  The same, from a terminal, read as anyone:

  ```sh
  export MYR_URL=https://platform-demo.oscargabriel.workers.dev
  myr projects
  myr asks --project datekit
  myr asks --project burrow
  myr ledger --project datekit
  ```

- [x] The three on-screen people are logged in as CLI profiles, each token pasted off camera from the stage's `SESSION_TOKENS` and ended with Ctrl-D: PASS 2026-10-08 demo: all three, from stdin, under the walk's own scratch home. The take logs in to the default `~/.config`, the one Claude Code's Bash tool reads: it takes `XDG_*` from the login shell.

  ```sh
  myr login --url https://platform-demo.oscargabriel.workers.dev --profile bram --token-stdin
  myr login --url https://platform-demo.oscargabriel.workers.dev --profile ines-v --token-stdin
  myr login --url https://platform-demo.oscargabriel.workers.dev --profile okafor --token-stdin
  ```

- [x] The stage's `SESSION_TOKENS` holds a token for each of the six swarm contributors (burrow's vouched people), and the dry run plans six of them: PASS 2026-10-08 demo: `myr status` says "Signed in as" each of wren, tamsin, ivo, marisol, dagny and pell, and the dry run planned six.

  ```sh
  bun run swarm -- --stage demo --project burrow --scenario video --dry-run --allow-demo
  ```

- [x] ines-v has set SENTRY_AUTH_TOKEN's value, off camera, with a made-up value on stdin: `myr env set SENTRY_AUTH_TOKEN --project datekit --yes` as profile `ines-v`. The env page then says who set it and when. PASS 2026-10-08 demo: set at 17:11 UTC, and the env page says "set by ines-v". It stays set for the take; setting it again only moves the time.
- [x] okafor is signed in on the web (`https://web-demo.oscargabriel.workers.dev/auth/signin`), in the browser profile used for S21. FAILED: okafor has no account, and sign-up refuses a handle `SESSION_TOKENS` holds (S21) fallback: S21 in a terminal, `myr today --project burrow` as okafor.
- [x] The staged commits are ready, and nothing else is: PASS 2026-10-08 dev-oscabriel: made on `datekit-805` as listed; the ask's own test passed on the first commit and S17's push was refused `HeldBackFailed`. On the morning, make `~/demo/datekit-bram` from demo's datekit the same way.
  - `~/demo/datekit-bram`: a clone of datekit's main with two commits on top, the Do token as an English ordinal (every public test passes), then the one-line change in `examples/datekit/layers/maintainers/known-bad/export.patch`;
  - `~/demo/datekit-hand`: made during S05, with one README line committed before its push.
- [x] The harnesses are logged in and on the versions rehearsed, and herdr opens a fresh `demo` session. Amp updates first: its interactive mode refuses new threads until it does. Claude Code's auto-updater stays off for the take (`DISABLE_AUTOUPDATER=1` in the environment the swarm starts from), since an update mid-take changes its startup questions. pi and OpenCode are both signed in to OpenCode Go, which tamsin's and all three pi contributors' models run on (`pi auth check --provider opencode-go` says `ready`, and `opencode auth list` lists OpenCode Go; see [`swarm-scenario.md`](swarm-scenario.md)). herdr's agent names must be unique in a session, so close the last swarm workspace, or start a new session, before the take:

  ```sh
  amp update
  claude --version
  opencode --version
  amp --version
  pi --version
  herdr --version
  herdr --session demo
  ```

  PASS 2026-10-08: `amp update` moved Amp to 0.0.1791476260; Claude Code 2.1.294, OpenCode 2.0.7, pi 1.1.0, herdr 0.9.3. `pi auth check --provider opencode-go` says `ready`, and `opencode auth list` lists OpenCode Go. The walk's herdr session was its own (`r805`, deleted afterwards), not `demo`.

- [x] The CLI on `PATH` is the one the demo platform's install line serves, and Claude Code has no plugin, MCP server or skill for `~/demo/datekit`. PASS 2026-10-08: the install line installs the CLI at version `0.1.0-demo.802`, though its `--version` prints `v0.0.0` (the binaries carry no version stamp yet). S03's command now carries `--strict-mcp-config --setting-sources project,local`, which keep out this machine's MCP servers, plugins and hooks. Claude Code still lists the clone's generated contribute skill and this machine's user skills.
- [x] Panes laid out: one terminal (or herdr's six plus the counter for S12) beside one browser window at 1280 px; one colour scheme for every take; terminal font large enough to read at 1080p. NOT WALKED: the recorder's desk.
- [x] Notifications off: system do-not-disturb, chat apps closed, the browser's notifications blocked. NOT WALKED: the recorder's desk.
- [x] The recording order in `shot-list.md` is printed beside the screen. NOT WALKED: the recorder's desk.

## After the last take

- [x] The recording lock is off, so deploys run again: PASS 2026-10-08, walked with the lock's first line: off at 17:08 UTC, and `status` said deploys run.

  ```sh
  bun infra/recording.ts off
  ```

## Beat timings

Filled in by the walk: how long each beat ran, against its range in [`script.md`](script.md). If the total runs over 10:00, cut the env paragraph and S20 first.

Walked on 2026-10-08. Each beat's narration is timed at 150 words a minute. "Live" is the screen's own time in the walk: commands, agents and the platform's verdicts. "Edited" is the beat as the video can show it, with the waits cut, never shorter than its narration.

| Beat | Range | Walked | Notes |
| --- | --- | --- | --- |
| The front door broke | 0:00–0:45 | 0:45 edited; 0:02 live | Narration 112 words, 0:45. On time. |
| Zero install | 0:45–1:30 | 0:45 edited; 2:40 live | Narration 108 words, 0:43. Live: S05 0:12, S03's agent 1:46 and its landing 0:35, S06 0:02. Cut S03 to its claim, the refusal and the push. |
| One weed becomes a rule | 1:30–2:15 | 0:45 edited; 1:05 live | Narration 112 words, 0:45. S07 to S09 0:09, S10 0:04, S11 0:52 to the waiting verdict. S10 and S11 depend on a nudged agent; neither has happened yet in a run. |
| Six harnesses at once | 2:15–3:45 | 1:30 edited; 7:41 live | Narration 197 words, 1:19. Six agents took 7:41 in the swarm's second live run, and two took 2:24 in herdr in this walk, so the take is shown at about five times speed, or cut. |
| The top half is open | 3:45–5:00 | 1:15 edited; 2:17 live | Narration 179 words, 1:12. S15 0:04, S16 0:03, S17 0:49, S18 1:06, S19 and S20 0:10. The env paragraph (25 words, 0:10) and S20 are the first cut. |
| The maintainer's day | 5:00–5:45 | 0:40 edited; 0:08 live | Narration 92 words, 0:37. S21 is its terminal fallback (0:01), S22 0:02, S23 0:05. |
| Measured numbers | 5:45–6:30 | 1:00 edited; 0:07 live | Narration 78 words, 0:31, plus about 0:30 to read the core loop table's nine rows. That runs about 0:15 over the range. |
| Total | 0:00–6:30 | about 6:40 edited | Under 10:00, so nothing needs cutting. If a take runs long, cut the env paragraph and S20 first. |
