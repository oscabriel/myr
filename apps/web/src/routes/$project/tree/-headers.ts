/**
 * The `Cache-Control` a code page answers with, by what its address names
 * and whether it found anything: a page at a whole commit id shows what
 * can never change, so a browser keeps it for good; a page at `main` or a
 * tag moves with the next landing, so it is kept briefly and read again
 * behind it. A page that found nothing (no such project, commit or path:
 * its loader read no data) is kept briefly too, even at a whole commit
 * id: a landing or an import may bring what it named. Not a route: the
 * `-` prefix keeps the router from reading it as one.
 */
import { isCommitId } from "../../../features/code/headers.ts";
import { branchPage, immutablePage } from "../../../server/cache-headers.ts";

/** A code page's headers at `rev`, given whether its loader found what it names. */
export const codePageHeaders = (
  rev: string,
  found: boolean
): Readonly<Record<string, string>> =>
  found && isCommitId(rev) ? immutablePage : branchPage;
