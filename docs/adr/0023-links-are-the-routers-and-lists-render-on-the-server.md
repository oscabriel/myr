---
status: accepted
---

# Links between pages are the router's, and lists arrive rendered from the server

Every link from one web page to another is `AppLink` (`apps/web/src/features/shared/link.tsx`): the router's `Link`, with the router's default preload set to `"intent"`, so a click moves without reloading the document and a hover or focus fetches the next page's code and loader data first. Outside a router (a view's own test rendered alone) it draws the same address as a plain anchor. Links to server routes (sign-in, raw bytes, a `.md` twin, `llms.txt`) stay plain anchors.

The lists (the front page, a project's home, Today, the landings) and the subject pages read their data in the route's loader on the server, so the HTML a browser, a crawler or `curl` receives already holds the rows. A loader's read seeds the page's atoms through `SeededAtoms` (`apps/web/src/client/seeded.ts`), a registry made for each render, and the atoms then keep the page live in the browser. The shared atom registry lives for the Worker's whole life and every request on it shares it, so a server render never writes a value there: atoms read outside a seeded registry render as waiting on the server (`withServerValueInitial`).

This replaces the earlier rule that the web's views used plain anchors so they could be rendered and tested without a router.

## Considered Options

- **Plain anchors everywhere.** Views render alone with no setup, but every click reloads the document, the shell's rail and inspector redraw from nothing, and no next page can be fetched ahead.
- **Lists read in the browser after hydration.** The first load is smaller, but the HTML holds no rows (an agent or a crawler sees an empty list) and the rows arrive after a skeleton.
- **Seeding the shared registry from the loader.** One line per page, but two requests on one Worker would see each other's data.

## Consequences

- A view that uses `AppLink` is tested inside a memory-history router (`renderAt` in `apps/web/test/render.tsx`), which renders the matched tree to static markup after `router.load()`.
- A hover or focus may start platform reads for a page the reader never opens; the router keeps a preloaded result for 30 s and a loaded one for 10 s.
- An agent that fetches a list page gets its rows in the HTML, and `Accept: text/markdown` on `/` and `/<project>` answers with the same text as `llms.txt` and the project's `llms.txt`.
- Each page gives its own registry an `id` from its address, so moving to another address starts from that address's seeds.
- A route file's extra exports stay in the client's entry chunk, so loaders' reads live in server-only modules (`apps/web/src/server/*`, `features/*/reads.ts`), which the root preload ceiling holds.
