import type { Handle } from "@repo/protocol/ids";
import { Layer, Redacted } from "effect";

import { Sessions } from "../sessions.ts";
import { MemorySessions } from "./memory.ts";

export interface SessionEntry {
  readonly handle: Handle;
  readonly token: Redacted.Redacted;
}

export const sessionTable = (entries: readonly SessionEntry[]) =>
  MemorySessions.service(
    Object.fromEntries(
      entries
        .toReversed()
        .map(({ handle, token }) => [Redacted.value(token), handle])
    )
  );

export const TableSessions = (entries: readonly SessionEntry[]) =>
  Layer.succeed(Sessions, sessionTable(entries));
