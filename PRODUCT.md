# Product

<!-- impeccable:product-schema 1 -->

What Myr is for, whom it serves, what it promises and what it declines. Any agent working on the web, the CLI's words or the docs starts here; [`DESIGN.md`](DESIGN.md) holds the web's look. Words follow [`GLOSSARY.md`](GLOSSARY.md).

## Platform

web

The web is one of four surfaces over one contract: git, the CLI, MCP and the web all serve the same contracts and render the same refusals.

## Users

Three kinds of people, and the agents that work for them. The words below are product words; inside the domain a contributor answering an ask is an **answerer** and a maintainer taking decisions is a **decider**.

1. **Maintainers** keep a project. Their jobs:
   - say what the project wants, as asks: a file on main with a want, a territory and a check that fails on main, which opens only when the check is red first;
   - set how the project takes changes, as typed code in its config folder on main (deciders, ask kinds, budgets, vouches, ratchets, the run block, visibility), read from the platform's last landing;
   - spend a daily budget of decisions on Today: open or decline a proposal, waive an escape, accept a posture change, finish a passing answer; doing nothing lets nothing in;
   - vouch for the people who may claim, each vouch a line that may say why and name the landing it followed, and denounce those who may not propose; a vouch is read as its line, never counted;
   - keep checks of their own in a layer only they read, and set write-only env values from a terminal;
   - land their own changes through the same gate as anyone else.
2. **Contributors** answer asks, often a newcomer looking for a first one. Their jobs:
   - find an ask they may take, on the front page, with `asks` or with `front`, each saying what done means before they start; some asks are held for newcomers, with a mentor named, and such an ask reads as held for them on every page and to every reader, never as closed to them;
   - claim it, which gives them a fork and an exclusive slot kept alive by pushing;
   - answer with plain git in that fork, run the gate's checks locally with `check`, push, and read the verdict where they already look (git's own output, `status`, the verdict note, the answer's page); each push the gate checks is a numbered round, and a verdict stays with its round when the next push comes;
   - propose an ask nobody wrote yet, as a proposal that expires unless a decider accepts it;
   - own what lands: their name is on the commit, and their record is built from those commits.
3. **Their harnesses**, the coding agents a person works through (Claude Code, OpenCode, Amp, pi, others). Their jobs: read the project's AGENTS.md block or skill, an ask as Markdown, `llms.txt` and the MCP tools; act only through their person's token; read refusals as typed JSON and run each one's `next`. An agent holds no account and no credit: the person's claim carries identity, and a landing discloses the agent apart (`Assisted-by`).

Contributors meet four nouns, and only four: **ask**, **answer**, **check** and **refusal**. Everything else (decider, budget, layer, ledger, posture, ratchet) is maintainer or platform vocabulary.

## Product Purpose

Myr is a git platform where everything a project ships is public, the contribution process is typed code on main, and a change lands only by passing a typed gate. It turns the front door around: the project says what it wants, anyone (a person, or an agent working for one) may answer, an answer that passes its check lands with credit for every person involved, and work nobody asked for has nowhere to go. It is a prototype.

The terminal and git are where work happens. The web is where people look: at what a project wants, where an answer stands, who is credited for a landing, and what a decider owes today.

Success: a newcomer goes from the front page to a running `claim` in under a minute; a stock harness with nothing installed claims, is refused, fixes and lands from git's own output; a contributor reads a refusal on the web exactly as git printed it; a decider clears Today on a phone.

## Positioning

The mechanism is the claim, not the feature count. What it promises:

- **main moves only by a landing.** A landing is the platform's commit of a checked tree; a direct push to main is refused. Deciders' own changes go through the same gate.
- **An answer cannot change what judges it.** The judge is read from the last landing, and its closure (check files, test and lint config, CI and hook configs, scripts, the config folder, `.env.schema`) is out of every answer's reach. An answer that edits them, or adds a disable comment with no reason, is refused; a reasoned one counts against the territory's escapes, and waits for a decider when it would raise them.
- **Every refusal is a typed value**, from a closed union: a tag, a reason, where it points, the command to run next, and whether retrying can help. It reads the same in `git push` output, the CLI, MCP and the web, and accumulates at the cheap stages, so one push hears every independent problem.
- **Credit is git trailers on the landing commit** (`Asked-by`, `Signed-off-by`, `Decided-by`, `Mentored-by`, `Finished-by`, `Advised-by`). Agents are disclosed, never credited. Trust is a vouch: a public line on main that may carry the member's reason and the landing it followed, read as a line and never as a number.
- **Held-back checks disclose one bit per area.** A layer's files never enter a public tree; a contributor learns which area failed, never a check's name or output, with a few attempts a week. A landing judged by them says "checked against N sealed checks" in its `Held-back:` trailer.
- **Write-only values stay write-only.** A decider sets a sensitive env value from a terminal; nobody reads it back, and an unlanded answer's code sees a placeholder.
- **Export is `git clone`.** Code, asks and credit trailers leave with a clone; verdict notes take one more fetch of `refs/notes/*`. Said plainly: the ledger and the decisions are the one record not yet in the clone.

