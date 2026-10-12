import { PatchId } from "@repo/protocol/ids";
import { Array, Effect, Order } from "effect";

import type { Change } from "./tree-diff.ts";

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * SHA-256 over sorted `path\0before\0after\n` lines, an absent blob as the
 * empty string. Not `git patch-id`, so a Worker computes it with WebCrypto and
 * no diff.
 */
export const patchId = (changes: readonly Change[]): Effect.Effect<PatchId> => {
  const lines = Array.sort(
    changes.map(
      ({ after, before, path }) => `${path}\0${before ?? ""}\0${after ?? ""}\n`
    ),
    Order.String
  );

  return Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(lines.join("")))
  ).pipe(Effect.map((digest) => PatchId.make(hex(digest))));
};
