/**
 * `<cli> check`: the gate's answer for HEAD before it is pushed. It runs the
 * gate's own stages 0 and 1 (`@repo/gate`'s `pushStages`) over the facts a
 * push of HEAD to the claim's fork would give the gateway (`localFacts`),
 * under the policy at `main` (`localPolicy`), and prints the same refusals,
 * tag for tag; then it runs the ask's check and the project's lanes on
 * HEAD's tree, in a temp clone, through `CheckRunner` `/local`.
 *
 * Nothing here writes to the repo, its config or its refs, and `--offline`
 * calls no platform: the parse stage then judges a live claim made up for
 * the person checking, and says so on stderr.
 */
import { Brand } from "@repo/brand";
import {
  CheckAt,
  CheckLane,
  CheckRunner,
  outputOf,
  shaOf,
} from "@repo/checks/check-runner";
import type { CheckRun, LaneEvidence } from "@repo/checks/check-runner";
import { CheckRunnerLocal } from "@repo/checks/check-runner/local";
import { commandFor } from "@repo/checks/kinds";
import { lintToZeroCount } from "@repo/checks/kinds/lint-to-zero";
import { PushTarget } from "@repo/gate/facts";
import { pushStages, runGate } from "@repo/gate/gate";
import { Client } from "@repo/protocol/contracts";
import { LaneResult } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { ClaimView } from "@repo/protocol/domain/claim";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import {
  ChecksFailed,
  NoAsk,
  Refusal,
  UnknownAsk,
  VerifierBlocked,
} from "@repo/protocol/refusal";
import {
  Array,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Option,
  Path,
  Record,
  Schema,
  Stream,
} from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { Credentials } from "../credentials.ts";
import { Output, Reported } from "../output.ts";
import { repoContext } from "../repo-context.ts";
import type { RepoContext } from "../repo-context.ts";
import { commitOf, localFacts, outsideAnyHook, runGit } from "./facts.ts";
import {
  ConfigBundler,
  ConfigBundlerBun,
  localPolicy,
} from "./local-policy.ts";
import { staleGenerated } from "./stale.ts";
import type { StaleCopy } from "./stale.ts";

const COMMAND = "check";

/** A generated file in the working copy that main's config no longer gives (`stale.ts`). */
const Stale = Schema.Struct({
  /** The landing the copy says it came from, when it names one. */
  landed: Schema.optionalKey(LandedSha),
  path: Schema.String,
});

/**
 * What `check --json` prints on success: the ask, the diff it judged, each
 * lane, and the generated files that are out of date, when any are.
 */
const Checked = Schema.Struct({
  ask: AskId,
  base: CommitSha,
  head: CommitSha,
  lanes: Schema.Array(LaneResult),
  /** The last stage that ran: `shape` with `--shape-only`, else `checks`. */
  stage: Schema.Literals(["shape", "checks"]),
  stale: Schema.optionalKey(Schema.NonEmptyArray(Stale)),
});

type Checked = typeof Checked.Type;

const encodeChecked = Schema.encodeEffect(Checked);

const isRefusal = Schema.is(Refusal);

/** The handle a check stands in for when nobody is signed in and no fork names one. */
const SOMEONE = Handle.make("you");

const asHandle = Schema.decodeOption(Handle);

/** A claim that holds the fork open: `live`, or `warned` and not yet lapsed. */
const isLive = (claim: ClaimView) =>
  claim.state === "live" || claim.state === "warned";

/** Prints `text` on stderr, then ends the command: it has said why. */
const stop = (text: string) =>
  Output.use((output) =>
    Effect.andThen(output.note(text), Effect.fail(new Reported()))
  );

/** Prints `refusals` the way every command does, then ends the command. */
const refuse = (
  json: boolean,
  refusals: Array.NonEmptyReadonlyArray<Refusal>
) =>
  Output.use((output) =>
    Effect.andThen(
      output.refused({ command: COMMAND, json, refusals }),
      Effect.fail(new Reported())
    )
  );

/**
 * What a stale copy is told: which file, the landing it names, why it can
 * differ (an older config or a hand edit; the copy alone can't say which),
 * and how to get a current one.
 */
const staleNote = ({ landed, path }: StaleCopy) =>
  `${path} differs from what main's config gives${Option.match(landed, {
    onNone: () => "",
    onSome: (sha) => ` (it says it was generated at ${sha})`,
  })}: it was generated for an older config, or edited by hand. The platform regenerates it whenever the config changes; pull main for the current copy instead of editing it.`;