What it declines:

- **No inbound or two-way sync with another code host.** It would be a second way onto main that skips the gate. Sign-in uses the platform's own accounts, with Google as an option.
- **No model's opinion in the gate.** Checks are commands with exit statuses and counts; an answer is judged by them, and taste is a decider's finish.
- **No scores.** A person appears by handle and role; their record serves trust rules only and is never shown as a number, rank or leaderboard.
- **No overclaiming.** Held-back checks are hidden from people and agents, not from the code under test, so they are no security boundary. Myr is a prototype, not a whole forge; it makes no claim about speed or scale beyond measured, dated numbers.
- **No second way to land.** The web adds no form for what git or the CLI does. Its only writes are a decider's choices, proposing an ask (and asking the platform's agent to draft it), and signing in or out. Landed code and each landing's diff are public, as a clone already makes them; an answer that has not landed shows its diff only to the decider finishing it.
- **No stacks of submissions.** A contributor's commits are not ordered into a stack that lands in parts; work is ordered by asks, and a family is the typed dependency, with a delete child that waits. A stack is a second ordering outside the gate.
- **No free labels.** Kinds and territories are typed; a label with no check behind it is work nobody asked for.
- **No discussion on rounds, and no reactions anywhere.** The gate's verdict is the only voice on a round.
- **No mirroring by a second push URL.** It is a second way onto main.
- **No identity held by a third party.** A person is a platform account; a second identity, if ever, is a key the person holds.
- **No vouch counts.** A vouch is read as the line it is, with its reason and the landing it followed; "vouched for by 3 people" is a score by another name.

## Operating Context

- Work happens in git and the CLI (`Brand.cli` in code; the name lives only in `packages/brand`). The CLI is a single binary served by the platform itself (`/install.sh`, `/releases/…`), with a versioned `--json` envelope on every command, `--dry-run` and `--yes` where a command writes, and `mcp` to serve the platform's tools over stdio. Every web page that suggests an action shows its command, copyable.
- Harnesses plug in without installing anything: the project's AGENTS.md block and skill, `/llms.txt`, an ask as Markdown, and `/.well-known/mcp.json`. The CLI also answers harness hooks (`hook`), and pi users can load a user-level adapter.
- Every page sits in one shell: a rail of where you are (the site's sections, the projects with their posture, the current project's sections, the file tree on code pages), the page, and an inspector of the typed facts of the thing in hand, each with its command numbered to copy. Below 1120 px the rail opens from a Menu and the facts follow the page's head; phones get a bottom bar (Asks, Today, Projects, More).
- Pages per job on the web:
  - **Front page** (`/asks`; `/` is the landing): open asks across projects a viewer may take, grouped by project with each project's posture said once, in the group heading, filtered by kind, by open to take and by asks held for newcomers; a split family is one row with its children as a fan. Selecting an ask fills the inspector with its state and its claim command. The same list as Markdown by `Accept: text/markdown`.
  - **Project** (`/$project`): its head says the project's posture once and, in one sentence of typed facts, how a change lands here; then its asks, then its README; beside them, the gate, who decides, what is held back, how to take part and its last three landings with their credit. The same as the project's `llms.txt` by `Accept: text/markdown`.
  - **Code** (`/$project/tree/…`, `blob/…`, `why/…`, `commits/…`, `commit/…`, `refs`): the files at any commit with a persistent tree, highlighted code with `#L` links, why each line is there, the landings by day, each commit's diff, and the refs; raw bytes under a sandboxing CSP.
  - **Ask** (`/$project/asks/$ask`): the want, the territory, the check, who may claim, and the commands; the same as Markdown by `Accept: text/markdown` or at `/$project/asks/$ask.md`.
  - **Answer** (`/$project/answers/$ask`): the outcome, the gate's stages, the rounds, the lanes, held-back results as one line per area, the refusal, and the landing. A waiting answer says the one thing the contributor needs; a landed one is told as a sentence first, then credits its people, and only then shows its sealed roots.
  - **Person** (`/people/$handle`): their credits by role and area, in words, never a number or a score.
  - **Policy** (`/$project/people`): who decides which paths, who is vouched for or denounced, the limits and the agent rules, read from the config folder at the landed commit, with the commands that change them.
  - **Proposals** (`/$project/proposals/new`, `/$project/proposals/$proposal`): a want proposed from the web or the CLI, the platform's agent's draft if one was asked for (the ask file, the check, its red-first runs), and the decision it waits on.
  - **Today** (`/today`): a decider's decisions in sections (due today, within the budget, waiting for tomorrow), each with its evidence, safe default, expiry and one-tap choices whose consequence is written under each, against the budget said as a sentence, with newcomers to welcome and a sample of landings that needed nobody; each decision has its own page (`/$project/decisions/$decision`), where a finish shows the answer's diff with refusals marked at their lines.
  - **Ledger** (`/$project/ledger`): the posture label, each declared layer with its reason, each sealed area's count, authors, committed root and admission, and every entry, newest first.
  - **Env shape** (`/$project/env`): every item the project's committed `.env.schema` declares, parsed at the landed commit and never resolved; for a sensitive item, who set its value and when. Never a value.
  - **Sign-in** (`/auth/signin`): through the platform's own accounts; the session lives in an HttpOnly cookie the browser cannot read.
  - **For agents** (`/agents`, and `/agents.md`): a reference in the voice of a man page over `/llms.txt`, `/llms-full.txt`, each project's `/$project/llms.txt`, `/.well-known/mcp.json` and the skills under `/.well-known/agent-skills/`.
