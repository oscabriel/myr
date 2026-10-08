---
name: Myr web
description: Every page is a signed test report for a change.
colors:
  paper: "#f5f8fa"
  paper-dark: "#0e1114"
  ink: "oklch(0.21 0.015 258)"
  ink-dark: "oklch(0.94 0.005 258)"
  surface: "oklch(0.955 0.005 245)"
  surface-dark: "oklch(0.215 0.009 258)"
  popover: "oklch(0.995 0.002 240)"
  popover-dark: "oklch(0.235 0.009 258)"
  muted: "oklch(0.48 0.012 258)"
  muted-dark: "oklch(0.72 0.01 258)"
  rule: "oklch(0.86 0.007 255)"
  rule-dark: "oklch(0.33 0.01 258)"
  rule-strong: "oklch(0.21 0.015 258)"
  rule-strong-dark: "oklch(0.94 0.005 258)"
  landed: "oklch(0.47 0.11 155)"
  landed-dark: "oklch(0.78 0.13 155)"
  checking: "oklch(0.48 0.13 252)"
  checking-dark: "oklch(0.76 0.11 250)"
  waiting: "oklch(0.5 0.1 70)"
  waiting-dark: "oklch(0.82 0.12 78)"
  refused: "oklch(0.5 0.18 27)"
  refused-dark: "oklch(0.73 0.15 25)"
  sealed: "oklch(0.46 0.13 305)"
  sealed-dark: "oklch(0.76 0.11 305)"
typography:
  headline:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: "2.2rem"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: "1.65rem"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.55rem"
  small:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.35rem"
  label:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1.1rem"
  transcript:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.5rem"
rounded:
  none: "0px"
  sm: "1px"
  md: "2px"
spacing:
  cell: "6px 8px"
  row: "12px"
  gutter: "16px"
  gutter-wide: "24px"
  section: "32px"
components:
  command-line:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.transcript}"
    rounded: "{rounded.none}"
    padding: "4px 4px 4px 12px"
  refusal-headline:
    textColor: "{colors.refused}"
    typography: "{typography.transcript}"
    padding: "8px 0"
  held-back-line:
    textColor: "{colors.sealed}"
    typography: "{typography.transcript}"
  posture-badge:
    textColor: "{colors.sealed}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  posture-badge-open:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  stage-cell:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "{spacing.cell}"
  field-label:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    width: "6.5rem"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "32px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "28px"
  decision-choice:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "0 16px"
  decision-choice-default:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "0 16px"
---

# Design System: the web

The web's look, as built, for anyone adding or changing a page. Tokens live in `apps/web/src/styles.css`; the pieces that draw refusals, credit, posture, outcomes, stages, commands, times, people and empty lists live in `apps/web/src/features/shared/`, and the report-sheet fields in `apps/web/src/features/ask/fields.tsx`. A page uses them rather than drawing its own. Words follow `GLOSSARY.md` and `PRODUCT.md`.

## Overview

**Creative North Star: "The Test Certificate"**

Every page is a report sheet for a change: a title over a double rule, ruled fields, a results row for the gate's stages, a nonconformance block when the gate refused, and the signatories kept apart from the instruments used. A calibration certificate lists who signed it and, separately, the equipment the test ran on; the web does the same with credit trailers (people) and `Assisted-by` (agents, never credit). Landed is the stamp; held-back checks and layers are the seal.

The pages are for operating, not persuading. Density is set by a decider clearing Today on a phone and a contributor reading a refusal beside a terminal. Nothing is decoration that is not a rule, a field or a mark. Colour means state and nothing else, and always sits beside a word and a mark, so a page read in grayscale, by a screen reader or in a terminal says the same thing.

Rejected on purpose: the developer-forge dashboard (cards in a grid, a blue accent, pill badges everywhere) and its opposite, the terminal costume (green on black, monospace for everything). Monospace appears only where the text is code: commands, refusal transcripts, trailers, SHAs, paths, ids and env keys.

**Key Characteristics:**

- One-pixel hairline rules part sections and rows; boxes inside boxes never do.
- A page title sits over a 3 px double rule in ink, the sheet's header; it is the one heavy line on a page.
- State is a mark (check, dot, cross, hollow circle, dash, hourglass, stamp, lock), then a word, then a colour.
- Every action is a command to copy, never a form for something git or the CLI does. The only web controls that change anything are a decider's choices and signing in or out.
- Light and dark follow the system setting; there is no toggle, no script and no flash.
- Motion carries state, never decoration: transitions of 150–250 ms, and one authored moment, the landing's stamp.

## Colors