/** The stale copies as `--json` lists them: absent when there are none. */
const staleField = (stale: readonly StaleCopy[]) =>
  Array.match(stale, {
    onEmpty: () => ({}),
    onNonEmpty: (copies) => ({
      stale: Array.map(copies, ({ landed, path }) =>
        Option.match(landed, {
          onNone: () => ({ path }),
          onSome: (sha) => ({ landed: sha, path }),
        })
      ),
    }),
  });

/** The signed-in profile's handle, when `login` learned one. */
const signedInHandle = Effect.flatMap(
  Effect.serviceOption(Credentials),
  Option.match({
    onNone: () => Effect.succeedNone,
    onSome: (credentials) =>
      Effect.map(credentials.current, (profile) =>
        Option.flatMap(profile, ({ handle }) => Option.fromUndefinedOr(handle))
      ),
  })
);

/** The project and ask a check is for: the flags', else the remote's. */
const subjectOf = (
  context: RepoContext,
  flags: {
    readonly ask: Option.Option<AskId>;
    readonly project: Option.Option<ProjectName>;
  },
  json: boolean
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const { repo } = context;

    const project = Option.orElse(flags.project, () =>
      Option.map(repo, (ref) => ref.project)
    );

    if (Option.isNone(project)) {
      return yield* stop(
        "No project: this repo has no remote on the platform. Name it with --project <name>."
      );
    }

    if (Option.isSome(flags.ask)) {
      return { ask: flags.ask.value, project: project.value };
    }

    const inferred = Option.flatMap(repo, (ref) =>
      Option.fromUndefinedOr(ref.ask)
    );

    if (Option.isNone(inferred)) {
      return yield* refuse(json, [new NoAsk({})]);
    }

    const remote = Option.match(context.remote, {
      onNone: () => "its remote",
      onSome: ({ name, url }) => `the remote ${name} (${url})`,
    });

    yield* output.note(
      `Checking the ask ${inferred.value}, which ${remote} names; pass --ask to check another.`
    );

    return { ask: inferred.value, project: project.value };
  });

/** The caller's claims in `project`, as the platform's `status` lists them. */
const claimsOn = (project: ProjectName, json: boolean) =>
  Effect.gen(function* () {
    const client = yield* Client;

    return yield* client.status({ project }).pipe(
      Effect.map(({ claims }) =>
        claims.filter((claim) => claim.project === project)
      ),
      Effect.catch((error) =>
        isRefusal(error)
          ? refuse(json, [error])
          : stop(
              `The platform could not say which claims you hold (${String(error)}). Run with --offline to check against a made-up claim.`
            )
      )
    );
  });

/**
 * Where the diff starts: `--base` when given; else the live claim's base,
 * which is what the gateway diffs a push to the claim's fork from (so an
 * answer committed on the clone's own main is still seen), when this repo
 * holds that commit; else `main`.
 */
const baseOf = (
  root: string,
  given: Option.Option<string>,
  claim: Option.Option<ClaimView>
) =>
  Effect.gen(function* () {
    if (Option.isSome(given)) {
      return given.value;
    }

    if (Option.isNone(claim)) {
      return "main";
    }

    const { base } = claim.value;
    const held = yield* Effect.exit(commitOf(root, base));

    if (Exit.isSuccess(held)) {
      return base;
    }

    yield* Output.use((output) =>
      output.note(
        `Your claim was made at ${base}, which this repo doesn't have, so the diff starts at main; fetch the project's main, or pass --base.`
      )
    );

    return "main";
  });

/**
 * A live claim on `ask` by `claimant`, as the platform would hold one just
 * made: the parse stage's stand-in when the check runs offline.
 */
const syntheticClaim = (input: {
  readonly ask: Ask;
  readonly claimant: Handle;
  readonly fork: RepoName;
  /** The platform the repo's remote reaches, which serves the fork. */
  readonly origin: Option.Option<string>;
  readonly policy: Policy;
}) =>
  Effect.map(DateTime.now, (now): ClaimView => {
    const { ask, claimant, fork, policy } = input;

    return {
      ask: ask.id,
      base: policy.at,
      checkCommand: `${Brand.cli} ${COMMAND} --ask ${ask.id}`,
      claimant,
      fork,
      lapsesAt: DateTime.addDuration(
        now,
        Duration.millis(policy.claims.lapseAfterMs)
      ),
      openedAt: now,
      project: ask.project,
      remote: Option.match(input.origin, {
        onNone: () => `${fork}.git`,
        onSome: (origin) => `${origin}/${fork}.git`,
      }),
      state: "live",
      warnsAt: DateTime.addDuration(
        now,
        Duration.millis(policy.claims.warnAfterMs)
      ),
    };
  });

