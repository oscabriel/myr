---
name: Myr web
description: The gate's control room. What state a change is in, whose move it is, and the command that runs next.
colors:
  paper: "#f5f8fa"
  paper-dark: "#0e1114"
  ink: "oklch(0.21 0.015 258)"
  ink-dark: "oklch(0.94 0.005 258)"
  surface: "oklch(0.955 0.005 245)"
  surface-dark: "oklch(0.215 0.009 258)"
  surface-2: "oklch(0.935 0.006 250)"
  surface-2-dark: "oklch(0.25 0.01 258)"
  popover: "oklch(0.995 0.002 240)"
  popover-dark: "oklch(0.235 0.009 258)"
  muted: "oklch(0.48 0.012 258)"
  muted-dark: "oklch(0.72 0.01 258)"
  rule: "oklch(0.86 0.007 255)"
  rule-dark: "oklch(0.33 0.01 258)"
  rule-strong: "oklch(0.21 0.015 258)"
  rule-strong-dark: "oklch(0.94 0.005 258)"
  input: "oklch(0.62 0.01 258)"
  input-dark: "oklch(0.55 0.01 258)"
  skeleton: "oklch(0.8 0.008 255)"
  skeleton-dark: "oklch(0.36 0.01 258)"
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
  syntax-string: "oklch(0.42 0.035 200)"
  syntax-string-dark: "oklch(0.8 0.035 200)"
  syntax-constant: "oklch(0.42 0.035 110)"
  syntax-constant-dark: "oklch(0.82 0.035 110)"
  syntax-comment: "oklch(0.42 0.012 258)"
  diff-add-sign: "oklch(0.51 0.09 195)"
  diff-add-sign-dark: "oklch(0.74 0.08 195)"
  diff-del-sign: "oklch(0.51 0.12 345)"
  diff-del-sign-dark: "oklch(0.72 0.1 345)"
typography:
  headline:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: "1.6rem"
    letterSpacing: "-0.01em"
  want:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: "1.5rem"
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.55rem"
  ui:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.3rem"
  label:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: "1.15rem"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    fontFeature: "\"calt\" 0, \"liga\" 0"
  terminal:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "20px"
    fontFeature: "\"calt\" 0, \"liga\" 0"
rounded:
  none: "0px"
  sm: "1px"
  md: "2px"
spacing:
  hairline: "1px"
  row-y: "10px"
  gutter-phone: "16px"
  gutter-tablet: "20px"
  gutter-shell: "24px"
  region: "32px"
  measure: "56rem"
  rail: "15rem"
  inspector: "20rem"
  inspector-codefacts: "22rem"
  row-phone: "88px"
components:
  context-bar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    height: "44px"
  toolbar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    height: "40px"
  row:
    textColor: "{colors.ink}"
    typography: "{typography.want}"
    padding: "10px 0"
    height: "64px"
  row-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.want}"
    height: "64px"
  row-selected-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.want}"
    height: "64px"
  row-group-header:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    height: "32px"
  rail-item-current:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    height: "32px"
  bottom-bar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    height: "56px"
  command-line:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.terminal}"
    rounded: "{rounded.none}"
    padding: "4px 4px 4px 12px"
  command-line-inspector:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.terminal}"
    rounded: "{rounded.none}"
    padding: "4px 4px 4px 12px"
  copy-action:
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    size: "32px"
  copy-action-inspector:
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    size: "28px"
  kbd:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 4px"
  refusal-headline:
    textColor: "{colors.refused}"
    typography: "{typography.terminal}"
    padding: "8px 0"
  held-back-line:
    textColor: "{colors.sealed}"
    typography: "{typography.terminal}"
  fact-label:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  stage-cell:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "6px 8px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "32px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "28px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    height: "32px"
  decision-choice:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "36px"
    padding: "0 16px"
  decision-choice-default:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "36px"
    padding: "0 16px"
  decision-choice-phone:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "44px"
---

# Design System: the web

The web's look, as built, for anyone adding or changing a page. Tokens live in `apps/web/src/styles.css`. The shell lives in `apps/web/src/features/shared/shell/`, and the pieces every page shares (the row, the status line, the family fan, the fact blocks, the copy action, refusals, credit, posture, outcomes, stages, commands, marks, times, people, empty and pending states) live in `apps/web/src/features/shared/`. A page uses them rather than drawing its own. Pierre's code drawing is configured once, in `apps/web/src/features/code/pierre.ts`. Words follow `GLOSSARY.md` and `PRODUCT.md`.

## Overview

**Creative North Star: "The gate's control room"**

The web is the console an operator keeps open beside a terminal: on the left, where you are; in the middle, what is waiting; on the right, the typed facts of the thing in your hand. Every screen answers three questions in this order: what state is it in, whose move is it, and what runs next. The answer to the last one is always a command you can copy. A reader selects one thing (a row, with a click or `j`), reads its state and its next command in the inspector, copies the command (`1`), and goes back to the terminal.

The pages are for operating, not persuading. One page is the exception: the landing at `/`, drawn outside the shell, says what the platform is and leads to the open asks (see "The landing"). Density is set by a decider clearing Today on a phone and a contributor reading a refusal beside a terminal: two-line rows (64 px, 66 px measured with their hairlines), 14 px metadata, a 13 px floor. Colour means state and nothing else, and always sits beside a word and a mark, so a page read in grayscale, by a screen reader or in a terminal says the same thing. In a list the colour sits on the mark and the word stays ink, so the one word that asks for a move is never the quietest thing on the page. One paper ground runs under all three panes; panes are parted by hairlines, never floated, rounded or shadowed. The landing's stamp is the one authored moment.

