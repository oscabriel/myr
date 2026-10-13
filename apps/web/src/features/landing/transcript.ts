/**
 * Every `remote:` line comes from the one renderer, so it cannot drift from
 * what the gateway sends; git's own lines around them are what
 * `apps/platform/test/core-loop.test.ts` asserts from real git, the landed
 * commit's trailers among them.
 */
import { Brand } from "@repo/brand";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CommitSha,
  ProjectName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import { OutOfScope } from "@repo/protocol/refusal";
import { explain, headline, receiptLine } from "@repo/protocol/render";
import { Result } from "effect";

const ASK = AskId.make("parse-iso");

const FORK = `datekit--${ASK}--alice.git`;

const refusals = [
  new OutOfScope({ paths: [RepoPath.make("README.md")] }),
] as const;

/** A command typed after `$`, a line the platform sent through git, or one git printed itself. */
export interface TranscriptLine {
  readonly kind: "command" | "remote" | "printed";
  readonly text: string;
}

export interface Transcript {
  readonly lines: readonly TranscriptLine[];
  /** The refusal's tag, drawn in the refused colour wherever it is printed. */
  readonly tag?: string;
}

const command = (text: string): TranscriptLine => ({ kind: "command", text });

const remote = (text: string): TranscriptLine => ({ kind: "remote", text });

const printed = (text: string): TranscriptLine => ({ kind: "printed", text });

/** A push the gate refused at its shape stage, as git prints it. */
export const refusedPush = (platformUrl: string): Transcript => {
  const fork = `${platformUrl.replace(/\/+$/u, "")}/${FORK}`;
  const tag = headline(refusals);

  return {
    lines: [
      command("git push"),
      ...explain(refusals).map(remote),
      printed(`To ${fork}`),
      printed(` ! [remote rejected] HEAD -> main (${tag})`),
      printed(`error: failed to push some refs to '${fork}'`),
    ],
    tag,
  };
};

const credited = (handle: string) =>
  `${handle} <${handle}@users.${Brand.domain}>`;

const HEAD = CommitSha.make("1a2b3c4d5e6f708192a3b4c5d6e7f80912a3b4c5");

/** A push the gate took, then the landing commit's credit once it landed. */
export const landedPush = (): Transcript => ({
  lines: [
    command("git push"),
    remote(
      Result.getOrElse(
        receiptLine({
          ask: ASK,
          base: CommitSha.make("0".repeat(40)),
          head: HEAD,
          outcome: Outcome.cases.Checking.make({ stage: "merge" }),
          project: ProjectName.make("oscabriel/datekit"),
          requestId: RequestId.make(`push-${HEAD}`),
        }),
        () => ""
      )
    ),
    command("git fetch && git log -1 --format=%(trailers) origin/main"),
    printed(`Asked-by: ${credited("dora")}`),
    printed(`Signed-off-by: ${credited("alice")}`),
  ],
});
