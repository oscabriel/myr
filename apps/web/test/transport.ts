/**
 * The fence every feature's views keep: props in, markup out. A view that
 * fetched would tie its page to one transport (`src/surfaces.ts`); the
 * atoms live in `src/client/`, and a route hands their values to the view.
 */

/** An import of the RPC stack, the backend, or the web's own client or server modules. */
const TRANSPORT =
  /from\s+["'](?:@repo\/protocol\/contracts|effect\/(?:rpc|http|reactivity)|#backend|[./]+\/(?:surfaces|client\/[^"']*|server\/[^"']*)(?:\.tsx?)?)["']/u;

/** The paths among `sources` (path → source text) that import a transport. */
export const reachingTransport = (
  sources: Readonly<Record<string, string>>
): readonly string[] =>
  Object.entries(sources).flatMap(([path, source]) =>
    TRANSPORT.test(source) ? [path] : []
  );