Cool bond paper and blue-black ink, with five state roles that never appear as decoration. Every state role measures at least 5.3:1 against paper and against the field surface, in both themes; body ink measures about 16:1.

### Primary

- **Blue-black Ink** (`--foreground`; `ink`, `ink-dark`): text, the page title, primary buttons, a decider's non-default choices, the focus outline. It is the only accent: the web has no brand colour.

### State roles

- **Landed Green** (`--landed`): the change is on main. The landing's stamp mark and lead word, passed stages, a decision just taken.
- **Checking Blue** (`--checking`): the gate is running a stage now. The current stage while checking, the "Checking" lead word, the text caret and the selection tint (22% of it over the paper).
- **Waiting Ochre** (`--waiting`): passed or paused, waiting on a person or a parent ask (a decision, a finish, a parent landing); a decision that expires within the day; the mark of a retryable refusal. Waiting is never shown in the refused colour.
- **Refused Red** (`--refused`): a refusal. The rubric colour: the nonconformance block's top rule, its headline and each refusal's tag. shadcn's `destructive` maps here, so nothing destructive may be red unless it is a refusal.
- **Sealed Violet** (`--sealed`): held-back checks, layers and sealed evidence. The `Held-back:` trailer and the answer's held-back lines (with a lock), a posture that keeps something sealed, the ledger's layer and area headings, a sensitive env item's mark.

### Neutral

- **Bond Paper** (`--background`; `paper`, `paper-dark`): the page and shadcn's `card`. Hex, because the two `theme-color` metas (one per scheme) and the web app manifest repeat it from `features/shared/theme.ts`, and a test holds the two equal.
- **Field Surface** (`--surface`): command lines and filled fields; shadcn's `muted`, `secondary` and `accent` all resolve here.
- **Popover White** (`--popover`): the one raised layer's ground (dialogs, menus, tooltips), a step lighter than paper; dark, a step lighter than the surface.
- **Muted Grey** (`--muted`, used as `text-muted-foreground`): field labels, secondary lines, stages not reached or not needed, the `$` of a command line, `Assisted-by` lines.
- **Hairline** (`--rule`): every border and rule, shadcn's `border` and `input`, and the underline of links in running text.
- **Strong Rule** (`--rule-strong`, ink in each theme): the page title's double rule, the current nav item's underline, the open posture's badge border.

### Named Rules

**The Rubric Rule.** Red belongs to refusals. A destructive button, an error toast or a "danger" badge uses the refused role only when it is a refusal.

**The Word First Rule.** No state is carried by colour alone: every coloured mark has a word beside it ("passed", "now", "refused", "not yet", "not needed"; "Waiting", "Landed", "Checking").

**The No Score Rule.** No colour, size or ordering ever ranks a person. Handles are links in ink; a record is never shown as a number.

## Typography

**Body Font:** Public Sans (variable, self-hosted, latin and latin-ext; fallback `ui-sans-serif, system-ui`)
**Mono Font:** JetBrains Mono (variable, self-hosted; fallback `ui-monospace`), with contextual alternates off for code

**Character:** Public Sans was drawn for government forms: a workhorse grotesque that reads as an official document without ceremony. JetBrains Mono sets only what a terminal would print.

### Hierarchy

A fixed rem scale, ratio about 1.2; product type does not float with the viewport. Numbers in times and table cells are tabular.

- **Headline** (600, 1.75rem/2.2rem, -0.02em, balanced): the page title in `PageShell`, one per page.
- **Title** (600, 1.1875rem/1.65rem, -0.01em): a region of a page (`Region`), a decision's subject.
- **Body** (400, 1rem/1.55rem): prose, an ask's want, outcome sentences; prose holds to 65–75ch.
- **Small** (400, 0.875rem/1.35rem): navigation, field values, secondary lines, Today's rows; the most used size.
- **Label** (500, 0.75rem/1.1rem, sentence case, muted): field labels ("Credit", "Plain git: clone any project"), stage names, Today's budget labels. No uppercase tracking, and never a kicker above a heading.
- **Transcript** (JetBrains Mono 400, 0.8125rem/1.5rem): refusal lines, command lines, trailers, held-back lines, ids, SHAs and env keys. Refusal transcripts hold to 96ch, about git's width.

The stage strip's state words are the one size below the label (0.6875rem), always beside their mark.

### Named Rules

**The Code Is Mono Rule.** Monospace means "this is what git or a terminal prints or takes". Prose, labels and buttons are never mono.

## Layout

