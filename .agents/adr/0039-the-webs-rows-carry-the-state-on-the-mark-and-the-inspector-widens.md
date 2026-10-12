---
status: accepted
---

# The web's rows carry the state on the mark and the word in ink, and the inspector widens for its commands

Two rules of DESIGN.md changed in October 2026, after a heuristic critique of the front page, a project home and an answer page (31 of 40) and a source-first reading of a peer platform's web UI, taken as values and patterns only. This records the two changes and why, so that nobody restores the old rules as a tidy-up.

**The row's state word is ink.** DESIGN.md's row anatomy said "the state word in its role": Waiting in ochre, Refused in red, Landed in green, on every row. Measured on a project home, that painted ochre thirty-one times on one screen, and the one word that asks the reader for a move, "Open to take", was ink and had no weight against it. The peer's lists make the opposite mistake, a tinted square and no word, and are loud for it. The rule is now the Mark Carries Rule: in a row the colour belongs to the mark, the word is ink at 500, except Refused (red) and Landed (green), which are final and rare. The status line, the state badge and the inspector keep the coloured word, where it is said once beside its sentence. The Word First Rule is untouched: every mark still has its word.

**The inspector is 20 rem from `shell` and 22 rem from `codefacts`.** At 19 rem with 16 px of padding, a 6ch hang and a 32 px Copy, the inspector's command line held about 27 characters, so `myr claim <ask> --project <project>` and `git clone` of a project wrapped to three or four lines. The inspector exists to hand a command over; it was the hardest thing on the page to read. The peer opens its side column at 20 rem and only from 1350 px, and truncates its commands; Myr shows a command whole, so it makes room instead: 20 rem, 22 rem from 1440 px, and the command line in a bleed form inside the inspector (pane-wide, hairlines top and bottom, a 28 px icon-only Copy, a 2ch hang), which gives about 32 and 36 characters a line. Main keeps a 556 px row at 1164 px and an 800 px one at 1440 px.

Beside them DESIGN.md took, within its rules, a pressed-surface token for a selected row under the pointer, the time slot filled on every row, a two-line want below `tablet`, `files · +n −m` on a subject's meta line, Provenance in the one block shape, the path split in the code header and tree, the `kbd` look in the keys dialog, the Landed page told as a sentence before its hashes, and posture said once per page. None adds a colour to a non-state thing, a score, a fill, a shadow, a radius above 2 px or text under 13 px.

## Considered Options

- **Keep the coloured word and thin the lists.** Fewer rows per screen would not change what a page of waiting asks looks like; the stripe is the rule, not the count.
- **Collapse the inspector on laptops** and let main have the width. The facts and the command are what the page is for; hiding them to fit them is backwards.
- **Truncate commands in the inspector**, as the peer does. A command copied whole but read in part is the one thing the control room must not do.

## Consequences

- The rules are decided in DESIGN.md and not yet in the code; its "Decided, not yet drawn" list names each file, and the build issues are cut from it. The tokens (`--surface-2`, and its contrast pairs in `apps/web/test/tokens.test.ts`) are in `styles.css` now.
- Tests that key on a row's state word by colour class must key on `data-mark` and the word instead, as DESIGN.md's "Do" already asks.
- The critique's remaining findings (heading order in the inspector, the intro paragraphs past 70ch, the toolbar's inset) are polish, not rules, and are not recorded here.
