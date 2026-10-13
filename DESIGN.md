---
name: Myr web
description: Four shells on warm paper. What state a change is in, whose move it is, and the command that runs next.
colors:
  paper: "#f8f7f4"
  paper-dark: "#0a0a0a"
  ink: "oklch(0.2417 0.0298 269.8827)"
  ink-dark: "oklch(0.9702 0 0)"
  surface: "oklch(0.9251 0.0071 88.645)"
  surface-dark: "oklch(0.2178 0 0)"
  surface-2: "oklch(0.91 0.0071 88.645)"
  surface-2-dark: "oklch(0.245 0 0)"
  card: "oklch(1 0 0)"
  card-dark: "oklch(0.1822 0 0)"
  popover: "oklch(1 0 0)"
  popover-dark: "oklch(0.1822 0 0)"
  primary: "oklch(0.56 0.0309 154.9039)"
  primary-dark: "oklch(0.6333 0.0309 154.9039)"
  secondary: "oklch(0.8596 0.0291 119.9919)"
  secondary-dark: "oklch(0.2178 0 0)"
  accent: "oklch(0.8242 0.0221 136.6092)"
  accent-dark: "oklch(0.3709 0.0248 153.9823)"
  muted: "oklch(0.5 0.0234 264.3637)"
  muted-dark: "oklch(0.7058 0 0)"
  rule: "oklch(0.87 0.0071 88.645)"
  rule-dark: "oklch(0.285 0 0)"
  rule-strong: "oklch(0.2417 0.0298 269.8827)"
  rule-strong-dark: "oklch(0.9702 0 0)"
  input: "oklch(0.6 0.0234 264.3637)"
  input-dark: "oklch(0.52 0 0)"
  skeleton: "oklch(0.82 0.0071 88.645)"
  skeleton-dark: "oklch(0.36 0 0)"
  landed: "oklch(0.46 0.11 155)"
  landed-dark: "oklch(0.78 0.13 155)"
  checking: "oklch(0.47 0.1 238)"
  checking-dark: "oklch(0.76 0.11 238)"
  waiting: "oklch(0.46 0.1 120)"
  waiting-dark: "oklch(0.82 0.12 120)"
  refused: "oklch(0.49 0.1743 26.1433)"
  refused-dark: "oklch(0.68 0.2078 25.3313)"
  sealed: "oklch(0.46 0.13 305)"
  sealed-dark: "oklch(0.76 0.11 305)"
  syntax-string: "oklch(0.42 0.035 200)"
  syntax-string-dark: "oklch(0.8 0.035 200)"
  syntax-constant: "oklch(0.42 0.035 340)"
  syntax-constant-dark: "oklch(0.82 0.035 340)"
  syntax-comment: "oklch(0.42 0.012 258)"
  diff-add-sign: "oklch(0.51 0.09 195)"
  diff-add-sign-dark: "oklch(0.74 0.08 195)"
  diff-del-sign: "oklch(0.51 0.12 345)"
  diff-del-sign-dark: "oklch(0.72 0.1 345)"
typography:
  headline:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: "1.6rem"
    letterSpacing: "-0.01em"
  want:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: "1.5rem"
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.55rem"
  ui:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.3rem"
  label:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: "1.15rem"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    fontFeature: "\"calt\" 0, \"liga\" 0"
  terminal:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  code:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "20px"
    fontFeature: "\"calt\" 0, \"liga\" 0"
  footer-wordmark:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 600
    letterSpacing: "-0.04em"
    lineHeight: "0.9"
rounded:
  none: "0px"
  sm: "1px"
  md: "2px"
spacing:
  hairline: "1px"
  row-y: "10px"
  gutter-phone: "16px"
  gutter-tablet: "20px"
  gutter-site: "2rem"
  gutter-project: "1.75rem"
  region: "32px"
  container-site: "85rem"
  container-project: "100rem"
  container-focus: "25rem"
  column-about: "21.25rem"
  column-tree: "17.5rem"
  column-docs-nav: "15rem"
  column-docs-toc: "13.75rem"
  column-filters: "15rem"
  measure: "72ch"
  top-bar: "3.5rem"
  toolbar: "2.5rem"
  row-phone: "88px"
components:
  top-bar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    height: "56px"
  project-header:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
  project-tab:
    textColor: "{colors.muted}"
    typography: "{typography.ui}"
    height: "44px"
  project-tab-current:
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    height: "44px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  footer-wordmark:
    textColor: "{colors.ink}"
    typography: "{typography.footer-wordmark}"
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
  row-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.want}"
    height: "64px"
  row-group-header:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    height: "32px"
  command-line:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.terminal}"
    rounded: "{rounded.none}"
    padding: "4px 4px 4px 12px"
  copy-action:
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    size: "32px"
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.card}"
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.card}"
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.card}"
    rounded: "{rounded.none}"
    height: "44px"
---

# Design System: the web

The web's look, for anyone adding or changing a page. Tokens live in `apps/web/src/styles.css`. The pieces every page shares (the top bar, the footer, the project header, the row, the status line, the family fan, the fact blocks, the copy action, refusals, credit, posture, outcomes, stages, commands, marks, times, people, empty and pending states) live in `apps/web/src/features/shared/`. A page uses them rather than drawing its own. Pierre's code drawing is configured once, in `apps/web/src/features/code/pierre.ts`. Words follow `GLOSSARY.md` and `PRODUCT.md`.

The rules here are ADR 0041 (four shells, Overview first, no logomark, a plain sans), ADR 0042 (the theme preference), ADR 0043 (fork browsing) and the maintainer's overrides of 2026-10-12 (IBM Plex, the sage garden palette, the repeat button icon, the footer's wordmark, no fingernails, no eyebrows). Where the code has not caught up yet, this file is the target and `apps/web/test/design-rules.test.tsx` holds what it can.

## Overview

**Creative North Star: "Four shells on warm paper"**

