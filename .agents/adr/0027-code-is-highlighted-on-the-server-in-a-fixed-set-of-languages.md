---
status: accepted
---

# Code is highlighted on the server in a fixed set of languages

This amends ADR 0019, which drew code in the browser only. A blob page's file and a commit page's first files now arrive highlighted in the document: the web Worker draws them with `@pierre/diffs/ssr`, using the browser's own options (`apps/web/src/features/code/pierre.ts`), and sends each drawing as a declarative shadow root on Pierre's `diffs-container`. The browser paints it with the document, before any script. The browser's own drawing (`File`, or the commit's `CodeView`) still takes over, with line selection, the address's `#L` and the worker pool, but only once it is ready to draw the same code highlighted at once: its module loaded, the pool up, and the code highlighted in the pool first (`prepareFile`, `prepareDiffs`). It then replaces the server's drawing in one render (`apps/web/src/features/code/client-code.tsx`), with every line in the same place. Code the server does not highlight still arrives as plain text and changes once, to highlighted.

The server highlights only within its own limits (`apps/web/src/features/code/prerender.ts`):

- **Languages.** TypeScript, TSX, JavaScript (with `.mjs` and `.cjs`), JSX, JSON, Markdown, YAML, TOML, shell, CSS and HTML, by the names Pierre gives a file's type. Any other language is sent as numbered plain text, as before, and the browser highlights it.
- **Lines.** At most 400 lines a page. A diff counts both sides, since Pierre highlights both whole files. A commit page considers at most its first 8 files that start open (an added or deleted file past 80 lines starts folded), the ones a reader sees first. `CodeView` highlights the rest as they scroll into view.
- **The drawing's own limits.** A file past `tokenizeMaxLength`, or with any line past `tokenizeMaxLineLength` (1,000, the same as `maxLineDiffLength`), is sent plain, so a minified file is never tokenized on the server.

Both sides decide from the page's own data, so the browser knows which code arrived highlighted without being told. The Worker runs Shiki's JavaScript regex engine, since a Worker may not compile WebAssembly. Its build resolves `shiki` to core alone (`apps/web/src/server/shiki.ts`) and `@pierre/theming/themes` to an empty collection (`apps/web/src/server/pierre-themes.ts`), through a plugin in `apps/web/vite.config.ts`. So it bundles the eleven grammars it names, as chunks off its entry, and no other grammar, theme or WebAssembly. Pierre will not resolve a grammar or a theme by name in a Worker's global scope (`isWorkerContext`), and `registerCustomLanguage` only registers a loader for that resolution. The server therefore loads each grammar and the token theme itself and attaches them to Pierre's shared highlighter (`apps/web/src/features/code/prerender-server.ts`).

## Considered Options

- **Keep drawing in the browser only** (ADR 0019 as it stood). The plain text already matched Pierre's measures, so nothing moved. But the code changed colour after hydration, and that swap was the largest paint on code pages.
- **Highlight on the platform and keep the HTML in R2.** Each drawing would be made once for good. But it would need a new public read for the HTML, and every Worker reading it would take a hop on every code page.
- **Every grammar on the server.** About 10.7 MB of grammars, far past the web's byte budget.
- **Ship the HTML in the loader's data.** The browser could then adopt it on any page, but the document would carry every drawing twice: once as markup and once as a string in the router's state. Instead the loader draws the code ahead, the drawing is kept by its blob ids until the render reads it, and the browser needs nothing but the markup.

## Consequences

- **Bytes.** The web Worker's JavaScript grows from 1,528,378 to 2,773,744 bytes (budget 4,075,000), about 940 KB of it grammars. Its entry stays at 308,418 (budget 801,000): the grammars and `@pierre/diffs/ssr` load by dynamic import on a page's first highlighted code. `apps/web/test/production-bundle.test.ts` holds the Worker to exactly these grammars, none on its entry, and no theme collection or Oniguruma. It also holds the chunks every page preloads to no grammar and nothing of this module.
- **CPU.** Measured in the dev world's workerd, highlighting TypeScript takes about 0.14 ms a line warm: 2,400 lines about 315 ms, 600 about 85 ms, 400 about 57 ms, 100 about 18 ms. A fresh isolate's first 400-line file took 180 ms, which includes making the highlighter and compiling the grammar. 2,400 lines would cost hundreds of milliseconds, so the server's limit is 400 lines, well below the browser's.
- **Document size.** A highlighted line costs about 700 to 1,600 bytes of markup, depending on how many tokens it holds: a 400-line TypeScript file is about 640 KB. Each drawing also carries Pierre's stylesheet and icons (about 48 KB). Both compress well: an 11-line file's page is 100 KB raw and 16 KB gzipped.
- **Cache.** The drawings are kept in the isolate (`prerender.ts`): at most 24, and 8,000,000 characters of HTML, keyed by blob ids and path, which never change what they name. A file read again is not drawn again. A loader that finds its drawing evicted before the render makes it again, and the render streams it.
- **The page.** A page reached by a link, not loaded, has no server drawing. It shows the plain text, which the browser's drawing then replaces. A split diff (`?style=split` on a wide screen) is plain until drawn, as before, since the server draws unified only.
- **Without script.** A highlighted file has no `#L` anchors: Pierre's lines live in a shadow root, which a fragment cannot reach. Plain text keeps its anchors.