/**
 * The lanes an answer's checks run: the ask's own check, then every project
 * lane. A `lintToZero` ask's lane hands back what its lint printed, since
 * its count, not its exit code, judges it.
 */
const lanesOf = (policy: Policy, ask: Ask): readonly CheckLane[] => [
  ...Option.toArray(
    Option.map(
      commandFor(ask.check, policy.run, policy.ratchets),
      ({ command, lane }) =>
        CheckSpec.guards.LintToZero(ask.check)
          ? CheckLane.make({ command, lane, output: "stdout" })
          : CheckLane.make({ command, lane })
    )
  ),
  ...Record.toEntries(policy.run.checks).map(([lane, command]) =>
    CheckLane.make({ command, lane })
  ),
];

/**
 * The run with a `lintToZero` ask's lane as its count decides it, as the
 * platform's Answer Workflow does (`countedAskLane` in
 * `apps/platform/src/workflows/answer/lanes.ts`): passed at zero findings
 * of its rule in its territory, failed above (its evidence says how many),
 * a load error when its lint printed no count. A lane that never got going
 * stays as it ran.
 */
const countedAskLane = (
  policy: Policy,
  ask: Ask,
  ran: CheckRun
): Effect.Effect<CheckRun> => {
  const { check } = ask;

  const lane = Option.map(
    commandFor(check, policy.run, policy.ratchets),
    (found) => found.lane
  );

  const result = Option.flatMap(lane, (name) =>
    Array.findFirst(ran.lanes, (each) => each.lane === name)
  );

  if (
    !CheckSpec.guards.LintToZero(check) ||
    Option.isNone(result) ||
    result.value.result === "blocked"
  ) {
    return Effect.succeed(ran);
  }

  const counted = result.value;

  const replaced = (
    outcome: LaneResult["result"],
    evidence: Option.Option<LaneEvidence>
  ): CheckRun => ({
    ...ran,
    evidence: [
      ...ran.evidence.filter((each) => each.lane !== counted.lane),
      ...Option.toArray(evidence),
    ],
    lanes: ran.lanes.map((each) =>
      each.lane === counted.lane ? { ...counted, result: outcome } : each
    ),
  });

  return Effect.fromOption(outputOf(ran, counted.lane)).pipe(
    Effect.flatMap((stdout) =>
      lintToZeroCount({
        asked: ask.territory,
        check,
        modules: policy.modules,
        stdout,
      })
    ),
    Effect.map((count) =>
      count === 0
        ? replaced("passed", Option.none())
        : replaced(
            "failed",
            Option.some({
              lane: counted.lane,
              signature: `${check.rule}: ${count} in ${check.territory ?? ask.territory.module}`,
            })
          )
    ),
    Effect.orElseSucceed(() =>
      replaced("loadError", Option.some({ lane: counted.lane }))
    )
  );
};

/** The last lines of a setup's output, for the note that says why it failed. */
const TAIL = 4000;

/**
 * HEAD's tree in a temp clone the scope removes: it borrows the repo's
 * objects (`--shared`), so nothing is copied or written back, runs no hook,
 * and gets the run block's `setup` (the Checker's install step) before any
 * lane runs. Setup's output goes to stderr only when it fails, so `--json`
 * stdout stays one document.
 */
const checkoutOf = (input: {
  readonly root: string;
  readonly setup: Option.Option<string>;
  readonly note: (text: string) => Effect.Effect<void>;
}) =>
  Effect.fnUntraced(
    function* (at: CheckAt) {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const folder = yield* fs.makeTempDirectoryScoped({
        prefix: "check-tree-",
      });

      const tree = path.join(folder, "tree");

      const sha = shaOf(at);

      const steps = [
        ["clone", "--shared", "--no-checkout", "--quiet", input.root, tree],
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-C",
          tree,
          "checkout",
          "--quiet",
          "--detach",
          sha,
        ],
      ];

      for (const args of steps) {
        const ran = yield* runGit(folder, args);

        if (ran.exitCode !== 0) {
          yield* input.note(`Could not check out ${sha}: ${ran.stderr.trim()}`);

          return yield* new VerifierBlocked({});
        }
      }

      if (Option.isNone(input.setup)) {
        return tree;
      }

      yield* input.note(`Setting up: ${input.setup.value}`);

      const [out, err, code] = yield* Effect.scoped(
        Effect.flatMap(
          spawner.spawn(
            ChildProcess.make("sh", ["-c", input.setup.value], {
              cwd: tree,
              env: outsideAnyHook,
              extendEnv: true,
              stdin: "ignore",
            })
          ),
          (child) =>
            Effect.all(
              [
                Stream.mkString(Stream.decodeText(child.stdout)),
                Stream.mkString(Stream.decodeText(child.stderr)),
                child.exitCode,
              ],
              { concurrency: "unbounded" }
            )
        )
      );

      if (Number(code) !== 0) {
        yield* input.note(
          `Setup exited with ${code}:\n${`${out}${err}`.slice(-TAIL).trimEnd()}`
        );

        return yield* new VerifierBlocked({});
      }

      return tree;
    },
    (effect) =>
      effect.pipe(
        Effect.catchTags({
          NotARepo: () => Effect.fail(new VerifierBlocked({})),
          PlatformError: () => Effect.fail(new VerifierBlocked({})),
        })
      )
  );

