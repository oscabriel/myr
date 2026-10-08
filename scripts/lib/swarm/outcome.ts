/**
 * Where a contributor's answer stands, as the platform says it: their
 * `<cli> status --json`, run in their workspace as them, decoded with
 * protocol's `Envelope`. The verdict loop (`loop.ts`) reads outcomes only
 * here, never from what a harness printed.
 */
import { Brand } from "@repo/brand";
import { AnswerView } from "@repo/protocol/domain/answer";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Outcome } from "@repo/protocol/domain/outcome";
import { Envelope } from "@repo/protocol/envelope";
import type { AskId, CommitSha, ProjectName } from "@repo/protocol/ids";
import {
  Array,
  Duration,
  Effect,
  Option,
  Order,
  Schedule,
  Schema,
} from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { run, scrubbed, SwarmFailed } from "./workspace.ts";
import type { AgentWorkspace } from "./workspace.ts";

/** What the swarm reads of `status`: the caller's claims and answers. */
const StatusData = Schema.Struct({
  answers: Schema.Array(AnswerView),
  claims: Schema.Array(ClaimView),
});

const decodeStatus = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(StatusData))
);

/** One ask, as the contributor's status shows it. */
export interface AskStatus {
  /** Their claim on the ask, while status lists it. */
  readonly claim: Option.Option<ClaimView>;
  /**
   * Every answer of theirs to the ask, oldest first: one session can push
   * several before it settles.
   */
  readonly answers: readonly AnswerView[];
  /** Their latest answer to the ask: the last of `answers`. */
  readonly answer: Option.Option<AnswerView>;
}

/** The CLI in the workspace's `bin/`: the shim the contributor's harness runs too. */
export const workspaceCli = (workspace: Pick<AgentWorkspace, "dir">) =>
  `${workspace.dir}/bin/${Brand.cli}`;

/** `answers` oldest first, by `at`; of two at the same instant, the one listed first. */
const oldestFirst = (answers: readonly AnswerView[]) =>
  Array.sort(
    answers,
    Order.mapInput(Order.Number, ({ at }: AnswerView) => at.epochMilliseconds)
  );

/** How one status read is asked: whose workspace, and which ask (in which project, when known). */
export interface StatusQuery {
  readonly workspace: AgentWorkspace;
  /** Without one, status lists every project's claims and answers. */
  readonly project: Option.Option<ProjectName>;
  readonly ask: AskId;
}

/**
 * The contributor's claim on `ask` and their latest answer to it, from
 * `<cli> status [--project <p>] --json` run in their clone with their env.
 * A status that refuses, or prints no envelope, fails `SwarmFailed`, its
 * text scrubbed of the token.
 */
export const readStatus = (
  query: StatusQuery
): Effect.Effect<
  AskStatus,
  SwarmFailed,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const { ask, workspace } = query;

    const ran = yield* run({
      args: [
        "status",
        ...Option.match(query.project, {
          onNone: () => [],
          onSome: (project) => ["--project", project],
        }),
        "--json",
      ],
      command: workspaceCli(workspace),
      cwd: workspace.clone,
      env: workspace.env,
    });

    const envelope = yield* decodeStatus(ran.stdout).pipe(
      Effect.mapError(
        () =>
          new SwarmFailed({
            reason: scrubbed(
              `status exited ${ran.code} without its JSON: ${(ran.stderr.trim() === "" ? ran.stdout : ran.stderr).trim().slice(0, 500)}`,
              workspace
            ),
          })
      )
    );

    if (!envelope.ok) {
      return yield* new SwarmFailed({
        reason: `status refused: ${envelope.refusals.map(({ _tag }) => _tag).join(", ")}`,
      });
    }

    const answers = oldestFirst(
      envelope.data.answers.filter((answer) => answer.ask === ask)
    );

    return {
      answer: Array.last(answers),
      answers,
      claim: Array.findLast(envelope.data.claims, (claim) => claim.ask === ask),
    };
  });

/**
 * The contributor's latest answer to `ask`, with its head and outcome: the
 * outcome the verdict loop acts on.
 */
export const readOutcome = (
  query: StatusQuery
): Effect.Effect<
  Option.Option<{ readonly head: CommitSha; readonly outcome: Outcome }>,
  SwarmFailed,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.map(readStatus(query), ({ answer }) =>
    Option.map(answer, ({ head, outcome }) => ({ head, outcome }))
  );

/** How often a run that is still being checked is asked again. */
export const POLL_MS = 5000;

/**
 * How many times a status read that fails (the platform briefly down, a
 * request dropped) is asked again, `pollMs` apart, before the run fails:
 * one bad read in a run of hundreds should not end a contributor's run.
 */
export const STATUS_RETRIES = 5;

/**
 * Reads the ask's status until its latest answer is no longer `Checking`:
 * landed, refused or waiting on someone, or no answer at all. It asks
 * every `pollMs`, asks again up to `STATUS_RETRIES` times when a read
 * fails, and never gives up on its own: the run's timeout (`loop.ts`)
 * bounds it.
 */
export const awaitSettledOutcome = (
  query: StatusQuery & { readonly pollMs?: number }
): Effect.Effect<
  AskStatus,
  SwarmFailed,
  ChildProcessSpawner.ChildProcessSpawner
> => {
  const checking = ({ answer }: AskStatus) =>
    Option.exists(answer, ({ outcome }) => Outcome.guards.Checking(outcome));

  const every = Schedule.spaced(Duration.millis(query.pollMs ?? POLL_MS));

  return readStatus(query).pipe(
    Effect.retry({ schedule: every, times: STATUS_RETRIES }),
    Effect.repeat({ schedule: every, while: checking })
  );
};
