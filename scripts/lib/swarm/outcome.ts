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

const StatusData = Schema.Struct({
  answers: Schema.Array(AnswerView),
  claims: Schema.Array(ClaimView),
});

const decodeStatus = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(StatusData))
);

export interface AskStatus {
  readonly claim: Option.Option<ClaimView>;
  // Oldest first: one session can push several before it settles.
  readonly answers: readonly AnswerView[];
  readonly answer: Option.Option<AnswerView>;
}

export const workspaceCli = (workspace: Pick<AgentWorkspace, "dir">) =>
  `${workspace.dir}/bin/${Brand.cli}`;

const oldestFirst = (answers: readonly AnswerView[]) =>
  Array.sort(
    answers,
    Order.mapInput(Order.Number, ({ at }: AnswerView) => at.epochMilliseconds)
  );

export interface StatusQuery {
  readonly workspace: AgentWorkspace;
  readonly project: Option.Option<ProjectName>;
  readonly ask: AskId;
}

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

export const POLL_MS = 5000;

// One bad read in a run of hundreds should not end a contributor's run.
export const STATUS_RETRIES = 5;

// Never gives up on its own: the run's timeout (`loop.ts`) bounds it.
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
