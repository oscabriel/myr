---
status: accepted
---

# The web is one permanent shell: a rail, the page, and an inspector of typed facts

Every page of the web sits in one shell that never unmounts: a rail on the left (the site's sections, the projects with their postures, the current project's sections, and the file tree on code pages), the page in the middle, and an inspector on the right that holds the typed facts of the thing in hand (its state, who may take it, the gate, the claim, the posture, the family, the provenance). One component, `Workspace` (`apps/web/src/features/shared/shell/workspace.tsx`), draws a page's main pane and its inspector together, so both arrive in the server's HTML in one pass, with no portal and no inspector built only in the browser. A list's selection lives in the address (`?ask=format-ordinal`, `?decision=dec-000002`), so a selected row and its facts render on the server and a link to them can be shared. Below 1120 px the rail becomes a top bar with a Menu sheet, the inspector's blocks render inline after the page's head, and phones get a bottom bar (Asks, Today, Projects, More).

The colour and type tokens stay as they were: one paper ground, ink as the only accent, five state colours that appear only beside their word and mark, Public Sans for what people read and JetBrains Mono only for what a terminal prints. What changed is the frame: the single centred report column, its double rule under every title and its ruled field grids are gone, and the pieces every page shared (the row, the status line, the family fan, the fact blocks, the copy action) are one component each in `apps/web/src/features/shared/`.

## Considered Options

- **Refine the single-column report sheet.** It kept every page self-contained, but a reader had to scroll to learn an ask's state, whose move it was and its next command, and the same facts were drawn differently on each page.
- **A man page for every page.** Terse sections and mono commands read well for agents and on the For agents page, which keeps that voice, but lists, Today and the code browser need rows, selection and a tree.
- **A forge dashboard of cards and stat tiles.** It spends colour and space on chrome, and invites counts that read as scores.

## Consequences

- Every page's frame was rebuilt, and its tests render inside a memory router (`apps/web/test/render.tsx`).
- The inspector repeats a subject's state (the State block) so it reads whole on its own; facts render twice in the markup (the inspector column and the inline copy), one hidden at each width, so a test that counts a `data-*` in the facts scopes to the inspector.
- Phones get a fixed bottom bar, and a decision's choices sit in a fixed bar above it.
- `DESIGN.md`'s Layout, Components and Navigation describe this shell.
- The shell's own code sits on every page's first load, so what the rail and shell import is held small (`apps/web/test/production-bundle.test.ts`).