- Pages arrive with their data in the server's HTML, and moving between them never reloads the document. The project, ask and answer pages update live while open (the project's `watch` stream), and fall back to reading again every 5 s when the stream cannot be held.
- A minimal keyboard set works on every page: `?` (the keys, with a switch that turns the rest off), `j`/`k` through a list, `J`/`K` through files, `1`–`9` to copy the page's numbered commands, and Escape.
- A project may not take a name the web uses for its own pages (`agents`, `today`, `people`, `auth`, `rpc`, `releases`, `icons`, `assets`).
- Phone width is a first-class target (Today installs as a PWA).

## Capabilities and Constraints

- The web Worker holds no storage binding and no secrets; every read goes through `/rpc` to the platform, and no public-serving Worker can reach the private namespace (AGENTS.md principle 7). It cannot show what the platform does not return.
- Refusal text comes only from `@repo/protocol/render` (`explain`, `headline`), the one renderer for git, the CLI, MCP and the web (principle 3).
- The host that keeps a project's repos is a port behind the gateway's custody: the gateway holds every credential and every rule, and a host is whatever passes the one `RepoHost` contract. A second host is an adapter, not a rewrite.
- The web never: shows an unlanded answer's diff to anyone but the decider finishing it; shows a score, rank or count of a person as a measure of quality; reads a write-only value back, or shows the placeholder an answer sees; names a held-back path, check or case to someone outside its layer.

## Brand Commitments

- The name lives only in `packages/brand`: code takes it from `Brand.name` and the command from `Brand.cli`. Prose may name it: Myr, said "meer".
- **Voice: plain, factual, git-native, no hype.** Sentences say what happened and what to run next. No exclamation marks, no celebration copy, no gamification, no superlatives, no "revolutionary", "seamless" or "effortless". Avoid "PR", "issue" (for an ask), "lease", "reputation", "review" and "approver"; GLOSSARY.md lists each term's words to avoid.
- Other projects are described by mechanism, neutrally, never by name in comparison. What the product builds on is credited in the README and in each ported file's own header.
- Credit trailers read as they do on the commit (`Asked-by: ines-v`), in one order; `Assisted-by` is shown apart, because it is a disclosure, never credit.

## Evidence on Hand

- The examples `examples/datekit` (a date library with a maintainers layer of sealed checks and an `.env.schema`) and `examples/burrow` (six services with a lint ratchet and a migrate ask split six ways) are fictional projects with fictional people (`ines-v`, `okonkwo`, `bram`, `okafor`, `lin-h`, and burrow's vouched contributors). Pages show them as examples, never as real users.
- Measured numbers come only from live runs on a stage, each with its date. No testimonials, customers or adoption figures exist; none may be invented.

## Product Principles

1. **The terminal is the workplace; the web is the window.** Every action shows its command; nothing adds a second way to land.
2. **Render the typed value, not a paraphrase.** Refusals, credits, postures and outcomes read the same on every surface, because one renderer and one component draw each.
3. **Waiting is not refusing.** Checking, waiting on a parent ask, a finish or a decision each read as waiting, never as an error.
4. **Credit people, disclose agents, score no one.**
5. **Decisions fit a phone.** Today's density is set by a decider clearing it in a few minutes on a small screen: one tap a choice, its consequence said under it.

## Accessibility & Inclusion

WCAG 2.2 AA: text contrast at least 4.5:1 (every state colour measures at least 5:1 in both themes), controls and borders at 3:1, nothing set below 13 px, visible focus on every control and a skip link to the page, every state carried by a word and a mark as well as a colour, single-key shortcuts that one switch turns off, `prefers-reduced-motion` honoured, and usable at 360 px wide with no horizontal scroll. `apps/web/e2e/a11y.e2e.ts` runs axe and a keyboard walk over every page in both schemes at 1440 and 390 px.