The web serves four jobs, and each gets its own frame: a site that explains the platform and lists its projects, a project with one header and its tabs, a docs site, and a focused card for signing in. All four share the top bar's contents, so moving between them never reads as a different app. Every screen still answers three questions in this order: what state is it in, whose move is it, and what runs next. The answer to the last one is a command you can copy, shown once.

The pages are for operating, with one page that persuades: the landing at `/`, which compares the usual issue and pull-request flow with an ask landing through the gate, and leads to the open asks. Density is set by a maintainer clearing the inbox on a phone and a contributor reading a refusal beside a terminal: two-line rows (64 px), 14 px metadata, a 13 px floor. Colour means state, and always sits beside a word and a mark, so a page read in grayscale, by a screen reader or in a terminal says the same thing. In a list the colour sits on the mark and the word stays ink. The one colour that is not a state is the sage primary: the page's main action and the focus ring.

Rejected on purpose: the dashboard look (stat tiles, big numbers over small labels, a blue link colour, pill badges, avatar stacks, coloured file icons), its glossy cousin (dark glass, blur, glows, gradients), and the terminal costume (green on black, monospace for everything). Rejected too: a logomark of any kind (crest, gate, doorway); a display serif; a coloured strip on the edge of a card; an eyebrow over a headline; a filled pill or tinted square that carries a state without its word; shadows and glows; `outline: none`; text at 12 px and greys under 4.5:1; avatars and activity sparklines; a command box that ellipsises; a column of code blocks; and spinners and shimmer in content. Monospace appears only where the text is what a terminal prints or takes: commands, refusal transcripts, trailers, SHAs, paths, ids, env keys and code.

**Key Characteristics:**

- Four shells (site, project, docs, focus), each named by its route, with no global rail and no generic right rail.
- A project has one header and eight tabs, and opens on Overview.
- State is a mark, then a word, then a colour; red belongs to refusals, violet to sealed things, green to what is on main, olive to waiting, blue to checking. In a row the colour is the mark's; the word is ink, except Refused and Landed.
- Every action is a command to copy, shown once per screen. The only web controls that change anything are a maintainer's choices, proposing an ask (and asking the platform's agent to draft it), the theme preference, and signing in or out.
- Light and dark follow the system setting, or its opposite by the reader's choice on `/settings` (ADR 0042).
- Motion carries state, never decoration: transitions of 120 to 200 ms, and the landing's stamp.

## Colors

The maintainer's "sage garden": warm paper, navy ink, a sage primary, soft sage fills, and five state roles that never appear as decoration. Its values sit on the web's own token names, so no component changed its classes. Every state role measures at least 5:1 against paper, the field surface and the pressed surface, in both schemes; body ink measures 15.3:1 in light and 18.2:1 in dark. `apps/web/test/tokens.test.ts` holds every pair, and holds the tokens to the pasted palette (a token taken unchanged equals the pasted value; a nudged one differs from it in lightness alone).

**No orange, amber or brown anywhere**, state roles included: no colour above chroma 0.02 has a hue from 40 to 100 (`tokens.test.ts`, "spends no orange, amber or brown"). Under chroma 0.02 a hue reads as grey, so the warm paper (hue 91, chroma 0.004) is not orange.

### How the palette maps

| Pasted | Web token | Note |
| --- | --- | --- |
| `background` | `--background` (paper) | As hex, `#f8f7f4` and `#0a0a0a`: the `theme-color` metas and the manifest repeat it |
| `foreground` | `--foreground` (ink), `--rule-strong` | |
| `muted` | `--surface` (field surface) | shadcn's `bg-muted` still resolves to the surface |
| `border` | `--rule` (hairline) | Nudged 0.9251 to 0.87 in light: pasted, it equalled the surface, so a surface box's hairline vanished; now 1.19:1 on the surface and 1.38:1 on paper (1.21:1 and 1.38:1 in dark, as pasted) |
| `muted-foreground` | `--muted` | Nudged 0.551 to 0.5 in light, for 4.5:1 on the surfaces |
| `card`, `popover` | `--card`, `--popover` | White in light, 0.1822 in dark |
| `primary`, `ring` | `--primary`, `--ring` | Nudged 0.6333 to 0.56 in light, so white on it measures 4.58:1 |
| `secondary`, `accent` | `--secondary`, `--accent` | Soft sage fills for a secondary button and a menu's highlighted item |
| `destructive` | `--refused` (and `--destructive`, its alias) | Nudged 0.5624 to 0.49 in light and 0.6368 to 0.68 in dark, for 5:1 on the pressed surface |

Not taken from the paste: `--spacing` (it rescales every utility), `--font-serif` (no serif), its shadows (the web is flat), its sidebar and chart colours (no page draws a sidebar or a chart), and its 0.35rem radius (shapes stay square: the overrides moved colour and type into scope, not shape). New steps in the palette's own hues: `--surface-2`, `--input`, `--skeleton`.

### Primary

- **Navy Ink** (`--foreground`): text, page titles, the current tab's underline, links (links are ink, never blue).
- **Sage Primary** (`--primary`, `--ring`): the page's one main action (a primary button, a maintainer's non-default choice, a checked box) and the 2 px focus outline. Low in chroma (0.031), so it never reads as landed green (chroma 0.11); it is never a state and never decoration. The focus ring measures 4.3:1 on paper and 3.7:1 on the surface in light, 5.8:1 and 5.1:1 in dark.

### State roles

