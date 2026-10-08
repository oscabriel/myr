import { fetchTransport, isSuccess } from "./transport.ts";
import type { Transport } from "./transport.ts";

/** A GET's outcome: the body on a success, the status otherwise. */
export type Got =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly status: number };

/**
 * The HTTP helpers new code uses. A failed request is a value the caller
 * handles, never an exception.
 */
export const http = {
  /** GETs `url`. */
  get: async (
    url: string,
    transport: Transport = fetchTransport
  ): Promise<Got> => {
    const reply = await transport(url);

    return isSuccess(reply.status)
      ? { ok: true, text: reply.text }
      : { ok: false, status: reply.status };
  },
};
