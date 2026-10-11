/**
 * swarm: six fictional contributors, on four harnesses, each answer one child
 * of a project's split family on a stage: it plans them, prepares each
 * one's workspace and runs their harnesses.
 *
 *   bun scripts/swarm.ts --stage dev-oscabriel --project oscabriel/burrow --dry-run
 *   bunx varlock run --path apps/platform/ -- bun scripts/swarm.ts --stage dev-oscabriel
 *
 * `--dry-run` reads the project's open asks anonymously and prints the plan:
 * who answers which ask, on which territory, and the command that would
 * start their harness. It claims nothing, starts nothing and needs no token.
 *
 * Without it, each contributor claims their ask as themselves (their token
 * from `SESSION_TOKENS`, a JSON object from token to handle, as the
 * platform's own), reads the ask's page, gets a workspace with a clone of
 * the claim's fork, and is handed to the run loop, six at once. The
 * run's summary goes to `<swarm>/<run>/agents.json` (`SwarmDir`: the state
 * home's `<slug>/swarm/`, outside every checkout), and each claim's fork to
 * the throwaway ledger (`infra/created.ts`). Tokens reach a contributor's
 * processes only through their env, and no line or JSON this prints holds
 * one. Flags: `lib/swarm/args.ts`.
 *
 * `--view herdr` (for the video) runs from a herdr pane: each
 * harness runs interactively in a pane of its own, with a counter pane of
 * claims, pushes and landings (`lib/swarm/views/herdr.ts`). The loop and
 * its outcomes are the same.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { AskListing } from "@repo/protocol/domain/ask";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Envelope } from "@repo/protocol/envelope";
import { Handle, sameHandle } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import {
  Clock,
  Config,
  Console,
  DateTime,
  Effect,
  Option,
  Redacted,
  Result,
  Schema,
  Stdio,
} from "effect";

import { isRecorded, readLedger, recordCreated } from "../infra/created.ts";
import {
  platformOrigin,
  recordedSubdomain,
  repoRoot,
  resources,
  subdomainFile,
} from "../infra/stages.ts";
import type { Stage } from "../infra/stages.ts";
import { optionsOf } from "./lib/swarm/args.ts";
import type { SwarmOptions } from "./lib/swarm/args.ts";
import { runAgent, startCommand } from "./lib/swarm/loop.ts";
import { planSwarm, SwarmPlan } from "./lib/swarm/plan.ts";
import type { Assignment } from "./lib/swarm/plan.ts";
import { brief } from "./lib/swarm/prompt.ts";
import {
  agentsFile,
  AgentsResult,
  runDir,
  SwarmDir,
  writeAgentsResult,
} from "./lib/swarm/results.ts";
import type { AgentRun } from "./lib/swarm/results.ts";
import { roster } from "./lib/swarm/roster.ts";
import { headlessView } from "./lib/swarm/views/headless.ts";
import type { SwarmView } from "./lib/swarm/views/headless.ts";
import { openHerdrView } from "./lib/swarm/views/herdr.ts";
import {
  anonymousEnv,
  cliEntry,
  personEnv,
  prepareWorkspace,
  run,
  scrubbed,
  shellQuoted,
  SwarmFailed,
  TOKEN_VARIABLE,
} from "./lib/swarm/workspace.ts";
import type { Ran } from "./lib/swarm/workspace.ts";

const failed = (reason: string) => new SwarmFailed({ reason });

/** The env var that holds the stage's people: a JSON object from token to handle. */
const SESSIONS_VARIABLE = "SESSION_TOKENS";

/** Where the platform lives: `--url`, or the workers.dev subdomain bootstrap recorded. */
const originOf = (options: SwarmOptions) =>
  Option.match(options.url, {
    onNone: () =>
      recordedSubdomain.pipe(
        Effect.flatMap(Effect.fromOption),
        Effect.mapError(() =>
          failed(
            `no --url, and ${subdomainFile} doesn't record the account's workers.dev subdomain: run bun run bootstrap -- --stage ${options.stage} first`
          )
        ),
        Effect.map((subdomain) => platformOrigin(options.stage, subdomain))
      ),
    onSome: Effect.succeed,
  });

/** One CLI command, run from this repo's source with Bun. */
const cli = (
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
) => run({ args: [cliEntry, ...args], command: "bun", env });

/** A refusal list in one line: `NotVouched, AskFull`. */
const tagsOf = (refusals: readonly Refusal[]) =>
  refusals.map(({ _tag }) => _tag).join(", ");

