---
status: accepted
---

# The landing sits outside the shell, and the front page moves to `/asks`

This amends ADR 0022, under which every page sat in the control room's shell. The web's `/` is now a landing: one page that says what the platform is and leads to the open asks. It is the one page drawn outside the shell. Its route names `staticData: { shell: "bare" }`, and `AppShell` then draws the page alone, with no rail, bars, overlays or skip link. `apps/web/test/landing-route.test.ts` holds that only `/` names it.

The front page, every open ask across every project, moved unchanged from `/` to `/asks`, which the rail already called Asks. A signed-in reader's own page is `/home`, and the docs are `/docs`. `asks`, `home` and `docs` joined `reservedProjectNames`, so no project can be named after a page the web serves.

The landing is the same page for everyone, so the edge may keep it (`branchPage`, ADR 0026). Its server GET answers in this order (`landingHandler` in `apps/web/src/server/front-page.ts`):

1. A request for Markdown gets `/llms.txt`, as `/` gave before and `/asks` still gives. Agents reach the web at `/`.
2. A request that carries the session cookie gets a 302 to `/home`, kept nowhere. Workers Cache serves the kept landing only to a request with no cookie (it varies by `Cookie`), so a signed-in reader always reaches the Worker and is sent on.
3. Anyone else gets the landing.

A signed-in reader who reaches `/` by a link, with no document load, is moved to `/home` once the browser learns who they are (`whoAtom`). The wordmark leads to `/`.

## Considered Options

- **Keep the front page at `/` and put the landing elsewhere** (`/about`). Nothing moves, but a first-time reader lands on a list of asks with no word on what they are, and a signed-in reader has no home to arrive at.
- **Draw `/` differently by cookie.** One address, but a page the edge keeps would then depend on its reader, which ADR 0026 forbids. The redirect keeps the landing's markup the same for everyone.
- **A second site for the landing and docs.** A free hand with the look, but a second deploy path and a second set of byte budgets in the last week, and the docs would lose the web's Markdown pipeline and its reads.

## Consequences

- Links that meant the front page (Open asks, a filtered list, a crumb) now name `/asks`; a filtered list is `/asks?kind=bug&take=open`.
- The landing follows DESIGN.md: one paper ground, ink, hairlines, the type scale, and mono only for what a terminal prints or takes. It is the one page written to explain rather than to operate, and DESIGN.md says so.
- A bookmark of `/?kind=bug` now opens the landing, not a filtered list.
