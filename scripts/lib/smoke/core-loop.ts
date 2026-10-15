import { Brand } from "@repo/brand";
import { AnswerView } from "@repo/protocol/domain/answer";
import { Ask } from "@repo/protocol/domain/ask";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Discussion } from "@repo/protocol/domain/discussion";
import { Outcome } from "@repo/protocol/domain/outcome";
import { Envelope } from "@repo/protocol/envelope";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
} from "@repo/protocol/ids";
import type { DiscussionId } from "@repo/protocol/ids";
import { explain } from "@repo/protocol/render";
import {
  Array,
  Config,
  Duration,
  Effect,
  FileSystem,
  Option,
  Redacted,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { cliEntry, personEnv } from "../swarm/workspace.ts";

export const LoopStep = Schema.Literals([
  "people",
  "init",
  "discussion",
  "open-ask",
  "claim",
  "out-of-scope",
  "answer",
  "landing",
  "verdict-note",
]);

export type LoopStep = typeof LoopStep.Type;

// Never holds a token.
export class LoopFailed extends Schema.TaggedError<LoopFailed>()("LoopFailed", {
  reason: Schema.String,
  step: LoopStep,
}) {
  override get message() {
    return `${this.step}: ${this.reason}`;
  }
}

const sdk = `${Brand.cliPackage}/rules`;

export const ASK = AskId.make("parse-year");

const SOURCE = "src/parse.ts";

const CHECK = `test/${ASK}.test.ts`;

const README =
  "A throwaway project smoke's core loop makes, answers and lands.\n";

const startFiles = (answerer: Handle) => ({
  [`${Brand.configDir}/project.ts`]: [
    `import { kinds, project } from "${sdk}";`,
    "",
    "export default project({",
    "  kinds: [kinds.fix],",
    '  run: { checks: {}, test: "bun test {path}" },',
    "});",
    "",
  ].join("\n"),
  [`${Brand.configDir}/vouched.td`]: `${answerer}\n`,
  "README.md": README,
  "package.json": '{ "name": "smoke", "private": true }\n',
  [SOURCE]: "export const parse = (iso: string) => ({ iso, year: 0 });\n",
});

const askFiles = [
  {
    content: [
      `import { kinds, territory } from "${sdk}";`,
      "",
      "export default kinds.fix.ask({",
      `  path: "${CHECK}",`,
      `  territory: territory.paths("${SOURCE}"),`,
      '  want: "parse reads the year of an ISO date",',
      "});",
      "",
    ].join("\n"),
    path: `${Brand.configDir}/asks/${ASK}.ask.ts`,
  },
  {
    content: [
      'import { expect, it } from "bun:test";',
      "",
      `import { parse } from "../${SOURCE}";`,
      "",
      'it("parse reads the year of an ISO date", () => {',
      '  expect(parse("2026-10-13").year).toBe(2026);',
      "});",
      "",
    ].join("\n"),
    path: CHECK,
  },
] as const;

const yearRead =
  "export const parse = (iso: string) => ({ iso, year: Number(iso.slice(0, 4)) });\n";

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// A cold Checker runs an ask's check twice.
const PATIENCE = Duration.minutes(10);

export interface LoopPerson {
  readonly handle: Handle;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly token: Redacted.Redacted;
}

const failed = (step: LoopStep, reason: string) =>
  new LoopFailed({ reason, step });

const scrubbed = (text: string, tokens: readonly Redacted.Redacted[]) => {
  let clean = text;

  for (const token of tokens) {
    clean = clean.replaceAll(Redacted.value(token), "<redacted>");
  }

  return clean;
};

const textOf = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

const run = (
  step: LoopStep,
  person: Pick<LoopPerson, "env" | "token">,
  command: string,
  args: readonly string[],
  cwd?: string
): Effect.Effect<Ran, LoopFailed, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make(command, args, {
          cwd,
          env: { ...person.env },
          extendEnv: true,
          stdin: "ignore",
        })
      );

      const [stdout, stderr, code] = yield* Effect.all(
        [textOf(child.stdout), textOf(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { code: Number(code), stderr, stdout };
    })
  ).pipe(
    Effect.mapError(({ message }) =>
      failed(
        step,
        `${command} didn't run: ${scrubbed(message, [person.token])}`
      )
    ),
    Effect.timeoutOrElse({
      duration: PATIENCE,
      orElse: () =>
        Effect.fail(
          failed(
            step,
            `${command} ${args[0] ?? ""} took longer than ${Duration.format(PATIENCE)}`
          )
        ),
    })
  );

