/**
 * Whether a revision names one commit for good: a whole 40-hex id. A code
 * page at one never changes, so it is cached for good
 * (`routes/$project/tree/-headers.ts`); a page at `main` or a tag moves
 * with the next landing.
 */
export const isCommitId = (rev: string) => /^[0-9a-f]{40}$/u.test(rev);
