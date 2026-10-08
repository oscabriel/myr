import type { Handle } from "@repo/protocol/ids";
import { Layer, Redacted } from "effect";

import { Sessions } from "../sessions.ts";
import { MemorySessions } from "./memory.ts";

/** One token the platform was given, and the handle it names. */
export interface SessionEntry {
  readonly handle: Handle;
  readonly token: Redacted.Redacted;
}

/**
 * Sessions from tokens the stage was given: the operator's and
 * each named one in `SESSION_TOKENS`. The first entry naming a token wins,
 * so the operator's goes first.
 */
export const sessionTable = (entries: readonly SessionEntry[]) =>
  MemorySessions.service(
    Object.fromEntries(
      entries
        .toReversed()
        .map(({ handle, token }) => [Redacted.value(token), handle])
    )
  );

/** `sessionTable` as the platform's one `Sessions`. */
export const TableSessions = (entries: readonly SessionEntry[]) =>
  Layer.succeed(Sessions, sessionTable(entries));
