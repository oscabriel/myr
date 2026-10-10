/**
 * The landing's evidence: the screen `git push` prints when an answer
 * strays outside its ask's territory, as the platform's gateway writes it.
 * The refusal's lines come from the one renderer (`explain`, `headline`),
 * so the page cannot drift from what git shows; the fork is the README's
 * (`apps/platform/test/core-loop.test.ts` asserts the same screen).
 */
import { RepoPath } from "@repo/protocol/ids";
import { OutOfScope } from "@repo/protocol/refusal";
import { explain, headline } from "@repo/protocol/render";

/** The fork the push goes to: datekit's `parse-iso`, claimed by alice. */
const FORK = "datekit--parse-iso--alice.git";

const refusals = [
  new OutOfScope({ paths: [RepoPath.make("README.md")] }),
] as const;

/** One line of the screen, and whether git printed it as the platform's (`remote:`). */
export interface TranscriptLine {
  readonly text: string;
  readonly remote: boolean;
}

/** The push and what git prints back, against the platform at `platformUrl`. */
export const pushTranscript = (platformUrl: string) => {
  const remote = `${platformUrl.replace(/\/+$/u, "")}/${FORK}`;

  return {
    command: "git push",
    /** The refusal's tag, which the page sets in the refused colour. */
    tag: headline(refusals),
    lines: [
      ...explain(refusals).map((text): TranscriptLine => ({
        remote: true,
        text,
      })),
      { remote: false, text: `To ${remote}` },
      {
        remote: false,
        text: ` ! [remote rejected] HEAD -> main (${headline(refusals)})`,
      },
      {
        remote: false,
        text: `error: failed to push some refs to '${remote}'`,
      },
    ],
  };
};
