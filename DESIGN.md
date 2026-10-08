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
  muted: "oklch(0.48 0.012 258)"
  muted-dark: "oklch(0.72 0.01 258)"
  rule: "oklch(0.86 0.007 255)"
  rule-dark: "oklch(0.33 0.01 258)"
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
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.55rem"
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
  posture-badge:
    textColor: "{colors.sealed}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  stage-cell:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "{spacing.cell}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "32px"
---

# Design System: the web

The web's look, for every page issue to start from. Tokens live in `apps/web/src/styles.css`; the shared pieces that draw refusals, credit, posture, outcomes and stages live in `apps/web/src/features/shared/`, and a page uses them rather than drawing its own. Words follow `GLOSSARY.md` and `PRODUCT.md`. Written in W5 (issue 511) from the shell and shared pieces, and checked against the pages that shipped by W5's integration (issue 599); W7 (issue 713) revises it.

## Overview

**Creative North Star: "The Test Certificate"**

Every page is a report sheet for a change: a title over a double rule, fields, a results row for the gate's stages, a nonconformance block when the gate refused, and signatories kept apart from the instruments used. A calibration certificate lists who signed it and, separately, the equipment the test ran on; the web does the same with credit trailers (people) and `Assisted-by` (agents, never credit). Landed is the stamp; held-back checks are the seal.

The pages are for operating, not persuading. Density is set by a decider clearing Today on a phone and by a contributor reading a refusal beside a terminal. The look carries no decoration that is not a rule, a field or a mark. Colour means state and nothing else, and always sits beside a word and a mark, so a page read in grayscale, by a screen reader or in a terminal says the same thing.

Rejected on purpose: the developer-forge dashboard (cards in a grid, a blue accent, pill badges everywhere) and its opposite, the terminal costume (green on black, monospace for everything). Monospace appears only where the text is code: commands, refusal transcripts, trailers, SHAs, paths and ids.

**Key Characteristics:**

- One-pixel hairline rules part sections; boxes inside boxes never do.
- A page title sits over a double rule (`border-double`, 3 px), the sheet's header.
- State is a mark (check, dot, cross, hollow circle, dash), then a word, then a colour.
- Every action is a command to copy, never a form for something git or the CLI does.
- Light and dark follow the system setting; there is no toggle.

## Colors

Cool bond paper and blue-black ink, with five state roles that never appear as decoration.

### State roles

Each is text-safe: at least 5:1 on paper and on surface, in both themes.

- **Landed green** (`--landed`, oklch(0.47 0.11 155); dark oklch(0.78 0.13 155)): the change is on main. The landing's stamp mark, passed stages, a landed outcome's lead word.
- **Checking blue** (`--checking`, oklch(0.48 0.13 252); dark oklch(0.76 0.11 250)): the gate is running a stage now. The current stage while checking, the "Checking" lead word, the text caret, the selection tint.
- **Waiting ochre** (`--waiting`, oklch(0.5 0.1 70); dark oklch(0.82 0.12 78)): passed or paused, waiting on a person or a parent ask (a decision, a finish, a parent landing), and the mark of a retryable refusal. Waiting is never shown in the refused colour.
- **Refused red** (`--refused`, oklch(0.5 0.18 27); dark oklch(0.73 0.15 25)): a refusal. The rubric colour: the nonconformance block's top rule, its headline and each refusal's tag. Nothing else is red.
- **Sealed violet** (`--sealed`, oklch(0.46 0.13 305); dark oklch(0.76 0.11 305)): held-back checks, layers, sealed evidence and the postures that keep something sealed. The `Held-back:` trailer line, the posture badge, the ledger (W6).
- **Muted grey** (`--muted`, oklch(0.48 0.012 258); dark oklch(0.72 0.01 258)): not reached, not needed, secondary text and field labels. Used through Tailwind's `text-muted-foreground`.

### Neutral

