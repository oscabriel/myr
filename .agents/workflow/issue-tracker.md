# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.agents/scratch/`.

## Conventions

- One feature per directory: `.agents/scratch/<feature-slug>/`
- The spec is `.agents/scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.agents/scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Every issue file is an ask: copy `.agents/scratch/TEMPLATE.md` (see "Ask shape" below)
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Ask shape

Each issue is written as an ask (GLOSSARY.md: **Ask**), so this repo's own work tries the brief the product asks contributors to write. Copy `.agents/scratch/TEMPLATE.md`. Its fields:

- **Status:** a triage role from `triage-labels.md`.
- **Blocked by:** the numbers of the issues that must be resolved first, or `none`.
- **Want:** one behavioural change, said from the user's side. Not a list of implementation steps.
- **Territory:** the workspace packages the answer may change. Anything outside them is out of scope.
- **Check:** the command that fails on main now and passes once the want is met. It fails by an assertion, not by a load error or a missing file. Confirm it is red before starting work. Where nothing can be red yet (day-0 docs and scaffold), write `No check yet:` and the reason; like a rule with no fence, that is debt.
- **Done when:** the checklist that closes the issue. The check passing comes first and `bun run verify` passing comes last.
- **Anti-jobs:** what this issue must not do, even when nearby code invites it.

When a skill brings its own ticket template (for example `to-tickets`' "What to build" and acceptance criteria), write the ask shape instead: "What to build" becomes **Want**, and the acceptance criteria become **Done when**.

After Oct 14 these files can move into the config folder's asks (GLOSSARY.md: **Config folder**).

## When a skill says "publish to the issue tracker"

Create a new file under `.agents/scratch/<feature-slug>/` (creating the directory if needed), starting from `.agents/scratch/TEMPLATE.md`.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.agents/scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.agents/scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.agents/scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
