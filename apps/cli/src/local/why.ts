/**
 * `<cli> why <path>:<line>`: which landing put a line there, and why. git
 * blame names the commit; the platform's landing record names the ask (the
 * one it answers, or the one an ask's opening opened), the accountable author, every credit and the verdict. A commit the platform
 * did not land is said to be none of its landings, with the trailers its
 * author wrote. A verdict note fetched from the platform rides along, but
 * the landing record is the source.
 */
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

import { Output, Reported } from "../output.ts";
import type { View } from "../output.ts";
import { repoContext } from "../repo-context.ts";
import type { RepoContext } from "../repo-context.ts";

/**
 * Where a local command runs git: the process's own folder unless a caller
 * (a test) provides another. Shared with `env set`.
 */
export const WorkingDirectory = Context.Reference<string>(
  "cli/WorkingDirectory",
  { defaultValue: () => "." }
);

/**
 * A command used wrongly: `program` prints its one line on stderr and the
 * process exits 2 with nothing more printed. Shared with `env set`.
 */
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", {
  reason: Schema.String,
}) {
  override readonly [Runtime.errorExitCode] = 2;
  override readonly [Runtime.errorReported] = false;

  override get message() {
    return this.reason;
  }
}

/**
 * Ends the command as a usage error: `program` prints `reason` once on
 * stderr, as it does every misuse, and exits 2.
 */
export const usage = (reason: string) =>
  Effect.fail(new UsageError({ reason }));

const isRefusal = Schema.is(Refusal);

/**
 * Prints a refusal the platform answered with, once, through `Output`, and
 * ends with `Reported` (exit 1). Shared with `env set`.
 */
export const reportRefusals =
  (command: string, json: boolean) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchIf(isRefusal, (refusal) =>
        Output.use((output) =>
          output.refused({ command, json, refusals: [refusal] })
        ).pipe(Effect.andThen(Effect.fail(new Reported())))
      )
    );

/**
 * The project a command acts on: `--project`, else the one the repo's
 * platform remote names. Shared with `env set`.
 */
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
          "Name the project with --project <name>: this repo has no remote on a platform."
        ),
      onSome: Effect.succeed,
    }
  );

// A path, then a line number from 1 with no sign or leading zero. The path
// takes everything before the last colon, so a path may hold one.
const LOCATION = /^(?<path>.+):(?<line>[1-9][0-9]*)$/u;

/** A line of a file as people and compilers write it: `src/week.ts:42`. */
export const parseLocation = (
  text: string
): Option.Option<{ readonly path: RepoPath; readonly line: number }> => {
  const groups = LOCATION.exec(text)?.groups;
  const line = Number(groups?.line);

  return groups?.path === undefined || !Number.isSafeInteger(line)
    ? Option.none()
    : Option.some({ line, path: RepoPath.make(groups.path) });
};

/** What `why` found: the line's commit and what is known of it. */
const LineOrigin = Schema.Struct({
  /** The platform's record, when the commit is one of its landings. */
  landing: Schema.optionalKey(LandingView),
  line: Schema.Int,
  /** The verdict note on the commit, when one was fetched. */
  note: Schema.optionalKey(Verdict),
  path: RepoPath,
  sha: CommitSha,
  /** The commit's own trailers, when the platform did not land it. */
  trailers: Schema.optionalKey(
    Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String }))
  ),
});

type LineOrigin = typeof LineOrigin.Type;

const encodeOrigin = Schema.encodeEffect(LineOrigin);

const decodeNote = Schema.decodeOption(Schema.fromJsonString(Verdict));

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** Runs git in `cwd` to the end: its stdout and exit code; stderr is dropped. */
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

/** The line is in no file committed at HEAD. */
const noSuchLine = (location: string) =>
  usage(
    `${location} is not a line of a file committed at HEAD: ${location.replace(/:[0-9]+$/u, "")} is not there, or is shorter.`
  );

/** `path` as the repo names it from its root, if HEAD holds it. */
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

/** The commit that last changed line `line` of `path` at HEAD. */
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

/** The trailers `sha`'s author wrote, as git reads them. */
const trailersOf = (cwd: string, sha: CommitSha) =>
  Effect.map(git(cwd, ["log", "-1", "--format=%B", sha]), ({ stdout }) =>
    parseTrailers(stdout)
  );

/** The verdict note on `sha`, if one was fetched and it reads as a verdict. */
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

/** One fact about the line, as a list item. */
interface Row {
  readonly label: string;
  readonly value: string;
  /** Code in Markdown: an id or a path. */
  readonly code?: boolean;
}

const verdictRow = (verdict: Verdict): Row => ({
  label: "Verdict",
  value: [
    `${verdict.outcome._tag} at the ${verdict.stage} stage`,
    ...verdict.lanes.map(({ lane, result }) => `${lane} ${result}`),
  ].join(", "),
});

/**
 * The ask a landing links: the one it answers ("Ask"), else the one it
 * opened ("Opened": an opening answers nothing), else none.
 */
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

/** The line's story, in Markdown for agents and plain text for a person. */
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