/** The run as a person reads it: each lane and how it ended. */
const viewOf = (checked: Checked) => {
  const lines = [
    `${checked.ask} at ${checked.head.slice(0, 12)}: the gate's shape stage has nothing to say.`,
    ...checked.lanes.map(
      ({ durationMs, lane, result }) =>
        `  ${lane}: ${result} (${durationMs} ms)`
    ),
  ];

  return {
    markdown: [
      `**${checked.ask}** at \`${checked.head.slice(0, 12)}\`: the gate's shape stage has nothing to say.`,
      "",
      ...checked.lanes.map(
        ({ durationMs, lane, result }) =>
          `- \`${lane}\`: ${result} (${durationMs} ms)`
      ),
    ].join("\n"),
    text: lines.join("\n"),
  };
};

export const check = Command.make(
  COMMAND,
  {
    ask: Flag.String("ask").pipe(
      Flag.withSchema(AskId),
      Flag.optional,
      Flag.withDescription(
        "The ask to check against; the claim fork's remote names it when left out"
      )
    ),
    base: Flag.String("base").pipe(
      Flag.optional,
      Flag.withDescription(
        "Main as you have it: the policy is read here, and the diff starts at its merge base with HEAD. Defaults to your live claim's base, as the gateway diffs, else main"
      )
    ),
    dir: Flag.Directory("dir", { mustExist: true }).pipe(
      Flag.withAlias("C"),
      Flag.optional,
      Flag.withDescription("Run as if started in this folder, as git -C does")
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print machine-readable JSON")
    ),
    lane: Flag.String("lane").pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        "Run only this lane (repeat for more); every lane when left out"
      )
    ),
    noLanes: Flag.Boolean("shape-only").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Stop after the gate's shape stage: run no lanes")
    ),
    offline: Flag.Boolean("offline").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Call no platform: judge as if you held a live claim on the ask"
      )
    ),
    project: Flag.String("project").pipe(
      Flag.withSchema(ProjectName),
      Flag.optional,
      Flag.withDescription(
        "The project; the repo's remote names it when left out"
      )
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const output = yield* Output;
      const path = yield* Path.Path;
      const { json } = flags;
      const cwd = path.resolve(Option.getOrElse(flags.dir, () => "."));

      const context = yield* repoContext(cwd).pipe(
        Effect.catchTag("NotARepo", (failure) => stop(failure.message))
      );

      const { ask: askId, project } = yield* subjectOf(context, flags, json);

      const claims = flags.offline
        ? Option.none<readonly ClaimView[]>()
        : Option.some(yield* claimsOn(project, json));

      const claim = Option.flatMap(claims, (held) =>
        Array.findFirst(held, (each) => each.ask === askId)
      );

      // Who pushes: the signed-in person, else the claimant the platform
      // names, else the person the fork is named for.
      const handle = Option.getOrElse(
        Option.firstSomeOf([
          yield* signedInHandle,
          Option.map(claim, ({ claimant }) => claimant),
          Option.flatMap(context.repo, ({ handle: forkOf }) =>
            Option.flatMap(Option.fromUndefinedOr(forkOf), asHandle)
          ),
        ]),
        () => SOMEONE
      );

      const base = yield* baseOf(context.root, flags.base, claim);

      const bundler = yield* Effect.serviceOption(ConfigBundler);

      const policy = yield* localPolicy(context.root, base, {
        initializer: handle,
        project,
      }).pipe(
        Option.match(bundler, {
          onNone: () => Effect.provide(ConfigBundlerBun),
          onSome: (found) => Effect.provideService(ConfigBundler, found),
        }),
        Effect.catchTag("RulesFailed", (failure) =>
          stop(
            `The policy at ${base} did not evaluate (${failure.reason}): ${failure.detail}`
          )
        )
      );

      // Copies of the generated agent files main's config no longer gives.
      const stale = yield* staleGenerated({
        landed: policy.at,
        policy,
        project,
        root: context.root,
      });

      yield* Effect.forEach(stale, (copy) => output.note(staleNote(copy)), {
        discard: true,
      });

      const ask = Array.findFirst(policy.asks, ({ id }) => id === askId);

      if (Option.isNone(ask)) {
        return yield* refuse(json, [new UnknownAsk({ ask: askId })]);
      }

      // The claim's fork, named as the platform names it.
      const fork = RepoName.make(
        `${project}--${askId}--${handle.toLowerCase()}`
      );

      const facts = yield* localFacts({
        ask,
        base,
        claim: flags.offline
          ? Option.some(
              yield* syntheticClaim({
                ask: ask.value,
                claimant: handle,
                fork,
                origin: context.origin,
                policy,
              })
            )
          : claim,
        claimsHeld: Option.match(claims, {
          onNone: () => 1,
          onSome: (held) => held.filter(isLive).length,
        }),
        head: "HEAD",
        policy,
        pusher: Person.make({ handle }),
        root: context.root,
        target: PushTarget.ClaimFork({ ask: askId, claimant: handle, project }),
      }).pipe(
        Effect.catchTags({
          NotARepo: (failure) => stop(failure.message),
          RepoNotFound: () =>
            stop(`${context.root} could not be read as a git repo.`),
          UnknownRevision: (failure) => stop(failure.message),
        })
      );

      if (flags.offline) {
        yield* output.note(
          `Offline: the parse stage judged a live claim on ${askId} made up for ${handle}; the platform judges the claim you hold.`
        );
      }

      const refused = yield* runGate(pushStages, facts);

      if (Option.isSome(refused)) {
        return yield* refuse(json, refused.value);
      }

      const judged = { ask: askId, base: facts.base, head: facts.head };

      if (flags.noLanes) {
        const checked: Checked = {
          ...judged,
          lanes: [],
          stage: "shape",
          ...staleField(stale),
        };

        return yield* output.success({
          command: COMMAND,
          data: yield* Effect.orDie(encodeChecked(checked)),
          json,
          view: viewOf(checked),
        });
      }

      // Only what the checkout uses: the runner's own scope, not this
      // command's, keeps each job's temp clone.
      const services = Context.make(
        ChildProcessSpawner.ChildProcessSpawner,
        yield* ChildProcessSpawner.ChildProcessSpawner
      ).pipe(
        Context.add(FileSystem.FileSystem, yield* FileSystem.FileSystem),
        Context.add(Path.Path, path)
      );

      const all = lanesOf(policy, ask.value);

      const lanes =
        flags.lane.length === 0
          ? all
          : all.filter(({ lane }) => flags.lane.includes(lane));

      const unknown = flags.lane.filter(
        (wanted) => !all.some(({ lane }) => lane === wanted)
      );

      if (unknown.length > 0) {
        return yield* stop(
          `No lane named ${unknown.join(", ")}; this project's lanes are ${all.map(({ lane }) => lane).join(", ")}.`
        );
      }

      const run = yield* CheckRunner.use((runner) =>
        runner.run({
          at: CheckAt.cases.Commit.make({ commit: facts.head }),
          lanes,
          placeholders: [],
          project,
          proxies: [],
          repo: fork,
          run: policy.run,
        })
      ).pipe(
        Effect.provide(
          CheckRunnerLocal.layer({
            checkout: (at) =>
              checkoutOf({
                note: output.note,
                root: context.root,
                setup: Option.fromUndefinedOr(policy.run.setup),
              })(at).pipe(Effect.provide(services)),
          })
        ),
        Effect.catchTag("VerifierBlocked", (blocked) =>
          refuse(json, [blocked])
        ),
        Effect.flatMap((ran) => countedAskLane(policy, ask.value, ran))
      );

      const failed = run.lanes.flatMap(({ command, lane, result }) =>
        result === "passed"
          ? []
          : [new ChecksFailed({ lane, logRef: `local:${lane}`, next: command })]
      );

      for (const evidence of run.evidence) {
        if (evidence.signature !== undefined) {
          yield* output.note(`${evidence.lane} failed: ${evidence.signature}`);
        }
      }

      if (Array.isReadonlyArrayNonEmpty(failed)) {
        return yield* refuse(json, failed);
      }

      const checked: Checked = {
        ...judged,
        lanes: run.lanes,
        stage: "checks",
        ...staleField(stale),
      };

      return yield* output.success({
        command: COMMAND,
        data: yield* Effect.orDie(encodeChecked(checked)),
        json,
        view: viewOf(checked),
      });
    })
).pipe(
  Command.withDescription(
    "Run the gate's checks on your answer locally, before you push."
  )
);