/** The CLI refused the command: its refusals, for the run's summary. */
class Refused extends Schema.TaggedError<Refused>()("Refused", {
  reason: Schema.String,
  tags: Schema.Array(Schema.String),
}) {
  override get message() {
    return this.reason;
  }
}

/**
 * What one CLI command printed under `--json`, decoded as its envelope: its
 * data, or `Refused` with its refusals. Output that is no envelope fails
 * with what the command printed, `scrub`bed of any secret.
 */
const envelopeOf =
  <A, I>(
    data: Schema.Codec<A, I>,
    what: string,
    scrub: (text: string) => string
  ) =>
  (ran: Ran): Effect.Effect<A, SwarmFailed | Refused> =>
    Effect.gen(function* () {
      const printed = ran.stderr.trim() === "" ? ran.stdout : ran.stderr;

      const envelope: Envelope<A> = yield* Schema.decodeEffect(
        Schema.fromJsonString(Envelope(data))
      )(ran.stdout).pipe(
        Effect.mapError(() =>
          failed(
            scrub(
              `${what} exited ${ran.code} without its JSON: ${printed.trim().slice(0, 500)}`
            )
          )
        )
      );

      if (envelope.ok) {
        return envelope.data;
      }

      return yield* new Refused({
        reason: `${what}: refused ${tagsOf(envelope.refusals)}`,
        tags: envelope.refusals.map(({ _tag }) => _tag),
      });
    });

const isRefused = Schema.is(Refused);

const Listed = Schema.Struct({ asks: Schema.Array(AskListing) });

/** The project's open asks, read anonymously: no token, and no stored login of the user's. */
const listAsks = (origin: string, project: ProjectName) =>
  Effect.gen(function* () {
    const home = `${yield* SwarmDir}/anonymous`;

    const listed = yield* cli(
      ["asks", "--project", project, "--json"],
      anonymousEnv({ configHome: home, platformUrl: origin })
    ).pipe(
      Effect.flatMap(
        envelopeOf(Listed, `asks --project ${project}`, (text) => text)
      ),
      Effect.mapError(({ reason }) => failed(reason))
    );

    return listed.asks;
  });

/** The plan as the terminal shows it: one row per contributor, ending in the command that starts them. */
const planLines = (
  plan: SwarmPlan,
  origin: string,
  swarm: string
): readonly string[] => {
  const rows = plan.assignments.map(({ ask, contributor, territory }) => {
    const dir = `${swarm}/<run>/${contributor.handle}`;

    const command = startCommand({ brief: "<brief>", contributor, dir })
      .map(shellQuoted)
      .join(" ");

    return [
      contributor.handle,
      contributor.harness,
      contributor.model,
      ask,
      territory,
      `cd ${shellQuoted(`${dir}/clone`)} && ${command}`,
    ];
  });

  const header = ["handle", "harness", "model", "ask", "territory", "command"];

  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0))
  );

  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) =>
        column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)
      )
      .join("  ");

  const nudged = plan.assignments.flatMap(({ contributor, nudge }) =>
    nudge === undefined
      ? []
      : [`nudge for ${contributor.handle} (${plan.scenario}): ${nudge}`]
  );

  return [
    `swarm: ${plan.project} on ${plan.stage} (${origin}), scenario ${plan.scenario}, ${plan.assignments.length} contributors`,
    line(header),
    ...rows.map(line),
    `held: ${plan.held.length === 0 ? "none" : plan.held.join(", ")}`,
    ...nudged,
  ];
};

/** A run's name: when it started, to the second, in UTC (`20261008-154500`). */
const runName = Effect.map(DateTime.now, (now) =>
  DateTime.formatIso(now)
    .slice(0, 19)
    .replaceAll(/[-:]/gu, "")
    .replace("T", "-")
);

/** The commit of this repo the swarm runs from. */
const headCommit = Effect.gen(function* () {
  const root = yield* repoRoot;

  const head = yield* run({
    args: ["-C", root, "rev-parse", "HEAD"],
    command: "git",
    env: {},
  });

  return head.code === 0 && head.stdout.trim() !== ""
    ? head.stdout.trim()
    : yield* failed(`git rev-parse HEAD exited ${head.code}`);
});

const decodeSessions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Handle))
);

/**
 * Each contributor's token, by handle, from `SESSION_TOKENS`; a missing
 * person fails before anything is claimed, naming them and never a token.
 */
