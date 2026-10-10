/**
 * The `Cache-Control` a code page answers with, by what its address names:
 * a page at a whole commit id shows what can never change, so a browser
 * keeps it for good; a page at `main` or a tag moves with the next
 * landing, so it is kept briefly and read again behind it. Not a route:
 * the `-` prefix keeps the router from reading it as one.
 */
import { isCommitId } from "../../../features/code/headers.ts";
import { branchPage, immutablePage } from "../../../server/cache-headers.ts";

/** A code page's headers at `rev`. */
export const codePageHeaders = (
  rev: string
): Readonly<Record<string, string>> =>
  isCommitId(rev) ? immutablePage : branchPage;
