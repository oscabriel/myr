/**
 * The refusal's lines come from the one renderer, so they cannot drift from
 * what the gateway sends; git's own lines around them are what
 * `apps/platform/test/core-loop.test.ts` asserts from real git.
 */
import { RepoPath } from "@repo/protocol/ids";
import { OutOfScope } from "@repo/protocol/refusal";
import { explain, headline } from "@repo/protocol/render";

const FORK = "datekit--parse-iso--alice.git";

const refusals = [
  new OutOfScope({ paths: [RepoPath.make("README.md")] }),
] as const;

export interface TranscriptLine {
  readonly text: string;
  readonly remote: boolean;
}

export const pushTranscript = (platformUrl: string) => {
  const remote = `${platformUrl.replace(/\/+$/u, "")}/${FORK}`;
  const tag = headline(refusals);

  return {
    command: "git push",
    tag,
    lines: [
      ...explain(refusals).map((text): TranscriptLine => ({
        remote: true,
        text,
      })),
      { remote: false, text: `To ${remote}` },
      {
        remote: false,
        text: ` ! [remote rejected] HEAD -> main (${tag})`,
      },
      {
        remote: false,
        text: `error: failed to push some refs to '${remote}'`,
      },
    ],
  };
};
