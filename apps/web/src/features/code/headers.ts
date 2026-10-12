export const isCommitId = (rev: string) => /^[0-9a-f]{40}$/u.test(rev);
