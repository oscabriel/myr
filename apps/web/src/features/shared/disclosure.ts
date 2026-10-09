/**
 * What people outside a layer's audience learn about what it holds, in
 * one set of words for every page that shows a layer (the ledger, the
 * people page).
 */
import type { Disclosure } from "@repo/protocol/domain/visibility";

export const disclosureWords = {
  counted: "counted: how many it holds, and when they open",
  declared: "declared: that it exists, with its kinds and reason",
  hidden: "hidden: nothing beyond its name",
  public: "public: everything",
  sealed:
    "sealed: counts, authors and a salted root; never names, paths or contents",
  writeOnly:
    "write-only: names, and who set each value and when; never a value",
} as const satisfies Record<Disclosure, string>;