One centred column, 72rem wide at most (`max-w-6xl`), with a 16 px gutter on phones and 24 px from 640 px. The header is 48 px: the name, then Asks (the front page) and Today, then the session slot at the end. Every page is `PageShell`: its title over the double rule, then its regions 32 px apart; inside a region, the heading sits 12 px above its content. The footer gives the two ways in, plain git and the CLI install line, in one column on phones and two from 640 px.

- **Fields** (`Fields`, `Field`): a ruled grid of label and value, the label column at least 6.5rem; from 1024 px two fields share a row. Each row is 8 px top and bottom with a hairline below.
- **Two columns from 1024 px:** the project page (its open asks and recent landings beside a 22rem column on how to take part) and the ask page (the brief beside a column of up to 26rem). Below that, one column.
- **Lists** are ruled rows (12 to 16 px top and bottom, a hairline between), never cards in a grid.
- **Today:** the budget as two counters in a ruled pair (decisions, finishes), then one decision per ruled row, 20 px top and bottom.

Phone width (360 px) is a first-class layout: nothing scrolls sideways. Long commands, paths, SHAs and trailers wrap anywhere rather than overflow; the stage strip folds from seven cells in a row to four and three; a decision's choices become a two-column grid of 44 px buttons; the copy button keeps its label for screen readers only.

## Elevation & Depth

Flat. No shadows on the page; depth is rules and the field surface. Overlays (dialog, dropdown, tooltip) are the only raised layers, on the popover colour with shadcn's own ring and shadow.

## Shapes

Square. The radius is 2 px (`--radius: 0.125rem`), and shadcn's base-lyra components already square most corners. Borders are one-pixel hairlines; the page title's double rule is the one heavier line; the refusal block's 2 px top rule is the one coloured line. An empty state's border is dashed, an unfilled field; so is the rule that parts disclosed agents from credit.

## Components

### Command line (`CommandLine`)

- **Character:** the line a reader runs next, whole and copyable.
- **Shape:** a field-surface box with a hairline border that hugs its command, a muted `$` that selection skips, the command in mono (one tap selects all of it), and a ghost "Copy" button, icon only on phones. Copying shows "Copied" for 2 s.

### Refusal (`RefusalView`)

- **Character:** the nonconformance block. It reads exactly as `git push` printed it.
- **Shape:** a 2 px refused top rule, then `headline(refusals)` in mono red with an octagon mark, then one row per refusal, parted by hairlines: its `explain` lines verbatim (indentation kept, the tag in red), then its `next` as a `CommandLine`. A retryable refusal's mark is an ochre turn-back arrow; a final one's is the red octagon. `data-refusal` and `data-retryable` carry it. The web never rewords a refusal.

### Outcome (`OutcomeView`) and stage strip (`StageStrip`)

- **Outcome:** one sentence, a mark and a lead word in the role colour, the rest in ink: "Checking at the checks stage", "Passed, waiting for a decider's finish from okonkwo", "Waiting on decision dec-000001", "Passed, waiting for drop-legacy-fetch-burrow-kit to land first", "Landed as 9b1c3e5". A refusal is drawn by `RefusalView`. `data-outcome` and `data-state` (`waiting` or `final`) carry it.
- **The stamp:** a landed outcome's mark settles once, 420 ms, from 1.35 times its size with an exponential ease-out; reduced motion skips it.
- **Stage strip:** the gate's results row, a ruled table of seven cells in cost order (Parse, Shape, Merge, Cheap, Checks, Held-back, Decider), each with a mark, its label and a state word: passed (green check), now (dot, blue while checking, ochre while waiting), refused (red cross), not yet (hollow circle, muted), not needed (dash, muted). `data-stage` and `data-state` on each cell; the current cell is `aria-current="step"`.

### Credit trailers (`CreditTrailers`) and held-back lines (`HeldBackBits`)

- **Character:** the signatories, then the seal, then the instruments, as the landing commit carries them.
- **Credit:** a "Credit" label over one mono line per trailer, `Role: handle`, in the order of `CreditRole`'s literals (`Asked-by` first), each handle a link to `/people/<handle>`.
- **Held-back:** one sealed-violet mono line with a lock, `Held-back: export 7/7 @ sha256:…; parser 4/4 @ sha256:…`. On an answer's page, the same seal as one line per area (`export 6/7 @ sha256:…`): the area and its count, never a check's name.
- **Agents:** below a dashed rule and the label "Agents used, disclosed and not credit", one muted `Assisted-by:` line per agent, spelled as the trailer is (`pi:opus-4 (claimed)`).

### Posture badge (`PostureBadge`)

- **Shape:** a square outline badge holding the platform's own label, never rewritten: sealed violet for postures that keep something sealed (Open with sealed evidence, Open core, Open on schedule), an ink border for Open, a hairline and muted text for Source available. `data-posture` carries the literal.