- **Landed Green** (`--landed`, hue 155): the change is on main. The landing's stamp and lead word, passed stages, a decision whose choice took effect.
- **Checking Blue** (`--checking`, hue 238): the gate is running a stage now, and the viewer's own selection (text selection and selected code lines, a tint of it over the paper). It sits 30° from the ink's blue cast (hue 270), so code drawn in ink never reads as a running stage.
- **Waiting Olive** (`--waiting`, hue 120): passed or paused, waiting on a person or another ask; a decision that expires within the day; the mark of a retryable refusal. It left the ochre band (hue 70) for olive, 35° from landed and far from checking and sealed. Waiting is never shown in the refused colour.
- **Refused Red** (`--refused`, hue 26): a refusal, its headline and each refusal's tag. shadcn's `destructive` maps here, so nothing destructive may be red unless it is a refusal.
- **Sealed Violet** (`--sealed`, hue 305): held-back checks, layers and sealed evidence; the `Held-back:` trailer, a posture that keeps something sealed, the ledger's layer and area headings, a sensitive env item's mark.

### Code and diffs

- **Syntax** (`--syntax-*`): one low-chroma theme drawn from the tokens and handed to Pierre as a CSS-variable theme. Keywords, functions and parameters are ink; strings lean grey-teal (hue 200) and constants grey-plum (hue 340, moved from olive 110, where waiting now lives); each at chroma 0.035 and at least 30° from every state hue; comments and punctuation are a step darker than muted in light and muted in dark. Each keeps 4.5:1 on the paper.
- **Diff tints** (`--diff-add-*`, `--diff-del-*`): additions teal, deletions rose, a family apart from landed green and refused red. The sign colour draws the `+` and `-`, the bars and a changed line's number (held to 4.5:1); a line's tint is that colour mixed into the paper (12% in light, 20% in dark, as Pierre mixes it); emphasis marks the changed words. The file tree's status letters use the same family (A teal, D rose, M and R muted).

### Neutral

- **Warm Paper** (`--background`): the ground of every page. Hex, because the two `theme-color` metas and the web app manifest repeat it from `features/shared/theme.ts`, and a test holds them equal.
- **Card White** (`--card`): the ground of a card, a plain bordered surface one step lighter than the paper in light (in dark, one step lighter than the paper and darker than the field surface).
- **Field Surface** (`--surface`): command lines, a hovered row, the current stage cell, a segmented control's current segment.
- **Pressed Surface** (`--surface-2`): one step past the field surface, for a selected thing under the pointer only. It measures 1.22:1 against paper in both schemes and every state role keeps at least 5:1 on it (the floor is refused at 5.12:1 in dark). Never a third step, never a zone.
- **Popover** (`--popover`): the one raised layer's ground (dialogs, sheets, menus, popovers, tooltips): white in light, 0.1822 in dark.
- **Muted Grey** (`--muted`, as `text-muted-foreground`): labels, metadata lines, stages not reached or not needed, the `$` of a command line, `Assisted-by` lines. At least 4.6:1 on every ground.
- **Hairline** (`--rule`): every border and rule, and the underline of links in running text. At least 1.15:1 on paper and on the field surface in both schemes, so a surface box's border shows.
- **Control Border** (`--input`): a form control's border at 3:1 on paper and on the surface (3.7:1 and 3.2:1 in light, 3.6:1 and 3.2:1 in dark).
- **Skeleton Stroke** (`--skeleton`): the outlined bars of a placeholder row or fact (1.6:1 in light, 1.8:1 in dark), with no fill.
- **Strong Rule** (`--rule-strong`, ink): the 2 px underline of the current tab or filter.

### Named Rules

**The Rubric Rule.** Red belongs to refusals. A destructive button, a transport failure or a deletion in a diff is never red.

**The Word First Rule.** No state is carried by colour alone: every coloured mark has a word beside it or in its row ("passed", "now", "refused", "not yet", "not needed"; "Waiting", "Landed", "Checking").

**The Mark Carries Rule.** In a row the colour belongs to the mark; the state word is ink at 500, except Refused (red) and Landed (green), so a list of waiting asks is not an olive stripe and the one actionable word, "Open to take", has the same weight as its neighbours. The status line and the state badge keep the coloured word: there it is said once, beside its sentence. (ADR 0039; its inspector width went with the inspector, this rule stays.)

**The No Fingernail Rule.** A card, row or panel is a plain bordered surface. No coloured strip, bar, notch or tab on any edge or corner, no `border-l-4`-style accent and no state-coloured top rule: the refusal block lost its red top rule for this. State lives in a word and a mark.

**The No Score Rule.** No colour, size or ordering ever ranks a person. Handles are links in ink; a record is never shown as a number.

## Typography

**UI Font:** IBM Plex Sans (variable, 100 to 700), from `@fontsource-variable/ibm-plex-sans`
**Mono Font:** IBM Plex Mono at 400, 500 and 600, from `@fontsource/ibm-plex-mono`, with contextual alternates and ligatures off (`=>` stays `=>`)

Both load from fontsource as latin and latin-ext only, declared in `styles.css` with fontsource's own unicode ranges (a page fetches the latin file alone unless it sets an accented letter). The two latin files (the variable sans and mono 400) are preloaded from the root route. No serif anywhere, and no serif token.

**Fallbacks that move nothing.** Until a face arrives (`font-display: swap`), text is drawn in a local face scaled to its metrics: Arial (or Liberation Sans, Arimo) for Plex Sans, Courier New (or Liberation Mono, Cousine) for Plex Mono. Measured in headless Chromium on 2026-10-12, with canvas `measureText` over a 240-character English sample at 1000 px against Liberation Sans and Liberation Mono:

| Face | Width over fallback (`size-adjust`) | Ascent | Descent | `ascent-override` | `descent-override` |
| --- | --- | --- | --- | --- | --- |
| IBM Plex Sans | 100.41% | 1.025 em | 0.275 em | 102.08% | 27.39% |
| IBM Plex Mono | 99.98% | 1.025 em | 0.275 em | 102.52% | 27.5% |

Each override is the face's metric over its `size-adjust`; the line gap is 0. The same method gave Public Sans's old 103.89%, so the numbers are comparable.

**Character:** Plex Sans is a grotesque with a typewriter's honesty: engineered, plain, and as readable at 14 px in a dense row as at a headline. Plex Mono is its sibling, so a command in a sentence sits on the same rhythm.

