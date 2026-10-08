import type { Transport } from "./transport.ts";

/**
 * A transport that answers from a table of URL to body, and 404 for any URL
 * not in it. It records each URL it was asked for.
 */
export const fakeTransport = (routes: ReadonlyMap<string, string>) => {
  const asked: string[] = [];

  const transport: Transport = (url) => {
    asked.push(url);

    const text = routes.get(url);

    return Promise.resolve(
      text === undefined ? { status: 404, text: "" } : { status: 200, text }
    );
  };

  return { asked, transport };
};
