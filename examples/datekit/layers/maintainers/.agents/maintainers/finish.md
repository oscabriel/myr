# Finishing an answer in datekit

For datekit's maintainers and their agents, before a finish commit. An answer that passed every check can still need finishing. Each point below is one we have had to fix after landing.

1. **Every clause of the ask's want has a test.** Read the want sentence by sentence. Each clause needs an assertion in the public tests that would fail without the change. "In either direction" means a test going forward and a test going back.
2. **`parseISO` never throws.** Text it can't read gives `invalidDate()`. A new form gets a test in `test/parse.test.ts` that misreads its edge cases: week 53 in a 52-week year, day 0, a weekday of 8.
3. **No new tokens without the README.** A change to what `format` accepts updates the token table in `README.md` and the one in `format`'s doc comment, in the same order. A letter that is no token keeps throwing a `RangeError`.
4. **UTC unless a zone is named.** Code never reads the machine's zone: no `getHours()`, `getDate()` or `toLocaleString()` without `timeZone`. Run the tests under `TZ=Pacific/Kiritimati bun test` before finishing.
5. **The smallest diff that reads well.** Keep the ask's territory. Rename only what the change makes wrong. Keep the existing helpers (`pad`, `whole`, `utcMidnight`) rather than adding near copies.
6. **Held-back checks stay here.** Never copy a file from `checks/held-back/` into `test/`, and don't paraphrase one in a public test. If a public test needs a check, release it as a credited landing, then write the public test from the release.
7. **Credit the answer's author.** A finish commit adds `Finished-by:` and keeps the answer's `Signed-off-by:` as it was.
