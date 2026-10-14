/**
 * A small hand decoder: the scripts' allow-list grants `effect/process` only, so no `effect/cli`.
 *
 *   --stage <s>              required: a stage `infra/stages.ts` declares
 *   --project <name>         default oscabriel/burrow
 *   --scenario plain|video   default plain
 *   --dry-run                print the plan; claim nothing, start nothing
 *   --json                   print JSON: the plan (dry run) or the run's summary
 *   --only <handle>…         run only these contributors (repeat, or comma-separate)
 *   --timeout-min <n>        each agent's run timeout, default 20
 *   --view headless|herdr    default headless; herdr runs each harness in a herdr pane
 *   --url <origin>           the platform, when not the stage's workers.dev origin
 */
import { Handle, ProjectName } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import { flagValue, stageOf } from "../../../infra/stages.ts";
import type { Stage } from "../../../infra/stages.ts";
import { roster } from "./roster.ts";
import { ScenarioName } from "./scenario.ts";
import { SwarmFailed } from "./workspace.ts";

export interface SwarmOptions {
  readonly stage: Stage;
  readonly project: ProjectName;
  readonly scenario: ScenarioName;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly only: readonly Handle[];
  readonly timeoutMin: number;
  readonly view: ViewName;
  readonly url: Option.Option<string>;
}

export const USAGE =
  "bun scripts/swarm.ts --stage <dev-…> [--project oscabriel/burrow] [--scenario plain|video] [--dry-run] [--json] [--only <handle>…] [--timeout-min 20] [--view headless|herdr] [--url <origin>]";

export const ViewName = Schema.Literals(["headless", "herdr"]);

export type ViewName = typeof ViewName.Type;

const decodeView = Schema.decodeUnknownOption(ViewName);

const VALUED = [
  "--project",
  "--scenario",
  "--stage",
  "--timeout-min",
  "--url",
  "--view",
] as const;

const SWITCHES = ["--dry-run", "--json"] as const;

const failed = (reason: string) => new SwarmFailed({ reason });

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

const flagsIn = (argv: readonly string[]) =>
  argv.flatMap((arg) =>
    arg.startsWith("--") ? [arg.split("=")[0] ?? arg] : []
  );

const isValued = (flag: string): flag is (typeof VALUED)[number] =>
  VALUED.some((valued) => valued === flag);

const straysIn = (argv: readonly string[]) => {
  const strays: string[] = [];
  let takes: "none" | "one" | "many" = "none";

  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const bare = !arg.includes("=");

      if (bare && isValued(arg)) {
        takes = "one";
      } else {
        takes = bare && arg === "--only" ? "many" : "none";
      }
    } else if (takes === "none") {
      strays.push(arg);
    } else if (takes === "one") {
      takes = "none";
    }
  }

  return strays;
};

const originOf = (raw: string) =>
  Option.filter(
    Option.liftThrowable((url: string) => new URL(url))(raw),
    ({ protocol }) => protocol === "https:" || protocol === "http:"
  ).pipe(Option.as(raw.replace(/\/+$/u, "")));

const decodeProject = Schema.decodeUnknownOption(ProjectName);

const decodeScenario = Schema.decodeUnknownOption(ScenarioName);

export const optionsOf = (
  argv: readonly string[]
): Effect.Effect<SwarmOptions, SwarmFailed> =>
  Effect.gen(function* () {
    const known = new Set<string>([...VALUED, ...SWITCHES, "--only"]);
    const strange = flagsIn(argv).filter((flag) => !known.has(flag));

    if (strange.length > 0) {
      return yield* failed(`unknown flag ${strange.join(", ")}: ${USAGE}`);
    }

    // A switch read only by its bare spelling: `--dry-run=yes` would
    // otherwise pass as a known flag and leave the run live.
    const switchValue = argv.find((arg) =>
      SWITCHES.some((flag) => arg.startsWith(`${flag}=`))
    );

    if (switchValue !== undefined) {
      return yield* failed(
        `${switchValue.split("=")[0] ?? switchValue} takes no value: ${USAGE}`
      );
    }

    const valueless = VALUED.find(
      (flag) => argv.includes(flag) && Option.isNone(flagValue(argv, flag))
    );

    if (valueless !== undefined) {
      return yield* failed(`${valueless} needs a value: ${USAGE}`);
    }

    const strays = straysIn(argv);

    if (strays.length > 0) {
      return yield* failed(
        `unexpected argument ${strays.join(", ")}: ${USAGE}`
      );
    }

    const stage = yield* stageOf(argv).pipe(
      Effect.mapError(({ message }) => failed(`${message}. ${USAGE}`))
    );

    if (stage === "prod") {
      return yield* failed(
        "--stage prod: the swarm's contributors are fictional, so run it on a dev stage"
      );
    }

    const rawView = Option.getOrElse(
      flagValue(argv, "--view"),
      () => "headless"
    );

    const view = yield* Effect.fromOption(decodeView(rawView)).pipe(
      Effect.mapError(() => failed(`--view ${rawView}: headless or herdr`))
    );

    const rawProject = Option.getOrElse(
      flagValue(argv, "--project"),
      () => "oscabriel/burrow"
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

    const onlyGiven = argv.some(
      (arg) => arg === "--only" || arg.startsWith("--only=")
    );

    if (onlyGiven && only.length === 0) {
      return yield* failed("--only names no contributor");
    }

    const url = yield* Effect.transposeOption(
      Option.map(flagValue(argv, "--url"), (raw) =>
        Effect.fromOption(originOf(raw)).pipe(
          Effect.mapError(() =>
            failed(
              `--url ${raw}: an http(s) origin, such as https://platform.example`
            )
          )
        )
      )
    );

    return {
      dryRun: argv.includes("--dry-run"),
      json: argv.includes("--json"),
      only: [...new Set(only)].map((handle) => Handle.make(handle)),
      project,
      scenario,
      stage,
      timeoutMin,
      url,
      view,
    };
  });
