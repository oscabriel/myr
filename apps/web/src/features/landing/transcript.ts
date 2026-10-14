/**
 * Every `remote:` line comes from the one renderer, so it cannot drift from
 * what the gateway sends; git's own lines around them are what
 * `apps/platform/test/core-loop.test.ts` asserts from real git, the landed
 * commit's trailers among them. The example's people are fictional; the
 * tour's screens read the same names.
 */
import { Brand } from "@repo/brand";
import { creditLine } from "@repo/git/trailers";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import { OutOfScope } from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { explain, headline, receiptLine } from "@repo/protocol/render";
import { DateTime, Result } from "effect";
import type { Array } from "effect";

const ASK = AskId.make("parse-iso");

const CLAIMANT = Handle.make("alice");

const HEAD = CommitSha.make("1a2b3c4d5e6f708192a3b4c5d6e7f80912a3b4c5");

/** The example every transcript and tour screen is drawn from: one ask on a fictional project. */
export const EXAMPLE = {
  ask: ASK,
  asker: Handle.make("dora"),
  base: CommitSha.make("0".repeat(40)),
  claimant: CLAIMANT,
  fork: RepoName.make(`datekit--${ASK}--${CLAIMANT}`),
  head: HEAD,
  landed: LandedSha.make("7c9e2f4a6b8d0e1f3a5b7c9d1e3f5a7b9c1d3e5f"),
  /** The path the refused push changed outside the ask's territory. */
  outside: RepoPath.make("README.md"),
  project: ProjectName.make("oscabriel/datekit"),
} as const;

/** The refusal the example push hears, as the gate's shape stage gives it. */
export const EXAMPLE_REFUSALS: Array.NonEmptyReadonlyArray<Refusal> = [
  new OutOfScope({ paths: [EXAMPLE.outside] }),
];

/** The fork's address at a platform, as the claim receipt prints it. */
export const forkRemote = (platformUrl: string) =>
  `${platformUrl.replace(/\/+$/u, "")}/${EXAMPLE.fork}.git`;

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

/** The push the claim receipt tells the answerer to run. */
export const PUSH = `git push ${Brand.slug} HEAD:main`;

/** A push the gate refused at its shape stage, as git prints it. */
export const refusedPush = (platformUrl: string): Transcript => {
  const fork = forkRemote(platformUrl);
  const tag = headline(EXAMPLE_REFUSALS);

  return {
    lines: [
      command(PUSH),
      ...explain(EXAMPLE_REFUSALS).map(remote),
      printed(`To ${fork}`),
      printed(` ! [remote rejected] HEAD -> main (${tag})`),
      printed(`error: failed to push some refs to '${fork}'`),
    ],
    tag,
  };
};

/**
 * Asks for the two credit trailers alone, so git prints exactly the two lines
 * drawn under it; a landing's other trailers (`Ask`, `Verdict`, `Request-Id`)
 * stay out of its output.
 */
export const LANDED_CREDITS =
  "git fetch && git log -1 --format='%(trailers:key=Asked-by,key=Signed-off-by)' origin/main";

/** A push the gate took, then the landing commit's credit once it landed. */
export const landedPush = (): Transcript => ({
  lines: [
    command(PUSH),
    remote(
      Result.getOrElse(
        receiptLine({
          ask: EXAMPLE.ask,
          base: EXAMPLE.base,
          head: EXAMPLE.head,
          outcome: Outcome.cases.Checking.make({ stage: "merge" }),
          project: EXAMPLE.project,
          requestId: RequestId.make(`push-${EXAMPLE.head}`),
        }),
        () => ""
      )
    ),
    command(LANDED_CREDITS),
    printed(`Asked-by: ${creditLine(EXAMPLE.asker)}`),
    printed(`Signed-off-by: ${creditLine(EXAMPLE.claimant)}`),
  ],
});

/** The claim command, as the ask page and the front page spell it. */
export const CLAIM = `${Brand.cli} claim ${EXAMPLE.ask} --project ${EXAMPLE.project}`;

/**
 * The claim's receipt, the words the CLI prints (`apps/cli/src/render.ts`):
 * what is held and until when, the fork, and the three commands that follow.
 */
export const claimReceipt = (claim: ClaimView): Transcript => ({
  lines: [
    command(CLAIM),
    printed(
      `You hold the claim on ${claim.ask} in ${claim.project} until ${DateTime.formatIso(claim.lapsesAt)}; only a push keeps it alive.`
    ),
    printed(`Its fork: ${claim.remote}`),
    printed("Next:"),
    printed(`  git remote add ${Brand.slug} ${claim.remote}`),
    printed(`  ${Brand.cli} check`),
    printed(`  ${PUSH}`),
  ],
});
