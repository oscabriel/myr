# Myr

A Git platform where everything a project ships is public, the contribution process is typed code on main, and a change lands only by passing a typed gate.

## Contribution

**Ask**:
A file on main in which a project states one change it wants: a behavioural want, a territory, and a check that fails on main.
_Avoid_: issue, ticket, task, intent, bounty

**Ask kind**:
A typed template for asks, declared in the config folder, that fixes the brief's fields, the check kind, who may claim, and whether a finish is required.
_Avoid_: issue template, label

**Answer**:
A commit in a claimant's fork offered to satisfy one ask.
_Avoid_: pull request, PR, patch, attempt, submission

**Round**:
One push of an answer that the gate checked: its head commit, the gate's verdict on it, and when. The next push starts the next round, numbered from 1, and a verdict is never read against a later round.
_Avoid_: revision, iteration, attempt, submission

**Claim**:
One person's exclusive, expiring right to answer an ask, made of a fork and a scoped token; kept alive only by pushes.
_Avoid_: lease, lock, assignment

**Claim fork**:
The fork a claim is made of, at `<owner>/<name>--<ask>--<handle>`, to which the claimant pushes answers.
_Avoid_: branch, feature branch

**Working fork**:
A person's own fork of a project, at `<owner>/<name>--me--<handle>`, that holds a decider's own changes before they land and a proposer's sealed answers.
_Avoid_: personal fork, scratch repo

**Check**:
The predicate that judges an answer: the ask's own check plus the project's checks, run by the platform on the exact merged tree.
_Avoid_: test (when the whole judgement is meant), CI, eval

**Red first**:
The rule that an ask opens only if its check fails on main twice in the same way, by an assertion rather than a load error.
_Avoid_: failing test requirement

**Check kind**:
The shape of an ask's check: redThenGreen, lintToZero, ratchet, migrate, or symbolAbsent (a family's delete child).

**Family**:
A migrate ask whose old name is used in two or more modules, opened as one child ask per module that uses it, each with that module as its territory, plus a delete child that waits on every child and checks the name is gone; the parent closes when its last child lands.
_Avoid_: epic, subtasks, batch, stack

**Territory**:
The module (by default a workspace package) an answer may change.
_Avoid_: scope (when meaning paths), lane, footprint

**Refusal**:
One or more members of the closed, typed union the platform returns instead of landing, all from the cheapest failing stage, each with a reason, a reproducing command, a next step, and whether retrying can help.
_Avoid_: rejection, error, failure, CI failure

**Discussion**:
A public, freeform thread in a project, open to anyone not denounced, that lands nothing itself; a decider may turn it into a proposal.
_Avoid_: issue, forum topic, comments

**Proposal**:
A request to open an ask, or to flag an existing one, from anyone not denounced, or made by a decider from a discussion; it expires unless a decider accepts it.
_Avoid_: feature request, suggestion

**Draft**:
An ask file and its check that the platform's agent wrote for a proposal, run red first before it is put to a decider. It lands only when a decider accepts it.
_Avoid_: AI suggestion, auto-ask

**Sealed answer**:
An answer recorded with a proposal and judged after the ask opens, without the decider reading its diff.

**Finish**:
A decider's own commits on a passing answer before it lands, re-checked and credited with Finished-by.
_Avoid_: review, nit, suggested change

## Landing

**Gate**:
The cost-ordered chain of stages that narrows a push to a checked tree or a refusal.
_Avoid_: CI, pipeline, merge queue

**Landing**:
The platform's commit of a checked tree to main, written by the platform alone, with credit trailers. An ask's opening is a landing too: it opens an ask and answers none. So is a project's adoption, its first `main` from the initializer's first push or an import: it answers no ask, has no parent and credits no one.
_Avoid_: merge, ship

**Landed SHA**:
The commit the platform itself last landed on main; the only commit a project's rules are read from.
_Avoid_: HEAD, tip of main

**Import**:
A project adopted from a public repo: a read-only copy, not run by its maintainers, whose first `main` is the source branch's tip. The source, its address and branch, stays on the project's record and is shown as where it was imported from; by default the project is named after its source namespace (the Run a project guide has the whole rule). It is made from the CLI's `init --import` or the web's `/import`.
_Avoid_: mirror, fork (of the source), sync

**Outcome**:
Where an offered answer stands: Checking, Landed, WaitingOnParent, AwaitingFinish, AwaitingDecision or Refused; only Refused carries refusals, and waiting is not a refusal.
_Avoid_: result, build state, CI status

**Judge closure**:
Every file that decides what the checks do (check files, test and lint config including lint plugin sources and rule fixture tests, CI files, git and harness hook configs, scripts, the config folder, .env.schema and committed .env.* files); no answer may change it.
_Avoid_: protected paths

**Weakening**:
An answer's added marker that disables a check (.skip, @ts-ignore, a lint or @effect-diagnostics disable) or raises a ratchet baseline; a marker without a reason is refused, and one with a reason counts against the ratchet.

**Ratchet**:
A counted budget per territory, recorded at landing and lowered automatically, that answers may lower but never raise; only a decider raises it.
_Avoid_: baseline (alone), suppression file

**Verdict**:
The record of one check run: base, head, patch id, level and the platform as verifier, kept with the landing.
_Avoid_: approval, review

**Why**:
A line's landing: the ask it answered (with its answer and verdict) or the ask it opened, and the people, that put that line on main.
_Avoid_: blame

