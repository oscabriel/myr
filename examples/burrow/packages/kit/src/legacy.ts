import { fetchTransport, isSuccess } from "./transport.ts";
import type { Transport } from "./transport.ts";

// How many requests went out through `legacyFetch`, for the debug page.
let requestsSent = 0;

/** How many requests `legacyFetch` has sent since the process started. */
export const legacyRequestsSent = () => requestsSent;

/**
 * The first HTTP helper, from before `http.get`: it returns the body as
 * text and throws on any status that isn't a success. New code uses
 * `http.get`.
 */
export const legacyFetch = async (
  url: string,
  transport: Transport = fetchTransport
): Promise<string> => {
  requestsSent += 1;

  const reply = await transport(url);

  if (!isSuccess(reply.status)) {
    throw new Error(`GET ${url} answered ${reply.status}`);
  }

  return reply.text;
};