const tokensFor = (handles: readonly Handle[]) =>
  Effect.gen(function* () {
    const raw = yield* Config.String(SESSIONS_VARIABLE).pipe(
      Effect.mapError(() =>
        failed(
          `no ${SESSIONS_VARIABLE} in the environment: run the swarm under \`bunx varlock run --path apps/platform/ --\`, or with the stage's secrets in the env`
        )
      )
    );

    const sessions = yield* decodeSessions(raw).pipe(
      Effect.mapError(() =>
        failed(`${SESSIONS_VARIABLE} is not a JSON object from token to handle`)
      )
    );

    const tokens = new Map(
      handles.flatMap((handle) => {
        const token = Object.entries(sessions).find(([, person]) =>
          sameHandle(person, handle)
        )?.[0];

        return token === undefined
          ? []
          : [[handle, Redacted.make(token)] as const];
      })
    );

    const missing = handles.filter((handle) => !tokens.has(handle));

    return missing.length === 0
      ? tokens
      : yield* failed(
          `${SESSIONS_VARIABLE} has no session for ${missing.join(", ")}: add each to the stage's ${SESSIONS_VARIABLE} secret (infra/stages.md, "Secrets"), and to the env the swarm runs in, then run the swarm again`
        );
  });

/** Records a claim's fork in the throwaway ledger, once. */
const recordFork = (stage: Stage, claim: ClaimView) =>
  Effect.gen(function* () {
    const namespace = resources(stage).projects;

    const known = isRecorded(yield* readLedger, {
      kind: "repo",
      name: claim.fork,
      namespace,
      stage,
    });

    if (!known) {
      yield* recordCreated({
        at: yield* DateTime.now,
        by: "swarm",
        kind: "repo",
        name: claim.fork,
        namespace,
        stage,
      });
    }
  }).pipe(
    Effect.mapError(({ message }) => failed(`the throwaway ledger: ${message}`))
  );

const Claimed = Schema.Struct({ claim: ClaimView });

const Shown = Schema.Struct({
  ask: Schema.Struct({ id: Schema.NonEmptyString }),
  brief: Schema.NonEmptyString,
});

/**
 * One contributor, from claim to the run loop: claims their ask as
 * themselves, reads its page, makes their workspace and hands it to
 * `runAgent`. A step that fails ends their run as `failed`, with any
 * refusals the claim met; it never stops the others.
 */
const contributorRun = (input: {
  readonly assignment: Assignment;
  readonly options: SwarmOptions;
  readonly origin: string;
  readonly run: string;
  readonly token: Redacted.Redacted;
  readonly view: SwarmView;
}) =>
  Effect.gen(function* () {
    const { assignment, options, origin, token } = input;
    const { contributor } = assignment;
    const { handle } = contributor;
    const started = yield* Clock.currentTimeMillis;
    const configHome = `${yield* runDir(input.run)}/${handle}/config`;
    const env = personEnv({ configHome, platformUrl: origin, token });

    const scrub = (text: string) =>
      scrubbed(text, { env, redacted: [TOKEN_VARIABLE] });

    const setup = Effect.gen(function* () {
      const { claim } = yield* cli(
        ["claim", assignment.ask, "--project", options.project, "--json"],
        env
      ).pipe(
        Effect.flatMap(
          envelopeOf(Claimed, `${handle}: claim ${assignment.ask}`, scrub)
        )
      );

      yield* recordFork(options.stage, claim);

      const page = yield* cli(
        ["ask", assignment.ask, "--project", options.project, "--json"],
        env
      ).pipe(
        Effect.flatMap(
          envelopeOf(Shown, `${handle}: ask ${assignment.ask}`, scrub)
        )
      );

      const workspace = yield* prepareWorkspace({
        claim,
        contributor,
        platformUrl: origin,
        run: input.run,
        token,
      });

      return {
        text: brief({
          ask: assignment.ask,
          askMarkdown: page.brief,
          nudge: Option.fromUndefinedOr(assignment.nudge),
          project: options.project,
          remote: claim.remote,
        }),
        workspace,
      };
    });

    const ready = yield* Effect.result(setup);

    if (Result.isFailure(ready)) {
      const { failure } = ready;
      const ended = yield* Clock.currentTimeMillis;

      yield* Console.error(`${handle}: ${scrub(failure.reason)}`);

      return {
        adapter: contributor.adapter,
        ask: assignment.ask,
        attempts: 0,
        durationMs: ended - started,
        handle,
        harness: contributor.harness,
        model: contributor.model,
        outcome: "failed",
        refusals: Object.fromEntries(
          (isRefused(failure) ? failure.tags : []).map((tag) => [tag, 1])
        ),
      } satisfies AgentRun;
    }

    yield* Console.error(
      `${handle}: claimed ${assignment.ask}; workspace ${ready.success.workspace.dir}`
    );

    return yield* runAgent({
      assignment,
      brief: ready.success.text,
      maxContinuations: 3,
      project: options.project,
      timeoutMs: options.timeoutMin * 60_000,
      view: input.view,
      workspace: ready.success.workspace,
    });
  });