- **Bond paper** (`--background`, #f5f8fa; dark #0e1114): the page. Hex, because the two `theme-color` metas (one per scheme, drawn by the root document's `ThemeColors`) and the web app manifest repeat it (`features/shared/theme.ts`; a test holds the two equal).
- **Blue-black ink** (`--foreground`, oklch(0.21 0.015 258); dark oklch(0.94 0.005 258)): text, the double rule, primary buttons, the focus outline.
- **Field surface** (`--surface`, oklch(0.955 0.005 245); dark oklch(0.215 0.009 258)): command lines and filled fields. shadcn's `bg-muted`, `bg-secondary` and `bg-accent` all resolve here.
- **Hairline** (`--rule`, oklch(0.86 0.007 255); dark oklch(0.33 0.01 258)): every border and rule.

### Named Rules

**The Rubric Rule.** Red belongs to refusals. A destructive button, an error toast or a "danger" badge uses the refused role only when it is a refusal.

**The Word First Rule.** No state is carried by colour alone: every coloured mark has a word beside it (`passed`, `now`, `refused`, `not yet`, `not needed`; "Waiting", "Landed").

**The No Score Rule.** No colour, size or ordering ever ranks a person. Handles are links in ink; a record is never shown as a number.

## Typography

**Body Font:** Public Sans (variable, self-hosted, latin and latin-ext; fallback `ui-sans-serif, system-ui`)
**Mono Font:** JetBrains Mono (variable, self-hosted; fallback `ui-monospace`)

**Character:** Public Sans was drawn for government forms, a workhorse grotesque that reads as an official document without ceremony. JetBrains Mono sets only what a terminal would print.

### Hierarchy

A fixed rem scale, ratio about 1.2; product type does not float with the viewport.

- **Headline** (600, 1.75rem, 2.2rem, -0.02em, `text-balance`): the page title in `PageShell`, one per page.
- **Title** (600, 1.1875rem): a section of a page.
- **Body** (400, 1rem, 1.55rem): prose and outcome sentences; prose holds to 65–75ch.
- **Small** (0.875rem): nav, secondary lines.
- **Label** (500, 0.75rem, sentence case, muted): field labels ("Credit", "Plain git: clone any project") and stage cells. No uppercase tracking, and never a kicker above a heading.
- **Transcript** (JetBrains Mono 400, 0.8125rem, 1.5rem): refusal lines, command lines, trailers, ids. Refusal transcripts hold to 96ch, about git's width.

## Layout

One centred column, `max-w-6xl` (72rem), with a 16 px gutter on phones and 24 px from `sm` (640 px). The header is 48 px: the name, then Asks (the front page) and Today, then the session slot at the end. Every page is `PageShell`: its title over the double rule, then its regions 32 px apart. The footer gives the two ways in, plain git and the CLI install line, in one column on phones and two from `sm`.

Phone width (360 px) is a first-class layout: nothing scrolls sideways. Long commands and paths wrap anywhere (`overflow-wrap: anywhere`) rather than overflow; the stage strip folds from seven cells in a row to four and three.

## Elevation & Depth

Flat. No shadows on the page; depth is rules and the field surface. Overlays (dialog, dropdown, tooltip) are the only raised layers, and they take shadcn's own ring and shadow.

## Shapes

Square. The radius is 2 px (`--radius: 0.125rem`), and shadcn's base-lyra components already square most corners (`rounded-none`). Borders are one-pixel hairlines; the page title's double rule is the one heavier line; an empty state's border is dashed, an unfilled field.

## Components

### Command line (`CommandLine`)
- **Character:** the line a reader runs next, whole and copyable.
- **Shape:** a field-surface box with a hairline border that hugs its command (`w-fit`, `max-w-full`), a muted `$` that selection skips, the command in mono (`select-all`, so one tap selects it), and a ghost "Copy" button (icon only on phones). Copying shows "Copied" for 2 s.

### Refusal (`RefusalView`)
- **Character:** the nonconformance block. It reads exactly as `git push` printed it.
- **Shape:** a 2 px refused top rule, then `headline(refusals)` in mono red with an octagon mark, then one row per refusal, parted by hairlines: its `explain` lines verbatim (indentation kept, tag in red), then its `next` command as a `CommandLine`. A retryable refusal's mark is an ochre turn-back arrow; a final one's is the red octagon. The web never rewords a refusal.

### Outcome (`OutcomeView`) and stage strip (`StageStrip`)
- **Outcome:** one sentence, a mark and a lead word in the role colour, the rest in ink: "Checking at the checks stage", "Passed, waiting for a decider's finish from okonkwo", "Waiting on decision dec-000001", "Landed as 9b1c3e5". A refusal is drawn by `RefusalView`. `data-outcome` and `data-state` (`waiting` or `final`) carry it for tests and styles.
- **Stage strip:** the gate's results row, a ruled table of seven cells in cost order (Parse, Shape, Merge, Cheap, Checks, Held-back, Decider), each with a mark, its label and a state word. `data-stage` and `data-state` (`passed`, `current`, `refused`, `pending`, `skipped`) on each cell; the current cell is `aria-current="step"`.

### Credit trailers (`CreditTrailers`)
- **Character:** the signatories, then the instruments, as the landing commit carries them.
- **Shape:** a "Credit" label over one mono line per trailer, `Role: handle`, in the order of `CreditRole`'s literals (Asked-by first), each handle a link to `/people/<handle>`. A `Held-back:` line follows in sealed violet with a lock mark. Then, below a dashed rule and labelled "Agents used, disclosed and not credit", one muted `Assisted-by:` line per agent, spelled as the trailer is (`pi:opus-4 (claimed)`).

### Posture badge (`PostureBadge`)
- **Shape:** a square outline badge with the platform's label, never rewritten; sealed violet for postures that keep something sealed, ink for open, muted for source available. `data-posture` carries the literal.

### Time (`When`), people (`HandleLink`), empty lists (`EmptyState`)
- **When:** "in 3 h", "2 d ago", "now"; the exact time in `dateTime` and the tooltip.
- **HandleLink:** the handle in medium weight, underlined in hairline colour, ink underline on hover.
- **EmptyState:** a dashed-border block with what is empty and the command that would change it.

### Buttons and the rest of shadcn
- shadcn 4.21.2, style `base-lyra` on Base UI, in `src/components/ui/` (generated; issue 511 owns them, views ask for more under their issue's Comments). Primary buttons are ink on paper, 32 px high, square; ghost buttons for secondary actions.

### Navigation
- Text links in muted ink; hover to ink; the current page in ink, medium weight, with a 2 px ink underline at the header's foot (`aria-current="page"`). A skip link to `#main` appears on focus.

## Motion

Minimal: motion carries state, never decoration. Transitions are 150–250 ms. One authored moment: a landing's stamp mark settles once (`animate-stamp`, 420 ms, scale 1.35 to 1 with an exponential ease-out). `prefers-reduced-motion` reduces every animation and transition to nothing.

## Accessibility

WCAG 2.2 AA. Text contrast at least 5:1 for every role in both themes (body ink is 16:1). Focus is a 2 px ink outline, 2 px out, on every control. Every state is a word as well as a colour and a mark. Icons are `aria-hidden`; their meaning is in the text beside them. The page works at 360 px with no horizontal scroll, and with the system's text size raised.

## Do's and Don'ts

### Do:
- **Do** draw refusals, credit, posture, outcomes and stages with the shared components; ask for a change to them under your issue's Comments.
- **Do** show the command for every action, through `CommandLine`.
- **Do** part sections with hairline rules and space (32 px between page regions).
- **Do** take the platform URL from the root route's loader data (`getRouteApi("__root__").useLoaderData().platformUrl`).

### Don't:
- **Don't** reword a refusal or compute your own explanation of one; render `explain` and `headline`.
- **Don't** show a score, a rank, a count of a person's landings as a measure, or a leaderboard.
- **Don't** put cards in a grid or boxes inside boxes; a section is a heading and rules.
- **Don't** use red for anything but a refusal, or colour without a word.
- **Don't** use monospace for prose or labels.
- **Don't** add a theme toggle or a second component kit.
