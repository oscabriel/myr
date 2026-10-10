---
status: accepted
---

# The CLI exits with the code a refusal calls for

Until now every refusal ended the CLI with 1, so a script or a harness that wanted to know what to do next had to read stderr or ask for `--json`. Now the code comes from sysexits(3) and follows the refusal's fixed `retryable`, in `packages/protocol/src/exit-code.ts`:

- A retryable refusal is 75 (`EX_TEMPFAIL`): run its `next`, and the same thing can pass.
- A final refusal is 65 (`EX_DATAERR`) when what was sent has to change, 66 (`EX_NOINPUT`) when what was named does not exist or no longer stands open, and 77 (`EX_NOPERM`) when the caller may not do it. A table fixes one of the three per final tag. Its type is keyed by exactly the final tags, so a new final tag fails the typecheck until it has a code, and a retryable tag cannot be given anything but 75.
- Refusals met together, as stage 1's are, end with the first of 77, 66, 65 and 75 among them: who is asking comes before what was named, which comes before what was sent, and 75 only when every one can be retried.
- Not being signed in is 77, a platform that does not answer is 69 (`EX_UNAVAILABLE`), a misuse stays 2, and anything else stays 1.

Every command prints its refusals through `endRefused` (`packages/protocol/src/cli.ts`), which fails with `Reported` and their code, so a command cannot print a refusal and exit with another code. The code is the CLI's projection of the union, like the `--json` envelope: `/llms-full.txt` and the skills list each refusal's code from the same table. `packages/protocol/test/exit-code.test.ts` pins every tag's code. `apps/cli/test/build.test.ts` holds the built binary to it.

## Considered Options

- **Keep 1 for every refusal.** Nothing to learn, but the code says nothing a harness can act on, and `retryable` was already fixed per tag.
- **One code per tag.** Exact, but 45 codes make a lookup table nobody keeps in their head, and the tag is already in `--json`.
- **64 (`EX_USAGE`) for a misuse.** sysexits' own code, but effect/cli and most command lines use 2, and scripts already read it.
- **76 (`EX_PROTOCOL`) for every final refusal**, as some tools use it for "the remote rejected the payload". It would merge three answers a caller acts on differently: change what you sent, name something that exists, or get let in.

## Consequences

- A script that checked for exit 1 after a refusal now sees 65, 66, 75 or 77; it should test for nonzero, or for the code it means.
- `PostureChange` is 65, as a declined waiver's `Weakened` is: it is the refusal a declined decision stands for, so the answer has to change. Its row in the reference docs now says so.
- A code is a public contract, like a tag: change one only with notice.