/** One contributor's run as the summary prints it. */
const runLine = ({
  ask,
  attempts,
  handle,
  harness,
  outcome,
  refusals,
}: AgentRun) => {
  const met = Object.entries(refusals)
    .map(([tag, count]) => `${tag}×${count}`)
    .join(", ");

  return `${handle} (${harness}) ${ask}: ${outcome}, ${attempts} attempts${met === "" ? "" : `, refused ${met}`}`;
};

const printJson = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  Effect.flatMap(
    Schema.encodeEffect(Schema.fromJsonString(schema))(value),
    Console.log
  ).pipe(Effect.orDie);

/**
 * `bun scripts/swarm.ts …`: plans the run from the project's open asks; with
 * `--dry-run`, prints the plan (or, with `--json`, the `SwarmPlan`) and
 * stops. Otherwise runs every contributor at once and writes the summary.
 */
export const main = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const options = yield* optionsOf(argv);
    const origin = yield* originOf(options);
    const asks = yield* listAsks(origin, options.project);

    const people =
      options.only.length === 0
        ? roster
        : roster.filter(({ handle }) => options.only.includes(handle));

    const plan = yield* Effect.fromResult(
      planSwarm({
        asks,
        project: options.project,
        roster: people,
        scenario: options.scenario,
        stage: options.stage,
      })
    ).pipe(Effect.mapError(({ message }) => failed(message)));

    const say = (line: string) =>
      options.json ? Effect.void : Console.log(line);

    yield* Effect.forEach(planLines(plan, origin, yield* SwarmDir), say, {
      discard: true,
    });

    if (options.dryRun) {
      yield* say("dry run: nothing claimed, no harness started");

      if (options.json) {
        yield* printJson(SwarmPlan, plan);
      }

      return;
    }

    const tokens = yield* tokensFor(
      plan.assignments.map(({ contributor }) => contributor.handle)
    );

    const name = yield* runName;
    const commit = yield* headCommit;
    const at = yield* DateTime.now;

    const runs = yield* Effect.scoped(
      Effect.gen(function* () {
        const view =
          options.view === "herdr"
            ? yield* openHerdrView({
                contributors: plan.assignments.map(
                  ({ contributor }) => contributor
                ),
                origin,
                project: options.project,
                runDir: yield* runDir(name),
              }).pipe(
                Effect.tap(({ workspace }) =>
                  say(
                    `herdr: workspace ${workspace} holds the panes; close it with herdr workspace close ${workspace}`
                  )
                ),
                Effect.map(({ view: panes }) => panes)
              )
            : headlessView;

        return yield* Effect.forEach(
          plan.assignments,
          (assignment) =>
            Effect.flatMap(
              Effect.fromNullishOr(tokens.get(assignment.contributor.handle)),
              (token) =>
                contributorRun({
                  assignment,
                  options,
                  origin,
                  run: name,
                  token,
                  view,
                })
            ),
          { concurrency: 6 }
        ).pipe(Effect.mapError(() => failed("a contributor lost their token")));
      })
    );

    const result: AgentsResult = {
      at,
      commit,
      project: options.project,
      runs,
      scenario: options.scenario,
      stage: options.stage,
      v: 1,
    };

    yield* writeAgentsResult({ result, run: name }).pipe(
      Effect.mapError(({ message }) => failed(`agents.json: ${message}`))
    );

    yield* Effect.forEach(runs.map(runLine), say, { discard: true });
    yield* say(`summary: ${agentsFile(yield* runDir(name))}`);

    if (options.json) {
      yield* printJson(AgentsResult, result);
    }
  });

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* main(args);
    }).pipe(Effect.provide(BunServices.layer))
  );
}