### Hierarchy

A fixed rem scale, ratio about 1.15 to 1.2; product type does not float with the viewport (the footer's wordmark is the one exception, below). Numbers that can change (counts, times, line numbers, `+n −m`) are tabular. **Nothing is set below 13 px**; `apps/web/test/type-floor.test.ts` refuses the old 12 px and 11 px sizes and any arbitrary size.

- **Headline** (`text-headline`, 600, 1.5rem/2rem, -0.015em, balanced): one page title, or a project's name in its header.
- **Title** (`text-title`, 600, 1.1875rem/1.6rem, -0.01em): a long ask's title, a region head, the answer's outcome hero, a README's headings.
- **Want** (`text-want`, 1rem/1.5rem): a row's first line at 500, and a want or brief in prose at 400.
- **Body** (`text-body`, 400, 1rem/1.55rem): prose, held to the measure.
- **UI** (`text-ui`, 400, 0.875rem/1.3rem; 500 for state words): row metadata, the top bar, tabs, values, buttons, toolbar controls. The most used size.
- **Label** (`text-label`, 500, 0.8125rem/1.15rem, sentence case, muted): fact block heads, field labels, group header counts, a consequence line under a choice. It follows what it labels or sits beside it, never above a heading as a kicker.
- **Mono** (`text-mono`, Plex Mono 400, 0.8125rem/1.25rem inline): ids, SHAs, paths, env keys. In transcripts it takes `leading-terminal` (1.5rem), and refusal transcripts hold to 96ch; in code and diffs it takes `leading-code` (20 px), Pierre's line.
- **Footer wordmark** (600, -0.04em, line height 0.9, upper case): see the footer below.

Form fields are 16 px below 640 px (so a phone does not zoom on focus) and 14 px from there.

### Named Rules

**The Code Is Mono Rule.** Monospace means "this is what git or a terminal prints or takes". Prose, labels, buttons, headings and commit bodies are never mono.

**The Thirteen Floor Rule.** The smallest text on any page is 13 px, and it is a label or mono, never a sentence a reader must act on.

**The Headline First Rule.** No small, upper-case or tracked line above an h1, h2 or h3. The headline comes first; a label, if one is needed, follows it as ordinary text. No component or class is named eyebrow, kicker or overline (`design-rules.test.tsx`).

## Layout

### Shells

Every route names exactly one shell in its `staticData` (`shell: "site" | "project" | "docs" | "focus"`), and the root draws the matching frame. The widths are tokens in `styles.css` (`@theme static`), never literals; `design-rules.test.tsx` holds this file's spacing values equal to them.

| Shell | Routes | Container | Header | Side columns |
| --- | --- | --- | --- | --- |
| `site` | `/`, `/explore`, `/asks`, `/install`, `/privacy`, `/terms` | centred, `--container-site` (1360 px), `--gutter-site` (32 px) | framed top bar | only the filters on `/asks` (`--column-filters`, 240 px), left of the list |
| `project` | `/:owner/:project/**`, `/inbox`, `/settings`, `/people/:handle` | fluid to `--container-project` (1600 px), `--gutter-project` (28 px) | full-bleed top bar, then the page header | only the about column on Overview (`--column-about`, 340 px) and the file tree on Code (`--column-tree`, 280 px) |
| `docs` | `/docs/**` | centred, `--container-site` (1360 px) | the site's top bar | nav tree `--column-docs-nav` (240 px), the article at `--measure` (72ch), "on this page" `--column-docs-toc` (220 px) |
| `focus` | sign-in, MCP consent, new project, new proposal | a centred card, `--container-focus` (400 px) | the wordmark only | none |

A shell sets its gutter once, on its frame, and every bar and page inside it reads it: 16 px on a phone, 20 px from `tablet`, and from `shell` (1120 px) `--gutter-site` in the site, the docs and a focused page, or `--gutter-project` in a project.

From `columns` (1100 px, `--breakpoint-columns`) a side column stands beside its main column; below it, every side column stacks under its main column. From `nav` (900 px, `--breakpoint-nav`) the top bar shows its links; below it they fold into a menu. Phone width (360 px) is a first-class layout: nothing scrolls sideways.

**The four rules (ADR 0041):**

- **No global left rail.** The project list moves to Explore and the account menu; a project's navigation is its tabs.
- **No generic right rail.** A side column exists only where it holds facts about what is on screen (a project's about column, a doc's headings), 220 to 340 px wide, and stacks under 1100 px. The asks board's filters are the one column that is not facts: they narrow the list beside them, and stand above it under 1100 px.
- **A command at most once per screen.** As content, a command sits in a popover, a single strip or a card. Never a column of code blocks.
- **Prose stops at 72 to 80ch.** Lists and tables run to the container; prose, a README and a doc's article stop at `--measure` (72ch).

### Inside a page

1. **Top bar**, sticky (below).
2. **Page header**: on a project, the project header and its tabs, sticky under the top bar; elsewhere the page's title and one line under it, not sticky. A page's facts follow its head inside the page; the only column beside a page is the about column on Overview or the file tree on Code (or, in the docs, the nav tree and "on this page").
3. **Toolbar**, 40 px, sticky under the header on list and code pages.
4. **Content**: rows under sticky group headers, a document of regions 32 px apart, cards in a grid where a page lists projects, or code.

**Spacing**, on a 4 px base (4, 8, 12, 16, 24, 32): rows 10 px top and bottom, group headers 32 px, fact blocks 12 px apart inside with a hairline between, 24 px under a page head, 32 px between regions. More space above a heading than below it.

Long commands break between words (a URL longer than the line breaks anywhere), paths, SHAs and trailers wrap anywhere, and code scrolls sideways inside its own box, never wrapping.

## Elevation & Depth

Flat. No shadows on the page; depth is hairlines, the card's white and the field surface. Overlays (dialogs, sheets, menus, popovers, tooltips) are the only raised layers, on the popover colour with a hairline ring and no soft shadow. Sheets slide in 200 ms; nothing else moves on the z axis.

## Shapes

Square. The radius is 2 px (`--radius: 0.125rem`), and shadcn's base-lyra components square most corners. Borders are one-pixel hairlines; the current tab's 2 px ink underline is the one heavy line, and no edge of a card carries a colour. An empty state's border is dashed (an unfilled field), and so is the rule that parts disclosed agents from credit. Marks are lucide icons at 16 px (14 px in dense places), stroke 1.75, one family.

**No logomark.** The wordmark is the product's name set in the UI sans. Where a file must stand for the site (the favicon, `apple-touch-icon.png`, the manifest's icons), it is the repeat button emoji (U+1F501) drawn as text in `public/icons/icon.svg` on the warm paper, through an SVG filter that maps its greys to the ink, the sage primary and white, so no platform's own colour shows (Noto's is orange). The rasters are that one drawing, rendered in headless Chromium at 1024 px and downscaled with Lanczos: 512 and 192 for the manifest, 180 for iOS, and 16, 32 and 48 in `favicon.ico`. The emoji fills 52% of the square, inside a maskable icon's safe circle. `apps/web/test/icons.test.ts` holds the text, the paper and the sizes.

