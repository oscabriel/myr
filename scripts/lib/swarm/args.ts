/**
 * The swarm's flags, read by a small decoder (the scripts' allow-list grants
 * `effect/process` only, so no `effect/cli`):
 *
 *   --stage <s>              required: a stage `infra/stages.ts` declares
 *   --project <name>         default burrow
 *   --scenario plain|video   default plain
 *   --dry-run                print the plan; claim nothing, start nothing
 *   --json                   print JSON: the plan (dry run) or the run's summary
 *   --allow-demo             required with --stage demo: its burrow family is the recorded take's
 *   --only <handle>…         run only these contributors (repeat, or comma-separate)
 *   --timeout-min <n>        each agent's run timeout, default 20
 *   --view headless|herdr    default headless; herdr is issue 717's, refused until then
 *   --url <origin>           the platform, when not the stage's workers.dev origin
 */
import { Handle, ProjectName } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import { flagValue, stageOf } from "../../../infra/stages.ts";
import type { Stage } from "../../../infra/stages.ts";
import { roster } from "./roster.ts";
import { ScenarioName } from "./scenario.ts";
import { SwarmFailed } from "./workspace.ts";

/** What `bun scripts/swarm.ts` was asked to do. */
export interface SwarmOptions {
  readonly stage: Stage;
  readonly project: ProjectName;
  readonly scenario: ScenarioName;
  readonly dryRun: boolean;
  readonly json: boolean;
  /** The contributors to run; every one when `--only` names none. */
  readonly only: readonly Handle[];
  readonly timeoutMin: number;
  /** The platform's origin, when `--url` names it. */
  readonly url: Option.Option<string>;
}

export const USAGE =
  "bun scripts/swarm.ts --stage <dev-…|demo> [--project burrow] [--scenario plain|video] [--dry-run] [--json] [--allow-demo] [--only <handle>…] [--timeout-min 20] [--view headless] [--url <origin>]";

/** The flags that take a value. */
const VALUED = [
  "--project",
  "--scenario",
  "--stage",
  "--timeout-min",
  "--url",
  "--view",
] as const;

/** The flags that stand alone. */
const SWITCHES = ["--allow-demo", "--dry-run", "--json"] as const;

const failed = (reason: string) => new SwarmFailed({ reason });

/** The handles `--only` names: each value after each `--only`, comma-separated or not. */
const onlyOf = (argv: readonly string[]) =>
  argv.flatMap((arg, at) => {
    if (arg.startsWith("--only=")) {
      return arg.slice("--only=".length).split(",");
    }

    if (arg !== "--only") {
      return [];
    }

    const rest = argv.slice(at + 1);
    const end = rest.findIndex((value) => value.startsWith("--"));

    return (end === -1 ? rest : rest.slice(0, end)).flatMap((value) =>
      value.split(",")
    );
  });

/** The arguments that are flags, with any `=value` cut off. */
const flagsIn = (argv: readonly string[]) =>
  argv.flatMap((arg) =>
    arg.startsWith("--") ? [arg.split("=")[0] ?? arg] : []
  );

const decodeProject = Schema.decodeUnknownOption(ProjectName);

const decodeScenario = Schema.decodeUnknownOption(ScenarioName);

/** The swarm's options from its arguments, or why they don't make a run. */
export const optionsOf = (
  argv: readonly string[]
): Effect.Effect<SwarmOptions, SwarmFailed> =>
  Effect.gen(function* () {
    const known = new Set<string>([...VALUED, ...SWITCHES, "--only"]);
    const strange = flagsIn(argv).filter((flag) => !known.has(flag));

    if (strange.length > 0) {
      return yield* failed(`unknown flag ${strange.join(", ")}: ${USAGE}`);
    }

    // infra's own reading of `--stage`, and its words when it names none.
    const stage = yield* stageOf(argv).pipe(
      Effect.mapError(({ message }) => failed(`${message}. ${USAGE}`))
    );

    if (stage === "demo" && !argv.includes("--allow-demo")) {
      return yield* failed(
        "--stage demo: its burrow family is for the recorded take (804); run it there only with --allow-demo"
      );
    }

    const view = Option.getOrElse(flagValue(argv, "--view"), () => "headless");

    if (view === "herdr") {
      return yield* failed(
        "--view herdr is not built yet (issue 717): run --view headless"
      );
    }

    if (view !== "headless") {
      return yield* failed(`--view ${view}: headless or herdr`);
    }

    const rawProject = Option.getOrElse(
      flagValue(argv, "--project"),
      () => "burrow"
    );

    const project = yield* Effect.fromOption(decodeProject(rawProject)).pipe(
      Effect.mapError(() => failed(`--project ${rawProject} names no project`))
    );

    const rawScenario = Option.getOrElse(
      flagValue(argv, "--scenario"),
      () => "plain"
    );

    const scenario = yield* Effect.fromOption(decodeScenario(rawScenario)).pipe(
      Effect.mapError(() => failed(`--scenario ${rawScenario}: plain or video`))
    );

    const rawTimeout = Option.getOrElse(
      flagValue(argv, "--timeout-min"),
      () => "20"
    );

    const timeoutMin = Number(rawTimeout);

    if (!Number.isInteger(timeoutMin) || timeoutMin < 1) {
      return yield* failed(
        `--timeout-min ${rawTimeout}: a whole number of minutes, 1 or more`
      );
    }

    const named = onlyOf(argv).filter((handle) => handle !== "");

    const only = yield* Effect.forEach(named, (handle) =>
      Effect.fromNullishOr(
        roster.find((contributor) => contributor.handle === handle)?.handle
      ).pipe(
        Effect.mapError(() =>
          failed(
            `--only ${handle} is not in the roster: ${roster.map((contributor) => contributor.handle).join(", ")}`
          )
        )
      )
    );

    if (argv.includes("--only") && only.length === 0) {
      return yield* failed("--only names no contributor");
    }

    return {
      dryRun: argv.includes("--dry-run"),
      json: argv.includes("--json"),
      only: [...new Set(only)].map((handle) => Handle.make(handle)),
      project,
      scenario,
      stage,
      timeoutMin,
      url: Option.map(flagValue(argv, "--url"), (url) =>
        url.replace(/\/+$/u, "")
      ),
    };
  });