const gitOk = (
  step: LoopStep,
  person: LoopPerson,
  cwd: string,
  args: readonly string[]
) =>
  Effect.flatMap(run(step, person, "git", args, cwd), (ran) =>
    ran.code === 0
      ? Effect.succeed(ran.stdout.trim())
      : Effect.fail(
          failed(
            step,
            scrubbed(
              `git ${args.join(" ")} exited ${ran.code}: ${ran.stderr.trim()}`,
              [person.token]
            )
          )
        )
  );

const cli = <A, I>(
  step: LoopStep,
  person: Pick<LoopPerson, "env" | "token">,
  args: readonly string[],
  data: Schema.Codec<A, I>,
  cwd?: string
) =>
  Effect.gen(function* () {
    const ran = yield* run(
      step,
      person,
      "bun",
      [cliEntry, ...args, "--json"],
      cwd
    );

    const said = scrubbed(
      (ran.stderr.trim() === "" ? ran.stdout : ran.stderr).trim().slice(0, 800),
      [person.token]
    );

    const envelope = yield* Schema.decodeEffect(
      Schema.fromJsonString(Envelope(data))
    )(ran.stdout.trim()).pipe(
      Effect.mapError(() =>
        failed(
          step,
          `${Brand.cli} ${args.join(" ")} exited ${ran.code} without its JSON: ${said}`
        )
      )
    );

    return envelope.ok
      ? envelope.data
      : yield* failed(
          step,
          `${Brand.cli} ${args[0] ?? ""} was refused: ${explain(
            envelope.refusals
          )
            .map((line) => line.trim())
            .join("; ")}`
        );
  });

const helperShim = [
  "#!/bin/sh",
  `# ${Brand.gitCredentialHelper} for smoke's core loop: this repo's CLI from source, under Bun.`,
  `exec bun '${cliEntry.replaceAll("'", `'\\''`)}' credential "$@"`,
  "",
].join("\n");

const SHIM_MODE = 0o755;

const HOME_MODE = 0o700;

// A gitconfig of their own, so nothing of this machine's git or CLI config answers instead.
export const personAt = (input: {
  readonly home: string;
  readonly origin: string;
  readonly token: Redacted.Redacted;
}): Effect.Effect<
  LoopPerson,
  LoopFailed,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { home, origin, token } = input;
    const bin = `${home}/bin`;
    const gitconfig = `${home}/gitconfig`;

    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(`${home}/config`, {
        mode: HOME_MODE,
        recursive: true,
      });
      yield* fs.makeDirectory(bin, { recursive: true });

      const helper = `${bin}/${Brand.gitCredentialHelper}`;

      yield* fs.writeFileString(helper, helperShim, { mode: SHIM_MODE });
      yield* fs.chmod(helper, SHIM_MODE);
    }).pipe(
      Effect.mapError(({ message }) =>
        failed("people", `a person's folder: ${message}`)
      )
    );

    const path = yield* Config.String("PATH").pipe(
      Config.withDefault(""),
      Effect.orElseSucceed(() => "")
    );

    const env = {
      ...personEnv({
        configHome: `${home}/config`,
        platformUrl: origin,
        token,
      }),
      [`${Brand.slug.toUpperCase()}_PROFILE`]: undefined,
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_EDITOR: ":",
      GIT_TERMINAL_PROMPT: "0",
      PATH: path === "" ? bin : `${bin}:${path}`,
    };

    const { handle } = yield* cli(
      "people",
      { env, token },
      ["status"],
      Schema.Struct({ handle: Handle })
    );

    yield* fs
      .writeFileString(
        gitconfig,
        [
          "[user]",
          `\tname = ${handle}`,
          `\temail = ${handle}@example.com`,
          "[commit]",
          "\tgpgsign = false",
          `[credential "${origin}"]`,
          "\thelper =",
          `\thelper = ${Brand.slug}`,
          "\tuseHttpPath = true",
          "",
        ].join("\n")
      )
      .pipe(
        Effect.mapError(({ message }) =>
          failed("people", `${handle}'s gitconfig: ${message}`)
        )
      );

    return { env, handle, home, token };
  });

