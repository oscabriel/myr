---
status: accepted
---

# The edge keeps the web's anonymous answers, and nothing read for a reader

The web Worker runs behind Workers Cache in each deployed stage (`"cache": { "enabled": true }` in `apps/web/wrangler.jsonc`'s `dev-oscabriel` and `demo` blocks; the top-level `local` stage, which `vite dev` reads, has none). A page the cache holds comes back from the edge without running the Worker, at the `Cache-Control` the page already gives: `branchPage` (`public, max-age=30, stale-while-revalidate=300`) for the pages at `main`, a tag or a commit, `public, max-age=60` for the agents' documents, and the platform's own headers on what the web passes on (raw files, releases, the install script).

Workers Cache keys an answer by the Worker's entrypoint, path, query string and version, and by none of the host, the `Cookie` or the `Authorization` (<https://developers.cloudflare.com/workers/cache/cache-keys/>). It bypasses a request with an `Authorization`, an answer with `Set-Cookie`, and an answer marked `private` or `no-store`. It does not bypass a request that carries a cookie, it honours `Vary` by storing one variant per verbatim value of each named request header, and an answer with no `Cache-Control` is kept by a heuristic: two hours for a 200, three minutes for a 404 (<https://developers.cloudflare.com/workers/cache/configuration/>). So a page whose markup depended on its reader would be handed to everyone, and a route that forgot its headers would be kept for hours.

The web holds that off in one place. `wrangler.jsonc`'s `main` is `apps/web/src/server.ts`: TanStack Start's own server entry, with every answer it gives (pages, server functions, server routes, redirects and errors) passed through `forTheEdge` (`apps/web/src/server/edge-cache.ts`):

- An answer to a request that carries any cookie or an `Authorization`, an answer that sets a cookie, an answer with no `Cache-Control`, and one whose `private` or `no-cache` names a field to strip, is `private, no-store`, which the cache bypasses. Nothing read with a reader's credential is stored.
- Any other answer the cache may store varies by `Cookie`. It was made for a request with no cookie, and the cache serves it only to a request with none, so a signed-in reader never receives a page kept from a signed-out one, and the browser's own cache drops it when a session begins or ends.
- `CDN-Cache-Control` and `Cloudflare-CDN-Cache-Control`, which outrank `Cache-Control` at the edge, are dropped.

The pages keep a rule their loaders already followed (`apps/web/src/server/front-page.ts` reads "as the anonymous viewer reads it"): a page the edge may keep reads as nobody. Its loader calls `serverClient(env)` without the request, and only the pages kept nowhere (Today and a decision, `personalPage`) reach the reader's request through Start's server helpers. The rail's signed-in state and Today's count are read in the browser after hydration. So the markup of a `branchPage` page is the same for every reader, and the `Vary` above is a second wall, not the only one.

`apps/web/test/edge-cache.test.ts` holds it: the rule for every kind of answer the web gives, the entry as Start's handler wrapped and nothing else, each server route that hands the reader's cookie on (`/llms.txt`, a project's `llms.txt`, `/` as Markdown, a raw file, `/rpc`) kept nowhere when a session cookie comes with it, and the pages that read the request being exactly the `personalPage` ones. `packages/config/test/web-wiring.test.ts` holds the config: the entry, the cache on in each stage and off at the top, and no `cross_version_cache`.

## Considered Options

- **No Workers Cache.** Nothing to hold, but every page view runs the Worker and its platform reads; a page at a commit, which never changes, costs as much as one at `main`.
- **A cookie-reading gateway entrypoint with the cache off, forwarding cookie-less requests to a cached inner entrypoint over `ctx.exports`** (Cloudflare's own pattern for authenticated traffic, <https://developers.cloudflare.com/workers/cache/examples/>). Every request would run the gateway, and it needs a second entrypoint in a Worker that TanStack Start's build owns. The `Vary: Cookie` rule gives the same separation inside one entrypoint.
- **Bypassing only on the session cookie.** More hits for a reader who carries some other cookie, but every cookie the web sets would have to be weighed; the web's readers carry none until they sign in.
- **`private` with the page's own `max-age` for a signed-in reader**, so their browser could still keep a page. Kept simple instead: `private, no-store` is what the cookie fence checks.
- **`cross_version_cache`.** Pages would survive a deploy, but a kept page names the hashed assets of the version that drew it.

## Consequences

- Cost: with caching on, every request to the web Worker is billed at the standard request rate, including the static asset requests (`/assets/*`, icons, fonts) and the service-binding calls that are free without it (<https://developers.cloudflare.com/workers/cache/>). A hit runs no CPU.
- Cost: an answer is held to the Free plan's cacheable size, whatever the account's plan, while that launch limit lasts, and purges run at the Free tier's rate (<https://developers.cloudflare.com/workers/cache/limitations/>).
- A signed-in reader, and anyone who carries a cookie, always runs the Worker and keeps nothing in the browser; the edge serves signed-out readers and agents.
- A page at `main` may be served by the edge up to 30 seconds old, and up to five minutes more while one request refreshes it in the background, now to every reader rather than one browser. Purging on a landing would have to run inside the web Worker (`ctx.cache.purge`), since a purge belongs to the entrypoint that owns the answer; nothing purges yet.
- Each deploy starts the cache cold, since the version is in the key.
- The host is not in the key: an answer that names its own origin (the agents' documents' `webUrl`) is kept for whichever host asked first. Each stage's web answers on one `workers.dev` host today; a custom domain beside it would share one cache.
- After a deploy, `curl -sI <web>/<project>/tree/main` twice shows `cf-cache-status: MISS` then `HIT` and `vary: Cookie`; the same request with `-H 'cookie: a=b'` shows `cache-control: private, no-store` and no `HIT`.
