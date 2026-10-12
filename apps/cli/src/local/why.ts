import { notesRef } from "@repo/git/notes";
import { parseTrailers } from "@repo/git/trailers";
import type { Trailer } from "@repo/git/trailers";
import { Client } from "@repo/protocol/contracts";
import { Verdict } from "@repo/protocol/domain/answer";
import { LandingView } from "@repo/protocol/domain/landing";
import { CommitSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Refusal } from "@repo/protocol/refusal";
import {
  Context,
  DateTime,
  Effect,
  Option,
  Runtime,
  Schema,
  Stream,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { endRefused, Output } from "../output.ts";
import type { View } from "../output.ts";
import { repoContext } from "../repo-context.ts";
import type { RepoContext } from "../repo-context.ts";

export const WorkingDirectory = Context.Reference<string>(
  "cli/WorkingDirectory",
  { defaultValue: () => "." }
);

export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", {
  reason: Schema.String,
}) {
  override readonly [Runtime.errorExitCode] = 2;
  override readonly [Runtime.errorReported] = false;

  override get message() {
    return this.reason;
  }
}

export const usage = (reason: string) =>
  Effect.fail(new UsageError({ reason }));

const isRefusal = Schema.is(Refusal);

export const reportRefusals =
  (command: string, json: boolean) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchIf(isRefusal, (refusal) =>
        Output.use((output) =>
          endRefused(output, { command, json, refusals: [refusal] })
        )
      )
    );

export const projectOf = (
  named: Option.Option<ProjectName>,
  context: Option.Option<RepoContext>
) =>
  Option.match(
    Option.orElse(named, () =>
      Option.flatMap(context, ({ repo }) =>
        Option.map(repo, ({ project }) => project)
      )
    ),
    {
      onNone: () =>
        usage(
          "Name the project with --project <owner>/<name>: this repo has no remote on a platform."
        ),
      onSome: Effect.succeed,
    }
  );

// The path takes everything before the last colon, so a path may hold one.
const LOCATION = /^(?<path>.+):(?<line>[1-9][0-9]*)$/u;

export const parseLocation = (
  text: string
): Option.Option<{ readonly path: RepoPath; readonly line: number }> => {
  const groups = LOCATION.exec(text)?.groups;
  const line = Number(groups?.line);

  return groups?.path === undefined || !Number.isSafeInteger(line)
    ? Option.none()
    : Option.some({ line, path: RepoPath.make(groups.path) });
};

const LineOrigin = Schema.Struct({
  landing: Schema.optionalKey(LandingView),
  line: Schema.Int,
  note: Schema.optionalKey(Verdict),
  path: RepoPath,
  sha: CommitSha,
  trailers: Schema.optionalKey(
    Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String }))
  ),
});

type LineOrigin = typeof LineOrigin.Type;

const encodeOrigin = Schema.encodeEffect(LineOrigin);

const decodeNote = Schema.decodeOption(Schema.fromJsonString(Verdict));

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

const git = (cwd: string, args: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make("git", args, {
          cwd,
          stderr: "ignore",
          stdin: "ignore",
        })
      );

      const [stdout, exitCode] = yield* Effect.all(
        [text(child.stdout), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { exitCode, stdout };
    })
  );

const noSuchLine = (location: string) =>
  usage(
    `${location} is not a line of a file committed at HEAD: ${location.replace(/:[0-9]+$/u, "")} is not there, or is shorter.`
  );

const pathAtHead = (cwd: string, path: RepoPath, location: string) =>
  Effect.flatMap(
    git(cwd, [
      "ls-tree",
      "--full-name",
      "--name-only",
      "-z",
      "HEAD",
      "--",
      path,
    ]),
    ({ exitCode, stdout }) => {
      const [only, ...more] = stdout.split("\0").filter((name) => name !== "");

      return exitCode === 0 && only !== undefined && more.length === 0
        ? Effect.succeed(RepoPath.make(only))
        : noSuchLine(location);
    }
  );

// git blame's porcelain opens with the line's commit, then its line numbers.
const BLAMED = /^(?<sha>[0-9a-f]{40}) /u;

const blamed = (cwd: string, path: RepoPath, line: number, location: string) =>
  Effect.flatMap(
    git(cwd, [
      "blame",
      "--porcelain",
      "-L",
      `${line},${line}`,
      "HEAD",
      "--",
      path,
    ]),
    ({ exitCode, stdout }) => {
      const sha = BLAMED.exec(stdout)?.groups?.sha;

      return exitCode === 0 && sha !== undefined
        ? Effect.succeed(CommitSha.make(sha))
        : noSuchLine(location);
    }
  );

const trailersOf = (cwd: string, sha: CommitSha) =>
  Effect.map(git(cwd, ["log", "-1", "--format=%B", sha]), ({ stdout }) =>
    parseTrailers(stdout)
  );

const noteOn = (cwd: string, sha: CommitSha) =>
  Effect.flatMap(
    git(cwd, ["notes", `--ref=${notesRef}`, "show", sha]),
    ({ exitCode, stdout }) => {
      if (exitCode !== 0) {
        return Effect.succeedNone;
      }

      const note = decodeNote(stdout.trim());

      return Option.isSome(note)
        ? Effect.succeed(note)
        : Output.use((output) =>
            output.note(
              `The note on ${sha} in ${notesRef} is not a verdict; it is left out.`
            )
          ).pipe(Effect.as(Option.none<Verdict>()));
    }
  );

