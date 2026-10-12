const TRANSPORT =
  /from\s+["'](?:@repo\/protocol\/contracts|effect\/(?:rpc|http|reactivity)|#backend|[./]+\/(?:surfaces|client\/[^"']*|server\/[^"']*)(?:\.tsx?)?)["']/u;

export const reachingTransport = (
  sources: Readonly<Record<string, string>>
): readonly string[] =>
  Object.entries(sources).flatMap(([path, source]) =>
    TRANSPORT.test(source) ? [path] : []
  );
