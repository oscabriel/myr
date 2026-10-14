// Stands in for the `openAsk` contract: with no --files, the ask file and
// the check it names are read from the working tree.
import { Brand } from "@repo/brand";
import { ApprovalNeeded } from "@repo/protocol/cli";
import { Client, OpenAsk } from "@repo/protocol/contracts";
import { ConfigFile } from "@repo/protocol/domain/common";
import { AskId, ProjectName } from "@repo/protocol/ids";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { Output } from "../output.ts";
import { repoContext } from "../repo-context.ts";
import { projectOf, reportRefusals, usage, WorkingDirectory } from "./why.ts";

const COMMAND = "ask open";

type Payload = typeof OpenAsk.payloadSchema.Type;

const Files = Schema.NonEmptyArray(ConfigFile);

const decodePayload = Schema.decodeUnknownEffect(OpenAsk.payloadSchema);

const encodePayload = Schema.encodeEffect(OpenAsk.payloadSchema);

const encodeSuccess = Schema.encodeEffect(OpenAsk.successSchema);

export const askFileOf = (ask: AskId) =>
  `${Brand.configDir}/asks/${ask}.ask.ts`;

// The ask names its check as one string literal, `path: "test/asks/x.test.ts"`,
// as the SDK's `kinds.*.ask({ path })` takes it; the platform evaluates the
// file itself before it lands anything.
const CHECK_PATH = /\bpath:\s*(?<quote>["'`])(?<path>[^"'`\n]+)\k<quote>/u;

const readOr = (file: string, missing: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs
      .readFileString(file)
      .pipe(Effect.catchTag("PlatformError", () => usage(missing)))
  );

/** The ask's own file, then the check it names, both as the working tree has them. */
export const filesInTree = (root: string, ask: AskId) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const askFile = askFileOf(ask);

    const askText = yield* readOr(
      path.join(root, askFile),
      `No ask file at ${askFile}: write the ask there, or pass --files.`
    );

    const check = CHECK_PATH.exec(askText)?.groups?.path;

    if (check === undefined) {
      return yield* usage(
        `${askFile} names no check: give it a path, as in path: "test/asks/${ask}.test.ts", or pass --files.`
      );
    }

    const checkText = yield* readOr(
      path.join(root, check),
      `${askFile} names the check ${check}, which is not in the working tree: write the failing test there, or pass --files.`
    );

    return [
      { content: askText, path: askFile },
      { content: checkText, path: check },
    ];
  });

const viewOf = (ask: AskId, project: ProjectName, landed: string) => {
  const said = `Opened ${ask} in ${project}; its file landed as ${landed.slice(0, 7)}. Anyone admitted may now take it: ${Brand.cli} claim ${ask} --project ${project}.`;

  return { markdown: said, text: said };
};

export const askOpen = Command.make(
  "open",
  {
    ask: Argument.String("ask").pipe(
      Argument.withSchema(AskId),
      Argument.withDescription("The ask to open: its file is asks/<ask>.ask.ts")
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print the payload it would send, and send nothing")
    ),
    files: Flag.String("files").pipe(
      Flag.withSchema(Schema.fromJsonString(Files)),
      Flag.withMetavar("JSON"),
      Flag.optional,
      Flag.withDescription(
        `The files to land, [{path, content}]; left out, ${Brand.configDir}/asks/<ask>.ask.ts and the check it names are read from the working tree`
      )
    ),
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
        "The project; the repo's platform remote names it when left out"
      )
    ),
    yes: Flag.Boolean("yes").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Approve it: it runs only with --yes, since a person approves it first"
      )
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const { ask, dryRun, json } = flags;

      if (!flags.yes && !dryRun) {
        return yield* new ApprovalNeeded({ command: COMMAND });
      }

      const context = yield* Effect.option(
        repoContext(yield* WorkingDirectory)
      );

      const project = yield* projectOf(flags.project, context);

      const files = yield* Option.match(flags.files, {
        onNone: () =>
          Option.match(context, {
            onNone: () =>
              usage(
                `Not inside a git repo: run ${Brand.cli} ${COMMAND} in the project's clone, or pass --files.`
              ),
            onSome: ({ root }) => filesInTree(root, ask),
          }),
        onSome: Effect.succeed,
      });

      const payload: Payload = yield* decodePayload({
        ask,
        files,
        project,
      }).pipe(Effect.catch((error) => usage(String(error))));

      const output = yield* Output;

      if (dryRun) {
        return yield* output.plan({
          command: COMMAND,
          json,
          payload: yield* Effect.orDie(encodePayload(payload)),
        });
      }

      const client = yield* Client;
      const opened = yield* client.openAsk(payload);

      return yield* output.success({
        command: COMMAND,
        data: yield* Effect.orDie(encodeSuccess(opened)),
        json,
        view: viewOf(ask, project, opened.landed),
      });
    }).pipe(reportRefusals(COMMAND, flags.json))
).pipe(
  Command.withDescription(
    `Open an ask by landing its file and its check, read from the ask's own file under ${Brand.configDir}/asks/ and the path it names unless --files gives them, once the check fails on main by an assertion, twice in the same way. It runs only with --yes: a person approves it.`
  )
);