const short = (sha: string) => sha.slice(0, 7);

interface Row {
  readonly label: string;
  readonly value: string;
  readonly code?: boolean;
}

const verdictRow = (verdict: Verdict): Row => ({
  label: "Verdict",
  value: [
    `${verdict.outcome._tag} at the ${verdict.stage} stage`,
    ...verdict.lanes.map(({ lane, result }) => `${lane} ${result}`),
  ].join(", "),
});

const askRow = (landing: LandingView): Row => {
  if (landing.ask !== undefined) {
    return { code: true, label: "Ask", value: landing.ask };
  }

  return landing.opened === undefined
    ? { label: "Ask", value: "none (a decider's own landing)" }
    : { code: true, label: "Opened", value: landing.opened };
};

const landingRows = (landing: LandingView): readonly Row[] => [
  askRow(landing),
  { label: "Author", value: landing.author },
  ...landing.credits.map(({ handle, role }) => ({
    label: role,
    value: handle,
  })),
  ...landing.assisted.map(({ harness, model, verified }) => ({
    label: "Assisted-by",
    value: `${harness}${model === undefined ? "" : `:${model}`} (${verified ? "verified" : "claimed"})`,
  })),
  ...(landing.heldBackTrailer === undefined
    ? []
    : [{ label: "Held-back", value: landing.heldBackTrailer }]),
];

const trailerRows = (trailers: readonly Trailer[]): readonly Row[] =>
  trailers.map(({ key, value }) => ({ label: key, value }));

const viewOf = (origin: LineOrigin): View => {
  const at = `${origin.path}:${origin.line}`;
  const commit = short(origin.sha);
  const verdict = origin.note ?? origin.landing?.verdict;

  const [markdown, plain] = Option.match(
    Option.fromUndefinedOr(origin.landing),
    {
      onNone: () => [
        `\`${at}\` comes from commit \`${commit}\`, which is not a platform landing: the platform keeps no record of it, so its trailers are only what its author wrote.`,
        `${at} comes from commit ${commit}, which is not a platform landing: the platform keeps no record of it, so its trailers are only what its author wrote.`,
      ],
      onSome: ({ landedAt }) => [
        `\`${at}\` came to main in landing \`${commit}\`, on ${DateTime.formatIso(landedAt)}.`,
        `${at} came to main in landing ${commit}, on ${DateTime.formatIso(landedAt)}.`,
      ],
    }
  );

  const rows = [
    ...(origin.landing === undefined ? [] : landingRows(origin.landing)),
    ...trailerRows(origin.trailers ?? []),
    ...(verdict === undefined ? [] : [verdictRow(verdict)]),
  ];

  const empty =
    origin.landing === undefined && (origin.trailers ?? []).length === 0
      ? ["It carries no trailers."]
      : [];

  return {
    markdown: [
      markdown,
      "",
      ...rows.map(
        ({ code, label, value }) =>
          `- ${label}: ${code === true ? `\`${value}\`` : value}`
      ),
      ...empty,
    ].join("\n"),
    text: [
      plain,
      ...rows.map(({ label, value }) => `  ${label}: ${value}`),
      ...empty,
    ].join("\n"),
  };
};

export const why = Command.make(
  "why",
  {
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print machine-readable JSON")
    ),
    location: Argument.String("location").pipe(
      Argument.withMetavar("path:line"),
      Argument.withDescription(
        "A line of a file as committed at HEAD, such as src/week.ts:42"
      )
    ),
    project: Flag.String("project").pipe(
      Flag.withSchema(ProjectName),
      Flag.optional,
      Flag.withDescription(
        "The project whose landings to ask about; the repo's platform remote names it by default"
      )
    ),
  },
  ({ json, location, project }) =>
    Effect.gen(function* () {
      const at = yield* Option.match(parseLocation(location), {
        onNone: () =>
          usage(
            `${location} is not path:line; write one such as src/week.ts:42.`
          ),
        onSome: Effect.succeed,
      });

      const cwd = yield* WorkingDirectory;
      const context = yield* repoContext(cwd);
      const name = yield* projectOf(project, Option.some(context));
      const path = yield* pathAtHead(cwd, at.path, location);
      const sha = yield* blamed(cwd, at.path, at.line, location);
      const client = yield* Client;

      const landing = yield* client.landing({ project: name, sha }).pipe(
        Effect.map(({ landing: found }) => Option.some(found)),
        Effect.catchTag("UnknownCommit", () => Effect.succeedNone)
      );

      const trailers = Option.isNone(landing)
        ? Option.some(yield* trailersOf(cwd, sha))
        : Option.none();

      const note = yield* noteOn(cwd, sha);

      const origin: LineOrigin = {
        line: at.line,
        path,
        sha,
        ...Option.match(landing, {
          onNone: () => ({}),
          onSome: (found) => ({ landing: found }),
        }),
        ...Option.match(note, {
          onNone: () => ({}),
          onSome: (verdict) => ({ note: verdict }),
        }),
        ...Option.match(trailers, {
          onNone: () => ({}),
          onSome: (found) => ({ trailers: found }),
        }),
      };

      const data = yield* encodeOrigin(origin).pipe(Effect.orDie);

      yield* Output.use((output) =>
        output.success({ command: "why", data, json, view: viewOf(origin) })
      );
    }).pipe(reportRefusals("why", json))
).pipe(
  Command.withDescription(
    "Explain a line: the ask, the answer and the people that landed it."
  )
);