const writeFiles = (
  step: LoopStep,
  dir: string,
  files: Readonly<Record<string, string>>
) =>
  Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) =>
    Effect.forEach(
      Object.entries(files),
      ([path, content]) =>
        Effect.gen(function* () {
          const at = `${dir}/${path}`;

          yield* fs.makeDirectory(at.slice(0, at.lastIndexOf("/")), {
            recursive: true,
          });
          yield* fs.writeFileString(at, content);
        }).pipe(
          Effect.mapError(({ message }) =>
            failed(step, `writing ${path}: ${message}`)
          )
        ),
      { discard: true }
    )
  );

const commit = (
  step: LoopStep,
  person: LoopPerson,
  cwd: string,
  message: string,
  files: Readonly<Record<string, string>>
) =>
  Effect.gen(function* () {
    yield* writeFiles(step, cwd, files);
    yield* gitOk(step, person, cwd, ["add", "--all"]);
    yield* gitOk(step, person, cwd, [
      "commit",
      "--quiet",
      "--message",
      message,
    ]);

    return CommitSha.make(
      yield* gitOk(step, person, cwd, ["rev-parse", "HEAD"])
    );
  });

const Listed = Schema.Struct({
  projects: Schema.Array(Schema.Struct({ project: ProjectName })),
});

export const projectIsFree = (person: LoopPerson, project: ProjectName) =>
  Effect.flatMap(cli("init", person, ["projects"], Listed), ({ projects }) =>
    projects.some((listed) => listed.project === project)
      ? Effect.fail(
          failed(
            "init",
            `${project} is on the platform already, so nothing was made or recorded: a run a second later takes another name`
          )
        )
      : Effect.void
  );

const Inited = Schema.Struct({
  pushed: Schema.Boolean,
  remote: Schema.NonEmptyString,
});

export const initProject = (input: {
  readonly decider: LoopPerson;
  readonly answerer: Handle;
  readonly project: ProjectName;
  readonly dir: string;
}) =>
  Effect.gen(function* () {
    const { decider, dir, project } = input;

    yield* writeFiles("init", dir, startFiles(input.answerer));
    yield* gitOk("init", decider, dir, [
      "init",
      "--quiet",
      "--initial-branch=main",
    ]);
    yield* gitOk("init", decider, dir, ["add", "--all"]);
    yield* gitOk("init", decider, dir, [
      "commit",
      "--quiet",
      "--message",
      `Start ${project}`,
    ]);

    const made = yield* cli(
      "init",
      decider,
      ["init", "--project", project, "--yes"],
      Inited,
      dir
    );

    return made.pushed
      ? made
      : yield* failed(
          "init",
          `${Brand.cli} init made ${project} but pushed nothing`
        );
  });

const Opened = Schema.Struct({ ask: Ask, landed: LandedSha });

const Posted = Schema.Struct({ discussion: Discussion });

// The answerer asks for the ask in a discussion; the decider opens it from there.
export const openDiscussion = (answerer: LoopPerson, project: ProjectName) =>
  Effect.map(
    cli(
      "discussion",
      answerer,
      [
        "discussion",
        "post",
        "--project",
        project,
        "--title",
        "Read the year",
        "--body",
        "Could parse read a bare year, such as 2026?",
      ],
      Posted
    ),
    ({ discussion }) => discussion.id
  );

