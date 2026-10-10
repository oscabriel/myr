/**
 * `<cli> today`, written by hand so it can take `--tui`: without it, the
 * command prints Today exactly as the `today` contract's projected command
 * does (the same flags, view, `--json` envelope and refusals); with it, a
 * person at a terminal gets Today full-screen (`run.ts`). It stands in for
 * the projected command, as `init` and `env set` do for theirs, and calls
 * the same contract through the CLI's remote client.
 */
import { Client, Description, TodayOf } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import type { NotDecider, UnknownProject } from "@repo/protocol/refusal";
import { Context, Effect, Option, Schema } from "effect";
import { Command, Flag } from "effect/cli";

import { endRefused, Output } from "../output.ts";
import { views } from "../render.ts";
import { payloadFor, runTodayTui, TuiRefused } from "./run.ts";

const COMMAND = "today";

const encodeToday = Schema.encodeUnknownEffect(TodayOf.successSchema);

/**
 * The `today` contract's refusals, each printed once where the command's
 * refusals go; the command then ends `Reported`, with the refusal's exit code.
 */
const reported = (json: boolean) => {
  const once = (refusal: NotDecider | UnknownProject) =>
    Effect.flatMap(Effect.service(Output), (output) =>
      endRefused(output, { command: COMMAND, json, refusals: [refusal] })
    );

  return { NotDecider: once, UnknownProject: once };
};

/** Today printed once, in the form the invocation policy chose. */
const print = (input: {
  readonly json: boolean;
  readonly project: Option.Option<ProjectName>;
}) =>
  Effect.gen(function* () {
    const client = yield* Client;
    const output = yield* Output;

    const page = yield* client
      .today(payloadFor(input.project))
      .pipe(Effect.catchTags(reported(input.json)));

    const data = yield* Effect.orDie(encodeToday(page));

    const view = Option.getOrElse(views.today(page), () => {
      const text = JSON.stringify(data, null, 2);

      return { markdown: ["```json", text, "```"].join("\n"), text };
    });

    return yield* output.success({
      command: COMMAND,
      data,
      json: input.json,
      view,
    });
  });

/**
 * Today full-screen. `--json` asks for one document for a script, which a
 * screen is not, so the two together are refused like a script's `--tui`.
 */
const full = (input: {
  readonly json: boolean;
  readonly project: Option.Option<ProjectName>;
}) =>
  input.json
    ? Effect.fail(
        new TuiRefused({ reason: "--json asks for one document for a script" })
      )
    : runTodayTui({ project: input.project }).pipe(
        Effect.catchTags(reported(false))
      );

export const today = Command.make(
  COMMAND,
  {
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print one versioned JSON envelope on stdout, and nothing else there"
      )
    ),
    project: Flag.String("project").pipe(
      Flag.withSchema(ProjectName),
      Flag.optional,
      Flag.withDescription(
        "The project whose decisions to show; every project you decide for when left out"
      )
    ),
    tui: Flag.Boolean("tui").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Open Today full-screen and take its decisions with the keyboard; for a person at a terminal"
      )
    ),
  },
  ({ json, project, tui }) =>
    Effect.gen(function* () {
      if (tui) {
        return yield* full({ json, project });
      }

      return yield* print({ json, project });
    }).pipe(Effect.withSpan(`cli.${COMMAND}`))
).pipe(
  Command.withDescription(
    `${Context.get(TodayOf.annotations, Description)} It only reads, unless --tui opens it full-screen to take decisions at a terminal.`
  )
);
