/**
 * Whether a revision names one commit for good: a whole 40-hex id, where
 * `main` or a tag moves with the next landing.
 */
export const isCommitId = (rev: string) => /^[0-9a-f]{40}$/u.test(rev);