export const openAsk = (input: {
  readonly decider: LoopPerson;
  readonly discussion: DiscussionId;
  readonly project: ProjectName;
}) =>
  Effect.gen(function* () {
    const { decider, discussion, project } = input;

    const opened = yield* cli(
      "open-ask",
      decider,
      [
        "ask",
        "open",
        ASK,
        "--project",
        project,
        "--files",
        JSON.stringify(askFiles),
        "--discussion",
        discussion,
        "--yes",
      ],
      Opened
    );

    const { discussion: thread } = yield* cli(
      "open-ask",
      decider,
      ["discussion", discussion, "--project", project],
      Posted
    );

    return thread.state === "asked" && thread.ask === ASK
      ? opened
      : yield* failed(
          "open-ask",
          `the discussion ${discussion} is ${thread.state}${thread.ask === undefined ? "" : ` as ${thread.ask}`}, not asked as ${ASK}`
        );
  });

const Claimed = Schema.Struct({ claim: ClaimView });

export const claimAsk = (answerer: LoopPerson, project: ProjectName) =>
  Effect.map(
    cli("claim", answerer, ["claim", ASK, "--project", project], Claimed),
    ({ claim }) => claim
  );

// Each refusal's first line among git's `remote:` lines, as `render` writes
// it: `remote: OutOfScope: …`.
const REFUSAL_LINE = /^remote: (?<tag>[A-Z][A-Za-z]+): /gmu;

export const refusalTags = (stderr: string): readonly string[] =>
  [...stderr.matchAll(REFUSAL_LINE)].flatMap(({ groups }) =>
    groups?.tag === undefined ? [] : [groups.tag]
  );

export const pushOutOfScope = (input: {
  readonly answerer: LoopPerson;
  readonly claim: ClaimView;
  readonly dir: string;
}) =>
  Effect.gen(function* () {
    const { answerer, claim, dir } = input;

    yield* gitOk("out-of-scope", answerer, answerer.home, [
      "clone",
      "--quiet",
      claim.remote,
      dir,
    ]);

    yield* commit("out-of-scope", answerer, dir, "Read the year, and say so", {
      "README.md": `${README}It reads years now.\n`,
      [SOURCE]: yearRead,
    });

    const pushed = yield* run(
      "out-of-scope",
      answerer,
      "git",
      ["push", "origin", "HEAD:main"],
      dir
    );

    const tags = refusalTags(pushed.stderr);

    return pushed.code !== 0 && tags.includes("OutOfScope")
      ? tags
      : yield* failed(
          "out-of-scope",
          scrubbed(
            `a push outside ${ASK}'s territory exited ${pushed.code}${tags.length === 0 ? " with no refusal" : `, refused ${tags.join(", ")}`}, not OutOfScope: ${pushed.stderr.trim()}`,
            [answerer.token]
          )
        );
  });

export const pushAnswer = (answerer: LoopPerson, dir: string) =>
  Effect.gen(function* () {
    const head = yield* commit(
      "answer",
      answerer,
      dir,
      "Leave the readme alone",
      {
        "README.md": README,
      }
    );

    const pushed = yield* run(
      "answer",
      answerer,
      "git",
      ["push", "origin", "HEAD:main"],
      dir
    );

    return pushed.code === 0
      ? head
      : yield* failed(
          "answer",
          scrubbed(
            `the fixed answer's push exited ${pushed.code}: ${pushed.stderr.trim()}`,
            [answerer.token]
          )
        );
  });

const Status = Schema.Struct({ answers: Schema.Array(AnswerView) });

class StillChecking extends Schema.TaggedError<StillChecking>()(
  "StillChecking",
  {}
) {}

export interface Patience {
  readonly every: Duration.Duration;
  readonly within: Duration.Duration;
}

const outcomeLine = (outcome: Outcome) =>
  Outcome.match(outcome, {
    AwaitingDecision: ({ decision }) => `waits on the decision ${decision}`,
    AwaitingFinish: () => "waits for a maintainer's finish",
    Checking: ({ stage }) => `is still being checked at ${stage}`,
    Landed: ({ sha }) => `landed as ${sha}`,
    Refused: ({ refusals }) =>
      `was refused: ${explain(refusals)
        .map((line) => line.trim())
        .join("; ")}`,
    WaitingOnParent: ({ ask }) => `waits for its parent ask ${ask} to land`,
  });