Rejected on purpose: the developer-forge dashboard (floating rounded panels on a grey ground, cards in a grid, stat tiles, a blue link colour, pill badges, avatar stacks, coloured file icons), its glossy cousin (dark glass, blur, glows, gradients), and the terminal costume (green on black, monospace for everything). Rejected too, from the peer platforms read in October 2026 and stated by mechanism: a filled pill or a tinted square that carries a state without its word (the lists of one peer are loud for that reason alone); a ladder of three or four surface steps used as zones (a lighter box for a row, a header, a card) on a darker page, which the One Ground Rule forbids; shadows and glows, a 48 px dark halo among them; `outline: none` on everything, which takes keyboard focus from every reader; text at 12 px and a fourth grey under 4.5:1 for line numbers and metadata; avatars (by email, generated, or stacked under a heading) and activity sparklines, since handles are links in ink and nothing counts a person; a revision ladder, each round a box under the last, where the fan and the round rows do the job on one line; a command box that ellipsises, since a command is shown whole; and a loading bar, spinners and shimmer in content. Monospace appears only where the text is what a terminal prints or takes: commands, refusal transcripts, trailers, SHAs, paths, ids, env keys and code.

**Key Characteristics:**

- Three panes on one ground: the rail (15 rem), main, and the inspector (20 rem, 22 rem from 1440 px, wide enough that the command it hands over reads on one line), parted by one-pixel rules, each scrolling on its own from 1120 px.
- State is a mark, then a word, then a colour; red belongs to refusals, violet to sealed things, and nothing else is coloured. In a row the colour is the mark's; the word is ink, except Refused and Landed.
- Every action is a command to copy, its text always in the page. The only web controls that change anything are a decider's choices, proposing an ask (and asking the platform's agent to draft it), and signing in or out.
- Light and dark follow the system setting; there is no toggle, no script and no flash.
- Motion carries state, never decoration: transitions of 120–200 ms, and the landing's stamp.

## Colors

Cool bond paper and blue-black ink, with five state roles that never appear as decoration. Every state role measures at least 5:1 against paper, against the field surface and against the pressed surface, in both schemes; body ink measures about 16:1.

### Primary

- **Blue-black Ink** (`--foreground`; `ink`, `ink-dark`): text, page titles, primary buttons, a decider's non-default choices, the current tab's underline, the focus outline. It is the only accent: the web has no brand colour, and links are ink.

### State roles

- **Landed Green** (`--landed`): the change is on main. The landing's stamp and lead word, passed stages, a decision whose choice took effect.
- **Checking Blue** (`--checking`): the gate is running a stage now. The current stage while checking, the "Checking" lead word, and the viewer's own selection (text selection and selected code lines, a tint of it over the paper).
- **Waiting Ochre** (`--waiting`): passed or paused, waiting on a person or another ask (a decision, a finish, a parent landing); a decision that expires within the day; the mark of a retryable refusal. Waiting is never shown in the refused colour.
- **Refused Red** (`--refused`): a refusal. The rubric colour: the refusal block's top rule, its headline and each refusal's tag. shadcn's `destructive` maps here, so nothing destructive may be red unless it is a refusal.
- **Sealed Violet** (`--sealed`): held-back checks, layers and sealed evidence. The `Held-back:` trailer and an answer's held-back lines (with a lock), a posture that keeps something sealed, the ledger's layer and area headings, a sensitive env item's mark.

### Code and diffs