## Components

### Top bar

- **Character:** the same contents in every shell: the wordmark (linking `/`), Explore, Asks, Docs, Install, search, Keys (a keyboard icon that opens the keys dialog, the `?` key's pointer twin) and the account (handle and inbox count, or Sign in). Framed in the site and docs shells (inside the container, a hairline under it), full-bleed in the project shell; the focus shell shows the wordmark alone.
- **Current item:** ink at 500 with `aria-current="page"`; the others muted. Never a coloured bar.
- **Below 900 px:** the links and Keys fold into a menu (a sheet), the wordmark and the account stay.

### Footer

- **Where:** the site and docs shells; the project and focus shells have none.
- **Shape:** a hairline above, a row of plain links (Docs, Install, Privacy, Terms), then **the brand's domain in upper case** across the container's full width as one line of display text in the UI sans: read from `@repo/brand` (`Brand.domain`), upper-cased with CSS, never typed (`brand:check` fails on the name outside `packages/brand`). It is sized to the container with container query units so the line fills the width without wrapping, at 600 with -0.04em tracking and a 0.9 line, in ink. It is the one type that scales with its box. No mark beside it.

### Project header and tabs

- **Header:** the name (`owner / project`, the owner muted, both in the UI sans at Headline size), the posture (`PostureBadge`), the description (the README's first sentence), a facts row in UI type, muted (open asks, last landing, latest tag, licence if known, deciders), and three actions at the right: **Watch** (a popover: what to follow, plus `myr watch --project`), **Clone** (a popover: the `git clone` URL, `myr claim <ask> --project`, and that forks come with a claim), **Contribute** (a popover: take an ask, propose an ask, read the policy). It never changes between tabs.
- **Tabs:** Overview · Code · Asks · Landings · Proposals · People · Policy · Visibility, each a text tab with its count in label type; the current one ink at 500 with a 2 px ink underline (the one current-tab style of the whole web), the rest muted. The header and tabs stick under the top bar together; on a phone the tabs scroll sideways inside their own strip.
- **Overview** (the default tab): open asks, recent landings and the README in the main column; the about column (`--column-about`) with clone, how a change lands (the seven stages), who decides, a visibility summary and languages.
- **Code:** under the header, a Files/Commits toggle, the ref switcher (`main`, tags, and answers in forks, ADR 0043), the HEAD commit bar, go to file, and the file tree in `--column-tree`.
- **Visibility:** posture, layers, held-back checks, the environment (once "Env shape") and the ledger, one tab.

### Cards

- **Shape:** a plain bordered surface: `--card` ground, a hairline border all round, the 2 px radius, 16 px padding, no shadow. Nothing on one edge (the No Fingernail Rule). Used where a page lists things that are each a small document (Explore's projects, Install's channels, the landing's comparison panels), never for a list of rows.

### Row (`Row`, `AskRow`) and row group (`RowGroup`)

- **Character:** one anatomy for every list (asks, decisions, landings, commits, refs, forks, credits, rounds, history).
- **Shape:** 64 px (one-line rows 40 px), two lines: a 20 px mark column, the mark in its state's colour; line 1 the want or subject at 16 px 500, one line, ellipsised, the link (never the id); line 2 metadata at 14 px muted, parted by ` · ` (kind, territory and id in mono, claimant, "round 2" once a round exists); at the right the state word in ink at 500 (red for Refused, green for Landed, as the Mark Carries Rule says) over its time; then the row's action. The time slot is filled on every row, 13 px tabular muted: the last push, else the last round, else the ask's opening. On a phone the state word leads line 2 and the right column hides, and the want may take two lines (about 88 px).
- **States:** hover is the surface at half strength; focus is the 2 px sage outline inside the row; never a coloured edge. A click on the want navigates. An ask's standing is read in this order: held for newcomers first ("Held for newcomers"), then open to take, then "Not open to you" only for a viewer the policy refuses with no reserve on the ask. One ask has one state word on every page.
- **Group header:** 32 px, sticky under the toolbar, paper fill, a hairline below: the group's name at 600 as a link, its facts (a project's posture, once per group, never per row), its counts at the end in label type ("7 open · 6 to take").
- **Data:** every `data-*` a list carries sits on the row's `<li>` (`data-ask`, `data-takeable`, `data-project`, `data-decision`, `data-soon`, `data-entry`, `data-fork`), and `data-list-key` on its link for `j` and `k`.

### The asks board (`/asks`)

- **Shape:** the page's title and its one line, then one strip, then the filters in `--column-filters` on the left and the list running to the container on the right. Under 1100 px the filters stand above the list, their three groups side by side from `tablet`.
- **Strip:** "How to take an ask", a plain bordered card with three numbered steps, each a `CommandLine` (claim, check, push), and a line onward to Install and `llms.txt`. A ghost X button dismisses it; the dismissal is kept in `localStorage`, never a cookie, and "How to take an ask" at the foot of the filters brings it back. The server always draws it, so a reader who dismissed it sees it go once the page reads the storage.
- **Filters:** a `nav` landmark ("Filter the asks") of three groups, Kind, State (who may take it: any, open to take, held for newcomers or for people) and Project, each a list of links with its count, the current one on the field surface at 600 with `aria-current="page"`. Every filter is an address (`/asks?kind=fix&take=open`), each link keeps the other filters, and "Reset filters" shows once one is set. Sticky under the top bar from 1100 px.
- **List:** rows in a `RowGroup` per project, sticky under the top bar; a migrate family is its parent row with the family fan, its children listed under it.
- **Open asks only:** the board lists the asks still open, as the `frontPage` contract gives them, so it has no filter to show landed asks. Listing those needs a read of landed asks across every project, which no contract gives yet.

### Copy action (`CopyAction`, `CommandChip`) and command line (`CommandLine`)

- **Copy action:** a 32 px ghost button at a row's end, named for what it copies ("Copy claim command"), its command always in the DOM as text (`<code class="sr-only">`), never only a clipboard payload. After a copy it shows a check and says "Copied" for 2 s in a polite live region.
- **Command chip:** the command shown whole, small, at the end of a status line; pressing it copies it.
- **Command line:** a field-surface box with a hairline border that hugs its command; a muted `$` that selection skips; the command in mono at terminal leading, broken only between words, each wrapped line hanging 6ch; a ghost Copy button. A command is always shown whole; it never ellipsises, and a screen shows it once.

### Status line (`StatusLine`) and state badge (`StateBadge`)

- **Status line:** one sentence: the mark, the lead word in its role at 600, the rest in ink, then whose move in muted, then the next command as a chip. "Open to take", "Claimed by tamsin, no answer pushed yet · tamsin's move", "Checking at the checks stage · the platform's move", "Refused at Shape: OutOfScope", "Waiting on decision dec-000001 · a maintainer's move", "Landed as 9b1c3e5". A refusal's lead and tag come from `headline`, never a paraphrase. `data-tone` and `data-mark` carry it.
- **State badge:** the one way a state shows as a word: its mark, then its word in the role, at the size of its line. No pill, no fill, no box. `data-mark` (and `data-posture` on a posture's label) carry it.

### Marks (`marks.tsx`)

Lucide, one family, the mark `aria-hidden` and its word beside it: check (landed, passed), a filled dot (checking, now), hourglass (waiting, an expiry), octagon X (refused, final), turn-back arrow in olive (a retryable refusal), hollow circle (open, not yet), dashed circle (claimed), dash (not needed), lock (sealed), shield (a decision's default), an ink X (a failure that is not a refusal). Same mark, same meaning, on every page.

### The family fan (`FamilyStrip`, `FamilyTree`)

- **Character:** a split ask's siblings, side by side; never a ladder, never a sentence of ids.
- **Row form:** the parent row's third line: one node per child, its mark and its short name in mono, joined by a hairline bus, an arrow to the delete child's node, "n of N landed" at the right, and a toggle that lists the children as indented rows. On a phone the strip shows marks only.
- **Vertical form:** at the top of a member's page: the parent, the children on a left bus, then the delete child, the member being read at 600 on the surface.

### Outcome (`OutcomeView`), stage strip (`StageStrip`) and refusal (`RefusalView`)

- **Outcome:** an answer's status line at Title size, the stamp on Landed; a refusal adds `RefusalView` below. `data-outcome` and `data-state` carry it.
- **Rounds:** every push the gate checked is a round, numbered from 1; on an answer with more than one round the first region is **Rounds**: one 40 px `Row` per round, the round read in the address (`?head=`).
- **Waiting:** under the strip, the one sentence a contributor needs, from the typed state ("Nothing for you to run. A maintainer has until Thu 14:00."). Never a spinner.
- **Landed:** told as a sentence before it is shown as a hash: one `StatusLine` at Title size, then the credit trailers under "Credit", then the held-back lines, then "The landing commit".
- **Stage strip:** seven ruled cells in cost order (Parse, Shape, Merge, Cheap, Checks, Held-back, Maintainer), each a mark, its label and a 13 px state word: passed, now, refused, not yet, not needed. The current cell is on the surface with `aria-current="step"`.
- **Refusal:** a hairline above and below (no coloured top rule), then `headline(refusals)` in mono red with an octagon mark, then one row per refusal parted by hairlines: its `explain` lines verbatim, then its `next` as a command line. A retryable refusal's mark is the olive turn-back arrow. `data-refusal` and `data-retryable` carry it. The web never rewords a refusal.

### Credit trailers (`CreditTrailers`, `CompactCredit`) and held-back lines

- **Credit:** a "Credit" label over one mono line per trailer, `Role: handle`, in `CreditRole`'s order (`Asked-by` first), handles linked; below a dashed rule, "Agents used, disclosed and not credit" and the muted `Assisted-by:` lines. The compact form reads "Asked by ines-v · answered by bram" and never names an agent.
- **Held back:** one sealed-violet mono line with a lock per area, each root shortened with the whole in `title` and on copy. The area and its count, never a check's name.

### Posture badge (`PostureBadge`)

The platform's own label, never rewritten, through the state badge: a lock and the word in sealed violet for postures that keep something sealed, an open lock in ink for Open, muted for Source available. Said once per page: in the project header, in a list's group heading, or on an Explore card; never per row. `data-posture` carries the literal.

### Decisions, the inbox and the finish

- **Inbox** (`/inbox`, once Home and Today, which redirect to it with their query kept): the reader's handle and record, the budget as one sentence for a decider, then sections under sticky headers: the decisions (Due today, Within your budget, Waits for tomorrow), each decided in its row; Your claims, each answer's stage strip under its row and its next command as the row's copy action; Asks you may take; and what happened lately in the projects the reader decides for (Newcomers to welcome, Landed without a decision). `?project=` narrows it to one project. A personal page: never kept at the edge.
- **Choices:** one tap each, no confirm. Primary buttons, the default the outline button with "default" beside its name; 36 px in a row from 640 px, 44 px in a two-column grid on a phone. Under each, a 13 px muted consequence line written from what the platform does. After a choice the record replaces the buttons, landed green only for a choice that took effect.
- **Finish:** the changed files in the tree column with status letters, `+n −m` and a local read mark; the diff with sticky file headers and "Mark read"; the want, verdict, choices and the finish commands in a strip.

### Code browser (the Code tab)

- **Tree:** `@pierre/trees` in `--column-tree`: Plex Sans 14 px, monochrome icons, single-child folders flattened, the current path expanded and in view; on a commit, every changed file with its status letter and `+n −m`.
- **File:** a sticky file header (the path as a trail, folders muted and the file name in ink; "N lines · size · language"; Code | Why; Raw, Permalink, Copy), then the code at Pierre's metrics in its own box. The server sends plain numbered text at the same metrics, so the highlighting lands in place.
- **Why:** a mode of the file view: consecutive lines from one landing under a band that reads ask and answer first, SHA second.
- **Commits and a commit:** rows under sticky day headers; a commit's subject as Title, its status line, the body as prose, then the diff (Unified | Split from 48 rem).
- **Missing path:** a soft landing on the nearest folder, with the refusal's own text above it.

### The docs

- **Tree:** every page under Guides then Reference, from `@repo/agent-kit`'s entries; the page being read ink at 500 with `aria-current="page"`.
- **Article:** the breadcrumb (Docs, its part, the page), the title at Headline, the summary at Want 400, then the page's Markdown, all held to `--measure`.
- **On this page** (`--column-docs-toc`): the article's `h2`s as in-page links, each to the id its heading carries, then Copy as Markdown (the page's whole Markdown) and View as .md (the page's `.md` server route), both outline buttons. Sticky beside the article from `columns`; under it below.
- **Commands** (Reference): every command as its synopsis (`myr <words> <positional> [--flag]`), what it does, and whether it only reads, from `commandDocs`.

### Visibility, policy and refs

- **Ledger:** the head sentence carries the facts; layers as rows (name in sealed-violet mono, readers, writers, disclosure, reason), sealed areas with root and admission, history newest first. No path, check name or file name.
- **Environment:** items as definition rows, sensitive first: the key in mono, the sealed lock and "sensitive", "set by ines-v" or "not set", type, required, proxy hosts. Never a value.
- **Policy:** maintainers by path, vouching one line per vouch, limits in tabular figures, agents, one line per layer; the commands that change it, each flag on its own line.
- **Refs:** main ("moves only by a landing"), tags, and forks with their claim's state word.

### Empty, pending and error states

- **Empty (`EmptyState`):** a dashed hairline block: one sentence saying what is empty, then the command that changes it or a link onward.
- **Pending:** the shell and header stay; after 300 ms main shows its title over rows of skeleton (outlined bars, no shimmer).
- **Not found:** the trail up to what exists, a title saying what was asked for ("No such ask"), `RefusalView` verbatim, then one or two onward links.
- **Unreachable:** "The platform did not answer.", "Try again in a minute; nothing was changed. Git and the CLI reach it directly." and Reload. Never red.

### Buttons and fields

- **Shape:** square, UI type (14 px, 500).
- **Primary:** white on the sage primary (4.58:1), 32 px; hover lightens the fill. One per screen.
- **Secondary:** ink on the soft sage `--secondary`.
- **Ghost:** no fill until hover, then the surface; Copy and lesser actions.
- **Outline:** paper with a control border; the default choice.
- **Fields:** a 3:1 control border on paper, 32 px (36 px and 16 px text on a phone).
- **Focus:** the global 2 px sage outline (`--ring`), 2 px out, on every control; inside a row, inside the row's box.

### Navigation and keys

- **Links:** every link between pages is the router's (`AppLink`), preloading on hover or focus; the page being read is `aria-current="page"`. Links in running text are ink, underlined in the hairline colour, ink on hover. A skip link to `#main` is the first tab stop.
- **Keys:** `?` opens the keys dialog with "Single-key shortcuts: On / Off"; `j`/`k` move through a list's rows, Enter opens; `J`/`K` move between files; `1` to `9` copy the page's numbered commands; Escape closes a sheet. No key acts in a field. Every key has a pointer twin.

### Owners and imports

- **Names:** a project is named in full wherever a page names it, `<owner>/<name>`; the owner is never dropped. A field that holds the namespace is labelled "Owner".
- **Words:** "Import a repo" is the page at `/import` and every link to it; "Imported from" heads an import's source fact. The glossary's avoided words for an import (mirror, fork of the source, sync) stay banned.

### The landing

- **Where:** `/`, in the site shell (ADR 0041 amends ADR 0030's bare page). A reader who carries a session is sent to `/inbox`.
- **Hero:** one primary action (the open asks) and the install command, then a two-panel comparison as inline SVG: on the left the usual flow by its mechanism (issue, branch, pull request, review comments, merge button) under an X mark; on the right an ask, an answer and the gate under a check mark. Two cards side by side, stacked on a phone; no product is named. It honours `prefers-reduced-motion`.
- **Below:** the seven-stage gate with a refused and a landed output beside it, the four words, landings as they happen, and every way in (linking `/install`). Its evidence is real output, set in mono as a terminal prints it. Until a read of landings across projects exists, "Landing now" lists the public projects by their last landing, the latest first, from `listProjects`, each with its posture.

### Install

- **Where:** `/install`, in the site shell; the old `/agents` is a 301 to it, and `/agents.md`, `/llms.txt` and `/llms-full.txt` keep answering.
- **Shape:** the title and one line under it, then one card per way in, two across from `columns` and stacked below: the CLI (the install script, npm, signing in), the MCP server (Claude Code, Cursor, VS Code and stdio as tabs, every panel in the HTML), skills, text for agents (`llms.txt`, `llms-full.txt`, Markdown by `Accept`), git over HTTPS with the CLI as its credential helper (no SSH keys), the web (signing in), and the pi extension, planned, on a dashed border with no command. Each card says who it is for after its title, never above it.
- **Source:** every card, snippet and link is `installChannels` in `@repo/agent-kit` (`apps/web/test/agents.test.tsx`); the page draws no command of its own. The command synopsis lives at Docs › Commands, and the endpoints and the policy's default limits at Docs › Limits and endpoints, which the text card links. The web card's sign-in link returns the reader to `/install`, as the top bar's does.

### Theme preference

Light and dark follow the system by default. On `/settings` (Appearance) a reader may choose "Same as system" or "Opposite of system", each shown with what it resolves to now ("Light", "Dark"). It lives in `localStorage`, never a cookie (a cookie would take every page out of the edge cache), and one inline script in the head sets `data-theme` before first paint (ADR 0042).

### The platform's own pages

Sign-in (with the MCP consent), sign-up, the Google handle page, the code, add-email and reset pages, the problem page and the platform's `/` load nothing (no script, no web font), so they carry the sage garden palette as hex literals in their inline style, copied from `apps/web/src/styles.css` for both schemes: paper, card, ink, surface, muted, rule, the 3:1 control border, primary with its on-primary text, refused only for a refusal, and waiting for the marked "Warning" line in the loopback case; `color-scheme: light dark`. Their faces are named as the web's are, IBM Plex Sans then the system sans at 16 px and IBM Plex Mono then the system mono, so Plex shows only where the reader has it installed. Every page but `/` is the focus shell: the wordmark as text from `@repo/brand` above one card with a hairline border and a 2 px radius, no edge accent, no navigation and no eyebrow, its h1 first. The consent names the client, its publisher when known, and the host that receives access; on sign-in and sign-up it also lists what the client may do as the person, and says it never sees the password. The platform's `/` keeps a plain document frame.

### shadcn

shadcn 4.21.2, style `base-lyra` on Base UI, in `src/components/ui/` (generated, restyled to the tokens). The pages use its button, badge, table, textarea, tooltip, dialog and sheet, select, combobox, popover and skeleton. Overlays load after hydration in their own chunk.

## Do's and Don'ts

### Do:

- **Do** name exactly one shell per route, and read every width from its token (`max-w-site`, `w-(--column-about)`, `max-w-(--measure)`).
- **Do** draw rows, status lines, the fan, refusals, credit, held-back lines, posture, outcomes and stages with the shared components; change the component, not a page's copy of it.
- **Do** show the command for every action once, its text in the DOM, through `CommandLine` or `CopyAction`.
- **Do** carry every state as a mark, then a word, then a colour, and key tests and styles on the `data-*` attribute that names it.
- **Do** link between pages with `AppLink`, and read a list's rows in its loader so they arrive in the HTML.
- **Do** keep text at 4.5:1, controls and borders at 3:1, every control reachable and visibly focused by keyboard, and nothing below 13 px.
- **Do** set the footer's wordmark from `Brand.domain`, upper-cased by CSS, one line across the full width of the site and docs shells.
- **Do** check every page at 1440, 1100 and 390 px in both schemes, and at 360 px with no horizontal scroll.
- **Do** honour `prefers-reduced-motion`: every animation and transition drops to an instant change.

### Don't:

- **Don't** add a global left rail, a generic right rail, or a side column that is not facts about what is on screen.
- **Don't** put a coloured strip, bar, notch or tab on any edge or corner of a card, row or panel: no `border-l-4`-style accent, no state-coloured top rule. A card is a plain bordered surface (`design-rules.test.tsx` refuses a thick edge in a state or primary colour).
- **Don't** set an eyebrow: no small, upper-case or tracked kicker line above an h1, h2 or h3, and no component or class named eyebrow, kicker or overline.
- **Don't** type the brand's name or domain anywhere but `packages/brand`; the footer reads `Brand.domain`.
- **Don't** add a logomark; the only icon file is the repeat button emoji drawn as text.
- **Don't** use orange, amber or brown anywhere, or a serif.
- **Don't** put stat tiles, a big number over a small label, pill badges, tinted state squares, avatar stacks, sparklines or coloured file icons on any page.
- **Don't** colour a row's state word (Refused and Landed apart), say a posture twice on one page, or ellipsise a command.
- **Don't** reword a refusal or compute your own explanation of one; render `explain` and `headline`.
- **Don't** show a score, a rank, a count of a person's landings or credits, or a leaderboard.
- **Don't** use red for anything but a refusal, violet for anything but sealed things, green for anything but on main, the sage primary for a state, or colour without a word; a diff uses its own teal and rose.
- **Don't** use monospace for prose, labels, buttons, headings or commit bodies.
- **Don't** show an env value, or the placeholder an answer sees, anywhere.
- **Don't** add a form for something git or the CLI does (claim, push, check, land, env set), a light/dark toggle beyond the two-way preference, a cookie for any preference, or a second component kit.
- **Don't** put on screen the words review, approve, PR, pull request, issue (for an ask), merge (for a landing), lease, reputation, queue, dashboard or trending. Inbox and Explore are page names now (ADR 0041). The landing's comparison panel is the one place that names the usual flow by its mechanism (issue, branch, pull request, review comments, merge button), and only to contrast it.
- **Don't** use shimmer, spinners in content, page-load choreography or toasts as the only feedback.
