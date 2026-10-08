# Product

<!-- impeccable:product-schema 1 -->

What the web of Myr is for, and what it never does. Words follow `GLOSSARY.md`: ask, answer, check, refusal, decider, Today, landing. Written in W5 (issue 511) before the pages were built; W7 (issue 713) revises it from what shipped. Facts marked ASSUMPTION were inferred from the build plan, not confirmed by the maintainer.

## Platform

web

## Users

Four readers, in the order the web serves them:

1. **A newcomer looking for a first ask.** They arrive from a link or the front page, often on a phone, and want to know what a project wants, whether they may take it, and the three commands that start it. They have no account yet and may never need one: git and the CLI do the work.
2. **A contributor checking an answer.** They pushed from a terminal (or their agent did) and open the answer's page to see where it stands: which stage of the gate it reached, which checks ran, and, if it was refused, the same refusal `git push` printed, with its `next` command.
3. **A decider spending a daily budget.** They open Today, often on a phone between other work, and take a handful of decisions, each with its evidence and its safe default, in one tap each. A decider who does nothing lets nothing in.
4. **Agents fetching Markdown.** A harness reads an ask as Markdown (`Accept: text/markdown` or `.md`), `llms.txt`, and the well-known MCP and skill documents. The HTML pages are for people; the same facts in Markdown are for agents.

## Product Purpose

Myr is a whole Git platform on Cloudflare: everything a project ships is public, the contribution process is typed code on main, and a change lands only by passing a typed gate. The terminal and git are where work happens. The web is where people look: at what a project wants, where an answer stands, who is credited for a landing, and what a decider owes today.

Success: a newcomer goes from the front page to a running `claim` in under a minute; a contributor reads a refusal on the web exactly as git printed it; a decider clears Today on a phone.

## Positioning

A refusal is a typed value with a reason, a place, a next command and whether retrying can help; credit is a set of git trailers on the landing commit; a posture is computed from the project's config. The web renders those values as they are. It never re-words a refusal, never invents a score, and never shows a diff to someone who does not decide.

## Operating Context

- Work happens in git and the CLI (`Brand.cli` in code). Every page that suggests an action shows the command, copyable, rather than a web form for it. Signing in is only for deciders (Today, decisions, finishing an answer).
- Pages per job:
  - **Front page** (`/`): open asks across projects a viewer may take, filtered by kind and by asks held for newcomers.
  - **Project** (`/$project`): its asks, its posture, its recent landings with their credit trailers, and how to take part (clone, `asks`, `claim`, `check`).
  - **Ask** (`/$project/asks/$ask`): the want, the territory, the check, who may claim, and the commands; also served as Markdown.
  - **Answer** (`/$project/answers/$ask`): the verdict stage by stage, the lanes, held-back results as one bit per area, or the refusal.
  - **Person** (`/people/$handle`): their credits by role and area, never a score.
  - **Today** (`/today`): a decider's decisions with evidence, defaults and expiry, against the budget.
  - **Ledger and env shape** (W6): the public record of layers, commitments and posture changes; the env shape with no values.
- Phone width is a first-class target (Today installs as a PWA). ASSUMPTION: deciders use Today mostly on a phone and the other pages mostly on a laptop beside a terminal.

## Capabilities and Constraints

- The web Worker holds no storage binding and no secrets; every read goes through `/rpc` to the platform (AGENTS.md principle 7). It cannot show what the platform does not return.
- Refusal text comes only from `@repo/protocol/render` (`explain`, `headline`), the one renderer for git, the CLI, MCP and the web (principle 3).
- The web never: shows a diff to anyone but a decider finishing an answer; shows a score, rank or count of a person as a measure of quality (a record is for trust rules only); reads a write-only value back; names a held-back path or case to someone outside its layer.
- Undecided: whether the web gets a light or dark default per page (it follows the system setting); a custom domain (H1).

## Brand Commitments

- The name lives only in `packages/brand`: code takes it from `Brand.name` and the command from `Brand.cli`.
- Tone: plain, factual, git-native. Sentences say what happened and what to run next. No exclamation marks, no celebration copy, no gamification, no "PR", "issue" (for an ask), "reputation" or "review".
- Credit trailers read as they do on the commit (`Asked-by: ines`), in one order; `Assisted-by` is shown apart because it is a disclosure, never credit.

## Evidence on Hand

- The examples `examples/datekit` and `examples/burrow` are fictional projects with fictional people (`ines-v`, `okonkwo`, `okafor`, `lin-h`); pages showing them must not pass them off as real users.
- Measured numbers come only from `bench/results/`. No testimonials, customers or adoption figures exist; none may be invented.

## Product Principles

1. **The terminal is the workplace; the web is the window.** Every action shows its command; the web adds no second way to land.
2. **Render the typed value, not a paraphrase.** Refusals, credits, postures and outcomes look the same on every page because one component draws each.
3. **Waiting is not refusing.** Checking, waiting on a parent ask, a finish or a decision each read as waiting, never as an error.
4. **No scores.** People appear by handle and role; nothing ranks them.
5. **Decisions fit a phone.** Today's density is set by a decider clearing it in a few minutes on a small screen.

## Accessibility & Inclusion

WCAG 2.2 AA: text contrast at least 4.5:1, visible focus on every control, every state carried by a word as well as a colour, `prefers-reduced-motion` honoured, and usable at 360 px wide with no horizontal scroll.