export const awaitLanding = (input: {
  readonly answerer: LoopPerson;
  readonly project: ProjectName;
  readonly head: CommitSha;
  readonly patience: Patience;
}) =>
  Effect.gen(function* () {
    const { answerer, head, project } = input;

    const outcome = yield* cli(
      "landing",
      answerer,
      ["status", "--project", project],
      Status
    ).pipe(
      Effect.flatMap(({ answers }) =>
        Option.match(
          Array.findLast(answers, (answer) => answer.head === head),
          {
            onNone: () => Effect.fail(new StillChecking()),
            onSome: ({ outcome: now }) =>
              Outcome.guards.Checking(now)
                ? Effect.fail(new StillChecking())
                : Effect.succeed(now),
          }
        )
      ),
      Effect.retry({
        schedule: Schedule.spaced(input.patience.every).pipe(
          Schedule.upTo({ duration: input.patience.within })
        ),
        while: Schema.is(StillChecking),
      }),
      Effect.catchTag("StillChecking", () =>
        Effect.fail(
          failed(
            "landing",
            `the answer at ${head} was still being checked after ${Duration.format(input.patience.within)}`
          )
        )
      )
    );

    return Outcome.guards.Landed(outcome)
      ? outcome.sha
      : yield* failed(
          "landing",
          `the answer at ${head} ${outcomeLine(outcome)}`
        );
  });

export interface LandingRead {
  readonly author: string;
  readonly committer: string;
  readonly trailers: readonly string[];
}

export const readLanding = (input: {
  readonly answerer: LoopPerson;
  readonly dir: string;
  readonly origin: string;
  readonly project: ProjectName;
  readonly landed: LandedSha;
}) =>
  Effect.gen(function* () {
    const { answerer, dir, landed } = input;

    yield* gitOk("landing", answerer, dir, [
      "fetch",
      "--quiet",
      `${input.origin}/${input.project}.git`,
      "refs/heads/main",
    ]);

    const main = yield* gitOk("landing", answerer, dir, [
      "rev-parse",
      "FETCH_HEAD",
    ]);

    if (main !== landed) {
      return yield* failed(
        "landing",
        `${input.project}'s main is at ${main}, not the landing ${landed}`
      );
    }

    const [author = "", committer = "", ...trailers] = (yield* gitOk(
      "landing",
      answerer,
      dir,
      ["log", "-1", "--format=%an%n%cn%n%(trailers:only,unfold)", landed]
    ))
      .split("\n")
      .filter((line) => line.length > 0);

    return { author, committer, trailers } satisfies LandingRead;
  });

// `@repo/git/notes`' `notesRef`.
const NOTES = `refs/notes/${Brand.slug}`;

const NOTE_WAIT = { every: Duration.seconds(1), times: 30 } as const;

class NoNoteYet extends Schema.TaggedError<NoNoteYet>()("NoNoteYet", {}) {}

export const readVerdictNote = (input: {
  readonly answerer: LoopPerson;
  readonly dir: string;
  readonly head: CommitSha;
}) =>
  Effect.gen(function* () {
    const { answerer, dir, head } = input;

    const fetched = yield* run(
      "verdict-note",
      answerer,
      "git",
      ["fetch", "--quiet", "origin", `+${NOTES}:${NOTES}`],
      dir
    );

    const shown = yield* run(
      "verdict-note",
      answerer,
      "git",
      ["notes", `--ref=${NOTES}`, "show", head],
      dir
    );

    return fetched.code === 0 && shown.code === 0 && shown.stdout.trim() !== ""
      ? shown.stdout.trim()
      : yield* new NoNoteYet();
  }).pipe(
    Effect.retry({
      schedule: Schedule.spaced(NOTE_WAIT.every),
      times: NOTE_WAIT.times,
      while: Schema.is(NoNoteYet),
    }),
    Effect.catchTag("NoNoteYet", () =>
      Effect.fail(
        failed(
          "verdict-note",
          `no verdict note on ${input.head} in the fork after ${NOTE_WAIT.times} s`
        )
      )
    )
  );