### Fields (`Fields`, `Field`) and regions (`Region`)

- **Character:** the header block of a report sheet.
- **Shape:** a muted label over or beside its value, one ruled row each; values that are code wrap anywhere. A region is a Title heading over its content, with no box around it.

### Ledger and env shape

- **Ledger:** the posture badge, then each layer as a mono sealed-violet name with its audience, holdings, disclosure and reason; each sealed area as a sealed-violet heading ("export: 7 sealed checks by 3 people") with its committed root and admission; then every entry, newest first, as ruled rows of a muted date and a sentence. No path, check name or file name appears.
- **Env shape:** a muted caption, "env shape: varlock's `.env.schema` format", linked to varlock; the fields of where it was read; the `env set` command as a `CommandLine` (never a form); then each item: its key in mono (with a hairline-bordered "Deprecated" tag when it is), its description, and its fields: type in mono, required, sensitive (a sealed-violet lock and "yes"), proxy hosts, tags, docs, and for a sensitive item who set its value and when, or "not set" in muted grey. Never a value, and never the placeholder an answer sees.

### Decision card (`DecisionCard`) and Today

- **Character:** one decision, answerable in one tap.
- **Shape:** the project and decision id in muted mono, the subject as a Title, then its expiry (ochre and medium weight when it ends within the day, muted otherwise, with an hourglass) and its safe default (a shield mark), the evidence as fields, an optional note behind a disclosure, then the choices. Each choice is a square button, ink on paper, 44 px tall in a two-column grid on phones and 36 px in a row from 640 px; the default choice is the outline button with the word "default" beside its name.
- **Today's budget:** two counters in a ruled pair, Decisions and Finishes, each a label over a 1.75rem tabular number and a muted line of what is left.

### Time (`When`), people (`HandleLink`), empty lists (`EmptyState`)

- **When:** "in 3 h", "2 d ago", "now"; the exact time in `dateTime` and the tooltip.
- **HandleLink:** the handle in medium weight, underlined in the hairline colour, the underline in ink on hover.
- **EmptyState:** a dashed-border block saying what is empty, and the command that would change it.

### Buttons

- **Shape:** square (no radius), Label type (0.75rem at 500 weight); a decision's choices step up to 0.875rem.
- **Primary:** ink on paper, 32 px high; hover lightens the ink.
- **Ghost:** no fill until hover, which fills with the field surface; used for Copy and secondary actions.
- **Outline:** paper with a hairline border; the default choice on a decision.
- **Focus:** the global 2 px ink outline, 2 px out, on every control; a pressed button drops 1 px.

### Navigation

- Text links in muted ink, ink on hover; the current page in ink at medium weight with a 2 px strong-rule underline at the header's foot (`aria-current="page"`). A skip link to `#main` appears on focus. Links in running text are underlined in the hairline colour, ink on hover.

### shadcn

shadcn 4.21.2, style `base-lyra` on Base UI, in `src/components/ui/` (generated). The pages use its button, badge, table (an answer's lanes), textarea (a decision's note), tooltip and skeleton.

## Do's and Don'ts

### Do:

- **Do** draw refusals, credit, held-back lines, posture, outcomes and stages with the shared components; change the component, not a page's copy of it.
- **Do** show the command for every action, through `CommandLine`.
- **Do** part sections with hairline rules and space: 32 px between page regions, 12 px between a region's heading and its content.
- **Do** carry every state as a mark, then a word, then a colour, and key tests and styles on the `data-*` attribute that names it.
- **Do** keep text contrast at 4.5:1 or more and every control reachable and visibly focused by keyboard; give an icon `aria-hidden` and put its meaning in the text beside it.
- **Do** check every page at 360 px with no horizontal scroll, and with the system's text size raised.
- **Do** honour `prefers-reduced-motion`: every animation and transition drops to nothing.
- **Do** take the platform URL from the root route's loader data (`getRouteApi("__root__").useLoaderData().platformUrl`).

### Don't:

- **Don't** reword a refusal or compute your own explanation of one; render `explain` and `headline`.
- **Don't** show a score, a rank, a count of a person's landings as a measure, or a leaderboard.
- **Don't** put cards in a grid or boxes inside boxes; a section is a heading and rules.
- **Don't** use red for anything but a refusal, violet for anything but sealed things, or colour without a word.
- **Don't** use monospace for prose, labels or buttons.
- **Don't** show an env value, or the placeholder an answer sees, anywhere.
- **Don't** add a form for something git or the CLI does, a theme toggle, or a second component kit.