- **Syntax** (`--syntax-*`): one low-chroma theme drawn from the tokens and handed to Pierre as a CSS-variable theme. Keywords, functions and parameters are ink; strings lean grey-teal and constants grey-olive (chroma 0.035, at least 30° from every state hue); comments and punctuation are a step darker than muted in light and muted in dark. Each keeps 4.5:1 on the paper and on a changed word's tint.
- **Diff tints** (`--diff-add-*`, `--diff-del-*`): additions teal, deletions rose, a family apart from landed green and refused red. The sign colour draws the `+` and `-`, the bars and a changed line's number (held to 4.5:1); a line's tint is that colour mixed into the paper (12% in light, 20% in dark, as Pierre mixes it, so the server's plain-text diff matches the drawing); emphasis marks the changed words. The file tree's status letters use the same family (A teal, D rose, M and R muted).

### Neutral

- **Bond Paper** (`--background`; `paper`, `paper-dark`): the ground of every pane and of shadcn's `card`. Hex, because the two `theme-color` metas and the web app manifest repeat it from `features/shared/theme.ts`, and a test holds them equal.
- **Field Surface** (`--surface`): command lines, the current rail item, a selected row, hover fills (at half strength), the current stage cell; shadcn's `muted`, `secondary` and `accent` resolve here.
- **Pressed Surface** (`--surface-2`): one step past the field surface, for a selected thing under the pointer only (a selected row hovered, a segmented control's current segment under hover), since a half-strength hover over a row already on the surface is invisible. It measures 1.13:1 against paper in light and 1.18:1 in dark, and every state role keeps at least 5:1 on it: the floor is waiting at 5.07:1 in light and refused at 6.27:1 in dark, with ink at about 14.6:1; `apps/web/test/tokens.test.ts` holds the pairs. Never a third step, never a zone.
- **Popover White** (`--popover`): the one raised layer's ground (dialogs, sheets, menus, tooltips), a step lighter than paper; dark, a step lighter than the surface.
- **Muted Grey** (`--muted`, as `text-muted-foreground`): labels, metadata lines, stages not reached or not needed, the `$` of a command line, `Assisted-by` lines, the bottom bar's other items.
- **Hairline** (`--rule`): every pane edge, border and rule, and the underline of links in running text.
- **Control Border** (`--input`): a form control's border at 3:1 on paper (3.4:1 light, 3.9:1 dark).
- **Skeleton Stroke** (`--skeleton`): the outlined bars of a placeholder row or fact (about 1.75:1), with no fill.
- **Strong Rule** (`--rule-strong`, ink in each scheme): the 2 px underline of the current filter or section tab, and the top edge of the bottom bar's current item.

### Named Rules

**The Rubric Rule.** Red belongs to refusals. A destructive button, a transport failure or a deletion in a diff is never red.

**The Word First Rule.** No state is carried by colour alone: every coloured mark has a word beside it or in its row ("passed", "now", "refused", "not yet", "not needed"; "Waiting", "Landed", "Checking").

**The Mark Carries Rule.** In a row the colour belongs to the mark; the state word is ink at 500, except Refused (red) and Landed (green), so a list of waiting asks is not an ochre stripe and the one actionable word, "Open to take", has the same weight as its neighbours. The status line, the state badge and the inspector keep the coloured word: there it is said once, beside its sentence.

**The No Score Rule.** No colour, size or ordering ever ranks a person. Handles are links in ink; a record is never shown as a number.

## Typography

**Body Font:** Public Sans (variable, self-hosted, latin and latin-ext, preloaded; a metric-matched fallback face over Arial keeps the swap from moving the page)
**Mono Font:** JetBrains Mono (variable, self-hosted, preloaded; a metric-matched fallback over Courier New), with contextual alternates and ligatures off (`=>` stays `=>`)

**Character:** Public Sans was drawn for government forms: a workhorse grotesque that reads as an official document without ceremony. JetBrains Mono sets only what a terminal would print.

### Hierarchy

A fixed rem scale, ratio about 1.15–1.2; product type does not float with the viewport. Numbers that can change (counts, times, line numbers, `+n −m`) are tabular. **Nothing is set below 13 px**; `apps/web/test/type-floor.test.ts` refuses the old 12 px and 11 px sizes and any arbitrary size.

- **Headline** (`text-headline`, 600, 1.5rem/2rem, -0.015em, balanced): one page title. A want over 80 characters drops to Title by itself.
- **Title** (`text-title`, 600, 1.1875rem/1.6rem, -0.01em): a long ask's title, a region head in main, the answer's outcome hero, a README's headings.
- **Want** (`text-want`, 1rem/1.5rem): a row's first line at 500, and a want or brief in prose at 400.
- **Body** (`text-body`, 400, 1rem/1.55rem): prose, held to 70ch.
- **UI** (`text-ui`, 400, 0.875rem/1.3rem; 500 for state words): row metadata, rail items, inspector values, buttons, toolbar controls, breadcrumbs. The most used size.
- **Label** (`text-label`, 500, 0.8125rem/1.15rem, sentence case, muted): fact block heads, field labels, group header counts, the bottom bar's words, a consequence line under a choice. No uppercase tracking, and never a kicker above a heading.
- **Mono** (`text-mono`, JetBrains Mono 400, 0.8125rem/1.25rem inline): ids, SHAs, paths, env keys. In transcripts (refusals, commands, trailers, held-back lines) it takes `leading-terminal` (1.5rem), and refusal transcripts hold to 96ch; in code and diffs it takes `leading-code` (20 px), Pierre's line.

Form fields are 16 px below 640 px (so a phone does not zoom on focus) and 14 px from there.

### Named Rules

**The Code Is Mono Rule.** Monospace means "this is what git or a terminal prints or takes". Prose, labels, buttons, headings and commit bodies are never mono.

**The Thirteen Floor Rule.** The smallest text on any page is 13 px, and it is a label or mono, never a sentence a reader must act on.

## Layout

The shell is the root layout (`apps/web/src/routes/__root.tsx`, `features/shared/shell/app-shell.tsx`) and never unmounts; each page renders one `Workspace` (`features/shared/shell/workspace.tsx`) holding its main pane and its inspector, both in the server's HTML. The breakpoints are named in `styles.css`:

| Name | From | What changes |
| --- | --- | --- |
| phone | below 40 rem | 44 px top bar, fixed 56 px bottom bar, 16 px gutters, facts inline after the head, unified diffs only, Files opens a full-height sheet |
| `tablet` | 40 rem | 48 px top bar with Menu (the rail as a sheet from the left), the section row under the head, 20 px gutters |
| `diffsplit` | 48 rem | a diff may go side by side |
| `shell` | 70 rem (1120 px) | the rail and the inspector are columns, rows select, 24 px gutters, each pane scrolls on its own |
| `codefacts` | 90 rem (1440 px) | the inspector widens to 22 rem; code pages keep it open as a column; below this, a Facts button opens it as a sheet from the right |

**From 1120 px** three panes share one paper ground, parted by hairlines: the **rail** (15 rem) on the left, **main** in the middle, the **inspector** (20 rem, and 22 rem from 1440 px) on the right. The widths are set by the inspector's commands: at 13 px mono in its bleed form (below) 20 rem holds about 32 characters a line and 22 rem about 36, so `git clone` of a project wraps once at most and every `next` under 36 characters sits on one line, while main at 1164 px keeps a 556 px row and at 1440 px an 800 px one. Nothing grows past 1440 px but main. Inside main the head and rows stop at 56 rem, left-aligned (no centred column); prose stops at 70ch; code and diffs take the whole pane. Main, top to bottom:

1. **Context bar**, 44 px, sticky, on the same line as the rail's wordmark: the trail on the left, the page's state or count and its one copyable command on the right.
2. **Page head**, not sticky: the title, the status line, a muted meta line, 24 px under it.
3. **Toolbar**, 40 px, sticky under the context bar on list and code pages, its controls ending where the rows end.
4. **Content**: rows under sticky group headers, a document of regions 32 px apart, or code.

The sticky stack is at most 84 px on a desktop (context bar and toolbar). On a phone a decision's choice bar is fixed above the bottom bar (about 148 px with the top bar when its consequence lines wrap), and main pads its foot so the page's end is never under it.

**Below 1120 px** there is no rail column and no inspector column. The project's sections become a **section row** under the head (one line of text tabs that scrolls sideways inside itself), and the inspector's blocks render **inline** in one slot after the head: open on a subject's page (ask, answer, decision, proposal, commit, ledger, env), a disclosure on a list's page whose summary keeps one fact in sight (the project's posture, Today's budget sentence). Selection is off: a row's whole width is its link.

**Spacing**, on a 4 px base (4, 8, 12, 16, 24, 32): rows 10 px top and bottom, group headers 32 px, fact blocks 12 px apart inside with a hairline between, 24 px under a page head, 32 px between regions. More space above a heading than below it.

Phone width (360 px) is a first-class layout: nothing scrolls sideways. Long commands break between words (a URL longer than the line breaks anywhere), paths, SHAs and trailers wrap anywhere, and code scrolls sideways inside its own box, never wrapping.

### Named Rules

**The One Ground Rule.** Every pane sits on the paper. A pane is parted by a hairline, never by a fill, a radius, a shadow or a gap.

**The Facts Beside Rule.** A page's typed facts are its inspector's, rendered with main in one pass; below the shell's width they are the same blocks, inline after the head.

## Elevation & Depth

Flat. No shadows on the page and no pane above another; depth is hairlines and the field surface. Overlays (dialogs, sheets, menus, popovers, tooltips) are the only raised layers, on the popover colour with a hairline ring and no soft shadow. Sheets slide in 200 ms; nothing else moves on the z axis.

## Shapes

Square. The radius is 2 px (`--radius: 0.125rem`), and shadcn's base-lyra components square most corners. Borders are one-pixel hairlines; the refusal block's 2 px top rule is the one coloured line, and the current tab's 2 px ink underline the one heavy one. An empty state's border is dashed (an unfilled field), and so is the rule that parts disclosed agents from credit. Marks are lucide icons at 16 px (14 px in dense places), stroke 1.75, one family.

## Components

### Rail (`Rail`)

- **Character:** where you are, always in the same place.
- **Shape:** the wordmark row (44 px, linking `/`, the landing); the site's sections, each a 32 px row of a 16 px mark and its word (Home, Asks at `/asks`, Today with the count of decisions waiting for a signed-in decider, Docs, For agents); "Projects" over one 32 px row per project, its posture's mark and one short word at the row's end (the same short form the project's head uses, from `posture-label.ts`; "Sealed" in the rail where the head says "Open with sealed evidence" is the thing to fix, not a second form); the current project's sections indented under it (Asks with its open count, Code, Landings, Refs, Policy, Ledger, Env shape); "All projects" opening the switcher after the first eight; the session (handle or Sign in) and a Keys button pinned at the foot.
- **Current item:** the surface fill, ink at 600, `aria-current`. Never a coloured bar or an accent.
- **Code form:** a route that fills the rail's slot (`staticData.rail`: the tree on tree, blob and why; the changed files on a commit and a finish) folds the site's sections and projects into a Menu button on the wordmark row and the project's sections into a one-line disclosure, and the slot fills the rest.

### Top bar and bottom bar

- **Top bar** (below 1120 px): on a tablet, 48 px, Menu, the wordmark, the current project as a switcher, the session; on a phone, 44 px, Back to the page above on a subject page (else the wordmark) and the project's switcher.
- **Bottom bar** (phones): fixed, 56 px plus the safe area, `<nav aria-label="Sections">`, five items each a mark over its 13 px word: Home, Asks, Today, Projects (the switcher as a full-height sheet), More (Docs, For agents, the project's sections, Keys, the session). The current item is ink at 600 with a 2 px ink rule on its top edge.

### Context bar, page head and toolbar

- **Context bar:** the breadcrumb (project / section / subject, ids in mono, each a link but the last; on a phone only the page's own crumb), and at the right the subject's compact state (mark and lead word) or a list's count ("17 open asks, 3 open to take"), and the page's primary command as a copy button.
- **Page head:** the title; the status line; the meta line (kind · asker · claimant · pushed `2 h ago`, and on an answer or a commit `3 files · +42 −7` at its end, the stat in the diff family at 13 px tabular, linking the diff). A project home's head is its name, its posture from its own ledger and its open count, the README's first sentence as a lede, and under it **the one rule sentence**: a 14 px muted line built only from typed facts ("Gate: 7 stages · deciders set for 3 paths · 7 sealed checks in 2 areas · last landed 2 d ago"), the ledger linked from it. It is the one place the project's own pages state how a change lands; the fact blocks beside them carry the gate, the deciders and what is held back as facts, never the posture again.
- **Toolbar:** filters as text tabs with their counts in label type, the current one ink at 600 with a 2 px ink underline (the one current-tab style of the whole web); view toggles (Unified | Split, Code | Why) as segmented text; on a phone the strip scrolls sideways and fades its last 2 rem.

### Inspector (`Workspace`'s facts) and fact blocks (`facts.tsx`)

- **Character:** the typed facts of the thing in hand, never a repeat of the page's prose.
- **Shape:** a 44 px heading row naming what it describes ("Start here", "Selected ask", "This ask", "This answer", "How a change lands here", "This landing", "This file", "This decision"), announced politely when it changes; then fact blocks, each a label over its content, 16 px padding, hairlines between, no box inside. A new subject settles in over 120 ms with no slide.
- **Blocks:** State (the status line again, then the next command, numbered 1), Take it (who may take it, then clone, claim and check, numbered), Claim (the claimant from the event fold, the last push; never a deadline), Gate (the seven stages; on an answer, a vertical strip with the current stage), Posture (the platform's label, a gloss, a link to the ledger; on a list page only, as the disclosure's one fact below the shell), Held back (one sealed line per area), Family (the vertical fan), Territory and check, Credit, Provenance (one label over one shortened mono value per entry, the copy action at the line's end; a time is not copyable; the same label-over-content shape as every other block, never a key and value grid), Decision, Diff stats (files, `+n −m`, then territory, tests and other), This file, Where it was read, Start here. An answer's rounds are a region in main (see Outcome), not a block. Once the platform signs its landings (ADR 0037), Provenance gains one entry, "Signature", naming the platform's key.
- **Values:** code values are mono and wrap anywhere; a long SHA or root is shortened (`7fbe4b2`, `sha256:7fbe4b…`) with its whole value in its title and on copy.
- **Commands:** a command line in the inspector takes the bleed form: to the pane's edges, a hairline above and below, no side border, an icon-only 28 px Copy at the right, and each wrapped line hanging 2ch (6ch stays in main, where there is room). At 22 rem that is about 36 characters a line.

### Row (`Row`, `AskRow`) and row group (`RowGroup`)

- **Character:** one anatomy for every list (asks, decisions, landings, commits, refs, forks, credits, rounds, history).
- **Shape:** 64 px (66 px measured, with its hairlines; one-line rows 40 px), two lines: a 20 px mark column, the mark in its state's colour; line 1 the want or subject at 16 px 500, one line, ellipsised, the link (never the id); line 2 metadata at 14 px muted, parted by ` · ` (kind, territory and id in mono, claimant, "round 2" once a round exists, "mentored by okonkwo" on an ask held for newcomers), a value that means nothing left out; at the right the state word in ink at 500 (red for Refused, green for Landed, as the Mark Carries Rule says) over its time; then the row's action. The time slot is filled on every row, 13 px tabular muted: the last push, else the last round, else the ask's opening, so a list scans by recency with no sort control. On a phone the state word leads line 2 and the right column hides. Below `tablet` the want may take two lines, since it is the one line that says what done means, and the row grows to about 88 px; from `tablet` it is one line.
- **States:** hover is the surface at half strength; selected (from 1120 px) is the surface fill and the want at 600, never a coloured edge; a selected row under the pointer is the pressed surface; focus is the 2 px ink outline inside the row. A click on the want navigates; elsewhere on the row it selects and fills the inspector. An ask's standing is read in this order: held for newcomers first ("Held for newcomers", wherever the ask is listed and whoever reads it), then open to take, then "Not open to you" only for a viewer the policy refuses with no reserve on the ask. One ask has one state word on every page.
- **Group header:** 32 px, sticky under the toolbar, paper fill, a hairline below: the group's name at 600 as a link, its facts (a project's posture, once per group, never per row; it may arrive after the rows without moving them), its counts at the end in label type ("7 open · 6 to take").
- **Data:** every `data-*` a list carries sits on the row's `<li>` (`data-ask`, `data-takeable`, `data-project`, `data-decision`, `data-soon`, `data-entry`, `data-fork`), and `data-list-key` on its link for `j` and `k`.

### Copy action (`CopyAction`, `CommandChip`) and command line (`CommandLine`)

- **Copy action:** a 32 px ghost button at a row's end, named for what it copies ("Copy claim command"), its command always in the DOM as text (`<code class="sr-only">`), never only a clipboard payload or a `data-` value. After a copy it shows a check and says "Copied" for 2 s in a polite live region.
- **Command chip:** the command shown whole, small, at the end of a status line; pressing it copies it.
- **Command line:** a field-surface box with a hairline border that hugs its command; a muted `$` that selection skips; the command in mono at terminal leading, broken only between words, each of its own lines hanging 6ch so a wrapped line reads as one line going on (a line too short to wrap hangs less, so its box hugging it never breaks a word; `e2e/command-line.e2e.ts` holds it); a ghost Copy button (its word hidden in a narrow column). A numbered command shows its digit before the `$` while the single keys are on, and "Copy (1)" in its title. In the inspector the box takes the bleed form (above): pane-wide, hairlines top and bottom, a 28 px icon-only Copy, a 2ch hang. A command is always shown whole; it never ellipsises.

### Status line (`StatusLine`) and state badge (`StateBadge`)

- **Status line:** one sentence, the same under a title, in the State block and (compact) in the context bar: the mark, the lead word in its role at 600, the rest in ink, then whose move in muted, then the next command as a chip. "Open to take", "Claimed by tamsin, no answer pushed yet · tamsin's move", "Checking at the checks stage · the platform's move", "Refused at Shape: OutOfScope", "Waiting on decision dec-000001 · a decider's move", "Waiting for 4 of 6 children to land · the family's move", "Landed as 9b1c3e5" (the SHA links the commit). A decision whose path needs more than one decider (ADR 0034, after the window) reads its count in the same sentence: "Waiting on decision dec-000001 · 1 of 2 deciders have accepted · a decider's move"; a count of deciders is a rule, never a score. A refusal's lead and tag come from `headline`, never a paraphrase. `data-tone` and `data-mark` carry it. The status line keeps the coloured lead word on every page; the row's word is ink (the Mark Carries Rule).
- **State badge:** the one way a state shows as a word: its mark, then its word in the role, at the size of its line. No pill, no fill, no box. Posture, stages, an ask's standing and a decision's default all draw through it; `data-mark` (and `data-posture` on a posture's label) carry it.

### Marks (`marks.tsx`)

Lucide, one family, the mark `aria-hidden` and its word beside it: check (landed, passed), a filled dot (checking, now), hourglass (waiting, an expiry), octagon X (refused, final), turn-back arrow in ochre (a retryable refusal), hollow circle (open, not yet), dashed circle (claimed), dash (not needed), lock (sealed), shield (a decision's default), an ink X (a failure that is not a refusal, such as a failed draft). Same mark, same meaning, on every page.

### The family fan (`FamilyStrip`, `FamilyTree`)

- **Character:** a split ask's siblings, side by side; never a ladder, never a sentence of ids.
- **Row form:** the parent row's third line: one node per stored child, its mark and its short name in mono, joined by a hairline bus, an arrow to the delete child's node ("delete waits for 4", then open, then landed), "n of N landed" at the right, and a toggle ("Show 6 children") that lists the children as indented rows, each open child with its claim command. Collapsed on the front page, expanded on the project home. On a phone the strip shows marks only.
- **Vertical form:** in the inspector's Family block and at the top of a member's page below the shell: the parent, the children on a left bus, then the delete child, the member being read at 600 on the surface.
- **The stamp:** a child that lands while the page is open settles its mark once, and the count changes with no motion of its own.

### Outcome (`OutcomeView`), stage strip (`StageStrip`) and refusal (`RefusalView`)

- **Outcome:** an answer's status line at Title size, the stamp on Landed; a refusal adds `RefusalView` below. `data-outcome` and `data-state` carry it.
- **Rounds:** every push the gate checked is a round, numbered from 1, and a verdict is read only against its round. On an answer with more than one round the first region in main is **Rounds**: one 40 px `Row` per round ("Round 2 of 3" · the head in mono · the state word and its age at the right), the page's round selected, newest first; the round read is in the address (`?head=`). No diff between rounds of an unlanded answer: that is the decider's view.
- **Waiting:** a waiting answer's main pane is not left to the inspector. Under the strip it says the one sentence a contributor needs, from the typed state: "Nothing for you to run. Pushing again starts round 3; this verdict stays as round 2." or "Nothing for you to run. A decider has until Thu 14:00." Never a spinner, never a paraphrase of the status line.
- **Landed:** the landing is told as a sentence before it is shown as a hash. The Landing region leads with one `StatusLine` at Title size ("Landed as 9b1c3e5 · asked by ines-v · answered by bram · 2 d ago", the SHA a link), then the credit trailers under "Credit" at Title weight, then the held-back lines with each root shortened (`sha256:7fbe4b…`, the whole value in `title` and on copy; the `Held-back:` trailer itself stays verbatim), and "The landing commit" as the region's onward link, not underlined text at the foot. The page's job is to credit the people; the hashes are its evidence, under them.
- **Stage strip:** the gate's results row, seven ruled cells in cost order (Parse, Shape, Merge, Cheap, Checks, Held-back, Decider), each a mark, its label and a 13 px state word: passed, now, refused, not yet, not needed (a stage the answer never needed, such as no decision). The current cell is on the surface with `aria-current="step"`. Four cells a row on a phone. `data-stage` and `data-state` on each cell.
- **Refusal:** a 2 px refused top rule, then `headline(refusals)` in mono red with an octagon mark, then one row per refusal parted by hairlines: its `explain` lines verbatim (indentation kept, the tag in red), then its `next` as a command line. A retryable refusal's mark is the ochre turn-back arrow. `data-refusal` and `data-retryable` carry it. The web never rewords a refusal. On a finish or a Waiver diff a refusal sits under the line its `at` names, as an annotation.

### Credit trailers (`CreditTrailers`, `CompactCredit`) and held-back lines

- **Credit:** a "Credit" label over one mono line per trailer, `Role: handle`, in `CreditRole`'s order (`Asked-by` first), handles linked; below a dashed rule, "Agents used, disclosed and not credit" and the muted `Assisted-by:` lines. On the Landed page the label is at Title weight, as "Gate" and "Lanes" are; in the inspector it is a fact label. The compact form reads "Asked by ines-v · answered by bram" on landing rows and in the project's recent landings, and never names an agent.
- **Held back:** one sealed-violet mono line with a lock, `Held-back: export 7/7 @ sha256:…; parser 4/4 @ sha256:…`; on an answer's page one line per area, each root shortened with the whole in `title` and on copy. The area and its count, never a check's name.

### Posture badge (`PostureBadge`)

The platform's own label, never rewritten, through the state badge: a lock mark and the word in sealed violet for postures that keep something sealed, an open lock in ink for Open, muted for Source available. Said once per page: in a list's group heading, in the rail (one short word) and in the project's head; never per row, and never in a fact block on the project's own pages, where the head has said it. The front page's Projects block and the project's How a change lands block carry counts and the gate, not the posture. `data-posture` carries the literal.

### Decisions, Today and the finish

- **Today:** the budget as one sentence ("Decisions: 2 taken, 3 left today. Finishes are counted apart: none taken."), then sections under sticky headers: Due today, Within your budget, Waits for tomorrow (a count, as a sentence), Newcomers to welcome, Landed without a decision. A decision's row reads its subject as a sentence, then project · kind · id, then its expiry over its default; a decision that needs more than one decider (ADR 0034, after the window) shows "1 of 2" under its default. On a phone a row opens in place. Newcomers to welcome will carry a one-tap "Vouch" choice (ADR 0036, after the window) whose consequence reads "adds a line to the vouch file and lands it with you as Decided-by"; it is a decider's choice, so it is one of the web's permitted writes.
- **Choices:** one tap each, no confirm. Ink buttons, the default the outline button with "default" beside its name; 36 px in a row from 640 px, 44 px in a two-column grid on a phone. Under each, a 13 px muted consequence line written from what the platform does ("Accept: opens the ask and lands it with you as Decided-by"; where it does nothing more, it says so). After a choice the record (by, choice, when, note) replaces the buttons, landed green only for a choice that took effect.
- **Finish:** the code browser's layout: the changed files in the rail with status letters, `+n −m` and a local read mark; the diff in main with sticky file headers and a "Mark read" button (the word is "read", kept in this browser only); the want, verdict, choices and the three numbered finish commands in the inspector from 1440 px, or in a sticky bar at main's foot below it.
- **Evidence:** typed by subject, labels in sentence case; never a value the platform did not send.

### Code browser (tree, blob, why, landings, commit)

- **Character:** a full-viewport app inside the shell.
- **Rail:** the ref line (main, a tag or a SHA, as a switcher), a "Filter files" field, and the tree (`@pierre/trees`): Public Sans 14 px, compact, monochrome icons, single-child folders flattened, sticky folders, the current path expanded and in view, a flattened path's directories in muted and its file name in ink; on a commit, every changed file open with its status letter and `+n −m`. A tree click moves with the router and the tree stays mounted across tree, blob and why.
- **Main:** a sticky file header (the path as a trail with copy, its directories in muted and the file name in ink, so the name reads first; "N lines · size · language" from 48 rem, which yields to the inspector's own line from 1440 px; the Code | Why toggle; Raw, Permalink, Copy), then the code at Pierre's metrics, scrolling in its own box. The server sends the file or diff as plain numbered text at the same metrics, so the highlighting lands in place.
- **Why:** consecutive lines from one landing form one group under a band that reads ask and answer first, SHA second ("format-ordinal · answered by bram · 9b1c3e5 · 2 d ago"), with "why, one step back". No credit count and no age colour.
- **Landings:** rows under sticky day headers: the subject, the ask answered or opened, the compact credit and a sealed "held back" word when the landing carries `Held-back:`, the short SHA over the age; filters All · Answers · Ask openings; the pager stays.
- **Commit:** the subject as Title, the landing's status line, the body as prose, git's line ("authored by … · committed by the platform · parent …"), then the diff in a pane that sticks under the toolbar and only then scrolls. Unified | Split (split from 48 rem), Collapse all / Unfold all. Unified diffs mark changes with `+` and `-`; split diffs with bars.
- **Missing path:** a soft landing on the nearest folder, with the refusal's own text above it.

### Ledger, env shape, policy and refs

- **Ledger:** the head sentence carries the facts ("Open with sealed evidence. export: 7 sealed checks by 3 people; parser: 4 sealed checks by 3 people."); layers as rows (name in sealed-violet mono, readers, writers, disclosure, reason), sealed areas as sealed-violet titles with root and admission, history as typed one-line rows, newest first. No path, check name or file name. Once the ledger rides with the clone as a note on main (ADR 0038, after the window), the head names the ref it is fetched from, as the verdict notes are.
- **Env shape:** the caption "env shape: varlock's `.env.schema` format", linked to varlock; items as definition rows, sensitive first: the key in mono, the sealed lock and "sensitive", "set by ines-v" or "not set", type, required, proxy hosts with paths, a hairline-bordered "Deprecated". Never a value or the placeholder an answer sees.
- **Policy:** deciders by path ("2 of 3 deciders for `src/**`" once a path carries a threshold, ADR 0034), vouching as one line per vouch with its reason and the landing it followed when the line carries them ("vouched by ines-v, for 9b1c3e5 (format-ordinal)"; ADR 0036; never a count of vouches), limits in tabular figures, agents, and one line per layer linking the ledger; the commands that change it, numbered, each flag on its own line. A denouncement is the line it is, never a red label beside a name.
- **Refs:** main ("moves only by a landing"), tags, and claim forks as one-line rows with their claim's state word.

### Empty, pending and error states

- **Empty (`EmptyState`):** a dashed hairline block where the rows would be: one sentence saying what is empty, then the command that changes it or a link onward. Never a dead end.
- **Pending:** the shell, rail and context bar stay; after 300 ms main shows its title over rows of skeleton (64 px, two outlined bars each, no shimmer), and fact blocks keep their heads with bars for values.
- **Not found:** in the shell, the trail up to what exists, a title saying what was asked for ("No such ask"), `RefusalView` verbatim, then one or two onward links.
- **Unreachable:** an ink block with a muted unplugged mark: "The platform did not answer.", "Try again in a minute; nothing was changed. Git and the CLI reach it directly." and Reload. Never red.

### Buttons and fields

- **Shape:** square, UI type (14 px, 500).
- **Primary:** ink on paper, 32 px; hover lightens the ink.
- **Ghost:** no fill until hover, then the surface; Copy and secondary actions.
- **Outline:** paper with a control border; the default choice.
- **Fields:** a 3:1 control border on paper, 32 px (36 px and 16 px text on a phone); a disabled Propose says why ("Write the want first").
- **Focus:** the global 2 px ink outline, 2 px out, on every control; inside a row, inside the row's box.

### Navigation and keys

- **Links:** every link between pages is the router's (`AppLink`), preloading on hover or focus, so moving never reloads the document; the page being read is `aria-current="page"`. Links in running text are ink, underlined in the hairline colour, ink on hover; links in rows and the rail are not underlined. A skip link to `#main` is the first tab stop.
- **Keys:** `?` opens the keys dialog with the switch "Single-key shortcuts: On / Off" (kept in this browser, on by default); each key in the dialog is a `kbd`: label type, a hairline border, the 2 px radius, 4 px of side padding, on the paper; `j`/`k` move through a list's rows (and from 1120 px select them), Enter opens; `J`/`K` move between files on code, commit and finish pages; `1`–`9` copy the page's numbered commands, the inspector's first; Escape closes a sheet or clears the selection. No key acts in a field, a combobox or the tree's filter. Every key has a pointer twin.
- **Selection:** in the address (`?ask=`, `?decision=`), replaced in history, so a selected row and its facts render on the server and can be shared.

### The landing

- **Where:** `/`, the one page outside the shell (its route's `staticData: { shell: "bare" }`); the front page is `/asks`. A reader who carries a session is sent to `/home` before it is drawn.
- **Shape:** one centred column on the paper ground, parted by hairlines like any page. Its first action is the link to the open asks; its second, the install line as a command to copy. Its evidence is real output, set in mono as a terminal prints it: a refusal transcript from `git push`, not an illustration of one.
- **Rules:** every rule on this page holds there too. No cards, tiles, big numbers, gradients, glows, kickers or page-load choreography; colour only for state, beside its word; nothing below 13 px; no word from the banned list below.

### The platform's own pages

Sign-in (the MCP consent), sign-up, the Google handle page, the problem page and the platform's `/` load nothing (no script, no web font), so they carry the tokens as literals in their inline style: paper and ink for both schemes, rule, muted, the 3:1 control border, refused only for a refusal, an ochre-marked "Warning" line for the loopback case, the ink focus outline; `color-scheme: light dark`; the system sans at 16 px; one 26 rem column (44 rem for the `/` document), 48 px from the top, square 44 px inputs and buttons. On sign-in the consent comes first, as its own ruled block.

### shadcn

shadcn 4.21.2, style `base-lyra` on Base UI, in `src/components/ui/` (generated, restyled to the tokens). The pages use its button, badge, table, textarea, tooltip, dialog and sheet, select, combobox, popover and skeleton. Overlays load after hydration in their own chunk.

### Decided, not yet drawn

Each rule below is decided in this document (ADR 0039) and not yet in the code; the build issues are cut from this list, and an item leaves it when its file changes.

- "mentored by" in an ask row's line 2: the row reads an `AskListing`, which carries no mentor, so it waits on the listing gaining one (a contract change in `packages/protocol`): `apps/web/src/features/shared/row.tsx`. Decided, not yet drawn.
- The head meta line's `files · +n −m` on an answer's subject: the answer page reads an `AnswerView`, which carries no diff stats, so it waits on the view gaining them (a contract change in `packages/protocol`); the commit's head has it. `apps/web/src/features/answer/answer-page.tsx`. Decided, not yet drawn.

## Do's and Don'ts

### Do:

- **Do** render every page through one `Workspace`, with its typed facts as fact blocks, and put a page's facts in the inspector rather than in its prose.
- **Do** draw rows, status lines, the fan, refusals, credit, held-back lines, posture, outcomes and stages with the shared components; change the component, not a page's copy of it.
- **Do** show the command for every action, its text in the DOM, through `CommandLine` or `CopyAction`, and number a page's main commands.
- **Do** carry every state as a mark, then a word, then a colour, and key tests and styles on the `data-*` attribute that names it.
- **Do** link between pages with `AppLink`, and read a list's rows in its loader so they arrive in the HTML.
- **Do** keep text at 4.5:1, controls and borders at 3:1, every control reachable and visibly focused by keyboard, and nothing below 13 px.
- **Do** check every page at 1440, 1164 and 390 px in both schemes, and at 360 px with no horizontal scroll.
- **Do** honour `prefers-reduced-motion`: every animation and transition drops to an instant change.

### Don't:

- **Don't** float a pane, round it, shadow it, or give it another ground; part panes with hairlines.
- **Don't** put cards in a grid, stat tiles, a big number over a small label, pill badges, tinted state squares, avatar stacks, sparklines or coloured file icons on any page.
- **Don't** colour a row's state word (Refused and Landed apart), say a posture twice on one page, or ellipsise a command.
- **Don't** reword a refusal or compute your own explanation of one; render `explain` and `headline`.
- **Don't** show a score, a rank, a count of a person's landings or credits, or a leaderboard.
- **Don't** use red for anything but a refusal, violet for anything but sealed things, green for anything but on main, or colour without a word; a diff uses its own teal and rose.
- **Don't** use monospace for prose, labels, buttons, headings or commit bodies.
- **Don't** show an env value, or the placeholder an answer sees, anywhere.
- **Don't** add a form for something git or the CLI does (claim, push, check, land, env set), a theme toggle, or a second component kit.
- **Don't** put on screen the words review, approve, PR, pull request, issue (for an ask), merge (for a landing), lease, reputation, inbox, queue, dashboard, explore or trending.
- **Don't** use kickers, uppercase tracked labels, section numerals, shimmer, spinners in content, page-load choreography or toasts as the only feedback.