**Patch id**:
The platform's own fingerprint of an answer's change set: a hash over each path the answer changes, with its content before and after, so the same change gives the same id however its commits were made.
_Avoid_: git patch-id, diff hash

## People and attention

**Asker**:
The person credited with deciding a change was worth making.

**Answerer**:
The accountable human who signs an answer; any agent works through their token.
_Avoid_: contributor (when meaning this role), agent identity

**Decider**:
A person whose decisions open asks, accept proposals and finish answers for an area; a path may name several, and may ask that more than one of them agree.
_Avoid_: reviewer, approver, owner, delegate

**Decision**:
One choice put to a project's deciders, with its evidence and a safe default that is taken if nobody decides before it expires. Where a path asks for more than one decider, the choice takes effect once that many have chosen alike, and waits until then.
_Avoid_: approval, vote, review request, quorum

**Today**:
A decider's daily page of open decisions, ordered by expiry and held to their budget; the overflow waits for a later day.
_Avoid_: inbox, queue, dashboard

**Budget**:
The number of decisions a decider takes per day; a decision past it waits, and one that expires undecided takes its default.

**Vouch**:
A line in the project's vouch file by which a member admits a person to claim and to submit sealed answers; it may carry the member's reason and the landing it followed, and it is read as a line, never counted.
_Avoid_: approval, whitelist, endorsement, trust score

**Denouncement**:
A line in the project's vouch file that bars a person from making proposals and posting in discussions; it is shown as the line it is, never as a warning beside the person's name.
_Avoid_: ban, block, flag

**Record**:
A person's landings by area and kind that stayed unreverted for 30 days, used only for trust rules, never shown as a score.
_Avoid_: reputation, karma, points

**Credit**:
The trailers on a landing (Asked-by, Signed-off-by, Decided-by, Mentored-by, Finished-by, Advised-by) naming every human role.
_Avoid_: co-author (for agents), attribution

**Front page**:
The cross-project list of open asks a viewer may take.
_Avoid_: explore, trending, network

## Visibility

**Layer**:
A separate repo holding one audience's files for a project, overlaid on main's paths only where that audience may read.
_Avoid_: private branch, private folder, overlay (as a noun)

**Audience**:
The set of people who may read a layer: public, maintainers, security group, claimants, personal.

**Disclosure**:
What non-readers learn about a layer's contents: public, sealed, counted, declared, hidden or writeOnly.

**Release**:
The only way content moves to a wider audience: a typed, credited, irreversible landing.
_Avoid_: publish, declassify, leak

**Held-back check**:
A check stored in the maintainers layer, run by the platform, reported to answerers as one bit per area.
_Avoid_: hidden test, private test, holdout, sealed test

**Commitment**:
The salted SHA-256 root of a held-back suite, printed on every landing it judged.

**Posture**:
The label the platform computes from a project's visibility config as it stands now: Open, Open with sealed evidence, Open on schedule, Open core, or Source available. A narrowing stands only once a decider accepts it and its notice runs out. Every page and list shows the posture the ledger shows, said once per page.
_Avoid_: licence (they are different things)

**Ledger**:
The public, append-only record of a project's layers, counts, commitments, releases and posture changes; the one record a clone does not yet carry.

**Env shape**:
The public schema of a project's environment variables: its committed .env.schema file, in the @env-spec format that varlock reads, which the platform parses from the landed SHA and never resolves.
_Avoid_: env.ts, .env.example, secrets file

**Write-only value**:
A value for one @sensitive env item, set by a decider and stored encrypted by the platform; nobody can read it back, and it reaches only runs of landed code or is swapped in at the network boundary.
_Avoid_: secret (alone), vault entry

**Placeholder**:
The stand-in that unlanded code sees for a write-only value; for a @proxy item the platform swaps it for the real value on matching outbound HTTPS requests.
_Avoid_: dummy value, mock secret

## Platform

**Project name**:
A project's full name, `<owner>/<name>`: an owner, then the short name the owner chose. It is the project's address on every surface.
_Avoid_: slug, repo name, full name, path

**Owner**:
The namespace a project is named in: a person's handle, or a source namespace. Owning a namespace is the right to make projects in it and nothing more; deciding stays with the config folder.
_Avoid_: org, account, maintainer, admin

**Source namespace**:
An owner that is the host and the account on that host a repo was imported from, such as `github.com/pallets`, so an import's address, `<host>/<account>/<name>`, says where it came from. Here, and only here, account means the host's account, never one on this platform.
_Avoid_: upstream, origin, mirror

**Config folder**:
The .myr/ folder on main holding the project's process as TypeScript: project.ts, kinds, asks, visibility.ts, the vouch file.
_Avoid_: settings, workflow files

**Policy**:
A project's rules as the platform evaluated them from the config folder at one landed SHA, or the defaults when the project has no config folder. The web shows it on the project's Policy page: who decides which paths, who is vouched for, the limits and the agent rules.
_Avoid_: settings, config (when meaning the evaluated result), people page

**Tag**:
A git tag on main naming one commit, as the project's history has it.
_Avoid_: release (a code host's release notes and assets are not git data)

**Run block**:
The config folder's declaration of the project's own commands: setup, doctor, test, checks.

**Gateway**:
The platform's git endpoint, which holds every storage credential, enforces custody and visibility, and returns refusals in git's own output; whichever host keeps the repos sits behind it.
_Avoid_: remote (alone), proxy, knot, seed

**Project skill**:
The agent skill and AGENTS.md block generated from the run block, whose local check matches the gate.
_Avoid_: CONTRIBUTING.md
