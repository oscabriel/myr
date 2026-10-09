/**
 * The core loop's steps, as smoke's `--loop` takes them on a platform:
 * each one through the CLI (this repo's, run
 * from source with Bun) or git, as a person would, with the person's
 * platform token only in their processes' env, and git's credential helper
 * the CLI itself.
 *
 * The project is a fixture made here: one source file, a config folder that
 * runs `bun test {path}` and vouches for the answerer, and one ask whose
 * check fails on main by an assertion. The answer reaches outside the ask's
 * territory first (the README), then puts the README back.
 *
 * Every step fails with `LoopFailed`, naming the step and what went wrong in
 * words a person reads, never a token.
 */
import { Brand } from "@repo/brand";
import { AnswerView } from "@repo/protocol/domain/answer";
import { Ask } from "@repo/protocol/domain/ask";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Decision, DecisionSubject } from "@repo/protocol/domain/decision";
import { Outcome } from "@repo/protocol/domain/outcome";
import { DraftState, Proposal } from "@repo/protocol/domain/proposal";
import { Envelope } from "@repo/protocol/envelope";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
} from "@repo/protocol/ids";
import type { ProposalId } from "@repo/protocol/ids";
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

/** The loop's steps, in the order it takes them. */
export const LoopStep = Schema.Literals([
  "people",
  "init",
  "open-ask",
  "claim",
  "out-of-scope",
  "answer",
  "landing",
  "verdict-note",
  "draft-propose",
  "draft-ready",
  "draft-accept",
]);

export type LoopStep = typeof LoopStep.Type;

/** A step of the loop went wrong: which, and why. Never holds a token. */
export class LoopFailed extends Schema.TaggedError<LoopFailed>()("LoopFailed", {
  reason: Schema.String,
  step: LoopStep,
}) {
  override get message() {
    return `${this.step}: ${this.reason}`;
  }
}

// ------------------------------------------------------------ the fixture

/** Where the config folder's sdk is imported from, as a maintainer writes it. */
const sdk = `${Brand.cliPackage}/rules`;

/** The ask the loop opens and answers. */
export const ASK = AskId.make("parse-year");

/** The one file the ask's territory holds. */
const SOURCE = "src/parse.ts";

/** The ask's check: the file its kind runs. */
const CHECK = `test/${ASK}.test.ts`;

const README =
  "A throwaway project smoke's core loop makes, answers and lands.\n";

/** The project as its decider first pushes it, the answerer vouched for. */
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

/** The ask's own files: its file in the config folder, and its check, which asserts. */
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

/** The answer: the year, read. */
const yearRead =
  "export const parse = (iso: string) => ({ iso, year: Number(iso.slice(0, 4)) });\n";

// --------------------------------------------------------------- processes

/** How a process ended, and what it printed. */
interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The longest one command may take: a cold Checker runs an ask's check twice. */
const PATIENCE = Duration.minutes(10);

/** One person the loop acts as. */
export interface LoopPerson {
  readonly handle: Handle;
  /** Their folder: the CLI's config, their gitconfig, git's credential helper. */
  readonly home: string;
  /** The env their CLI and git run in: their token, the platform, their gitconfig. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Their token, blanked out of anything the loop says. */
  readonly token: Redacted.Redacted;
}

const failed = (step: LoopStep, reason: string) =>
  new LoopFailed({ reason, step });

/** `text` with each of `tokens` blanked out. */
const scrubbed = (text: string, tokens: readonly Redacted.Redacted[]) => {
  let clean = text;

  for (const token of tokens) {
    clean = clean.replaceAll(Redacted.value(token), "<redacted>");
  }

  return clean;
};

/** All a byte stream says, as text. */
const textOf = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** `command args` in `cwd` as `person`: how it ended, and what it printed. */
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

/** git as `person` in `cwd`, which must succeed; what it printed. */
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

/**
 * One CLI command as `person`, with `--json`: its data, decoded by `data`.
 * A refusal fails the step with what the platform said, as `explain` says
 * it everywhere; output that is no envelope fails it with what the command
 * printed.
 */
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

// ----------------------------------------------------------------- people

/**
 * git's credential helper for a person: this repo's CLI from source, as
 * `git-credential-<slug>`, which hands git the token in the env.
 */
const helperShim = [
  "#!/bin/sh",
  `# ${Brand.gitCredentialHelper} for smoke's core loop: this repo's CLI from source, under Bun.`,
  `exec bun '${cliEntry.replaceAll("'", `'\\''`)}' credential "$@"`,
  "",
].join("\n");

/** A shim runs for everyone; only its owner writes it. */
const SHIM_MODE = 0o755;

/** A person's folder holds the CLI's config: owner only. */
const HOME_MODE = 0o700;

/**
 * A person at `home` on the platform at `origin`, holding `token`: their
 * folder, with git's credential helper on `PATH` and a gitconfig of their
 * own (their name, and the helper for the platform), so nothing of this
 * machine's git or CLI config answers instead. Their handle is whoever the
 * platform says the token names (`status`).
 */
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

// ------------------------------------------------------------------ steps

/** `files` written under `dir`, each at its path. */
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

/** `files` written in the work tree at `cwd` and committed as `person`; the commit. */
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

/**
 * Whether `project` is free on the platform, as `person` lists every
 * project (`<cli> projects`): a taken name fails the step, before
 * anything is made.
 */
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

/**
 * Makes `project` from the fixture, as `decider`: a repo of its first files
 * at `dir`, then `<cli> init`, which makes the project, wires its remote
 * and pushes main's first commit.
 */
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

/** Opens the fixture's ask as `decider`: its check fails on main twice the same way first. */
export const openAsk = (decider: LoopPerson, project: ProjectName) =>
  cli(
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
      "--yes",
    ],
    Opened
  );

const Claimed = Schema.Struct({ claim: ClaimView });

/** Claims the fixture's ask as `answerer`: their fork, and where it lives. */
export const claimAsk = (answerer: LoopPerson, project: ProjectName) =>
  Effect.map(
    cli("claim", answerer, ["claim", ASK, "--project", project], Claimed),
    ({ claim }) => claim
  );

// Each refusal's first line among git's `remote:` lines, as `render` writes
// it: `remote: OutOfScope: …`.
const REFUSAL_LINE = /^remote: (?<tag>[A-Z][A-Za-z]+): /gmu;

/** The refusals' tags git printed from the platform, in order. */
export const refusalTags = (stderr: string): readonly string[] =>
  [...stderr.matchAll(REFUSAL_LINE)].flatMap(({ groups }) =>
    groups?.tag === undefined ? [] : [groups.tag]
  );

/**
 * Clones the claim's fork as `answerer` into `dir`, and pushes an answer
 * that reaches outside the ask's territory (the README besides the source):
 * git must refuse it, `OutOfScope` among the platform's words. Gives every
 * refusal git printed.
 */
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

/** Puts the README back and pushes again: the answer is taken, and checked. */
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

/** The answer's outcome is not in yet: the gate is still at it. */
class StillChecking extends Schema.TaggedError<StillChecking>()(
  "StillChecking",
  {}
) {}

/** How the loop waits for a landing: how often it asks, and for how long. */
export interface Patience {
  readonly every: Duration.Duration;
  readonly within: Duration.Duration;
}

/** What an outcome other than a landing says, in a line. */
const outcomeLine = (outcome: Outcome) =>
  Outcome.match(outcome, {
    AwaitingDecision: ({ decision }) => `waits on the decision ${decision}`,
    AwaitingFinish: () => "waits for a decider's finish",
    Checking: ({ stage }) => `is still being checked at ${stage}`,
    Landed: ({ sha }) => `landed as ${sha}`,
    Refused: ({ refusals }) =>
      `was refused: ${explain(refusals)
        .map((line) => line.trim())
        .join("; ")}`,
    WaitingOnParent: ({ ask }) => `waits for its parent ask ${ask} to land`,
  });

/**
 * Asks `<cli> status` as `answerer` until the answer at `head` is past the
 * gate: its landing, or the step fails with how it ended instead.
 */
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

/** What the landing commit on main says of itself. */
export interface LandingRead {
  readonly author: string;
  readonly committer: string;
  readonly trailers: readonly string[];
}

/**
 * Reads the landing on the project's main, from the answerer's clone: main
 * is at `landed`, and the commit's author, committer and trailers.
 */
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

/** Where verdicts live as git notes (`@repo/git/notes`'s `notesRef`). */
const NOTES = `refs/notes/${Brand.slug}`;

/** How long the loop waits for the verdict note, which follows the verdict. */
const NOTE_WAIT = { every: Duration.seconds(1), times: 30 } as const;

/** The verdict note is not on the answer's head yet. */
class NoNoteYet extends Schema.TaggedError<NoNoteYet>()("NoNoteYet", {}) {}

/**
 * Reads the verdict note on the answer's `head` in the fork, with plain
 * git, as the answerer: fetch the notes ref, then `git notes show`.
 */
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

// ------------------------------------------------------------------ drafts

/** What the loop's draft proposal wants: a reader of ordinal dates beside `parse`. */
const DRAFT_WANT =
  "src/parse.ts exports parseOrdinal, which reads an ordinal date such as 2026-280.";

const Proposed = Schema.Struct({ proposal: Proposal });

const Shown = Schema.Struct({ proposal: Proposal });

/** Proposes the draft's want as `proposer`, with `--draft`: the proposal, drafting. */
export const proposeDraft = (proposer: LoopPerson, project: ProjectName) =>
  Effect.map(
    cli(
      "draft-propose",
      proposer,
      ["propose", "--project", project, "--want", DRAFT_WANT, "--draft"],
      Proposed
    ),
    ({ proposal }) => proposal.id
  );

/** The draft is still being drafted. */
class StillDrafting extends Schema.TaggedError<StillDrafting>()(
  "StillDrafting",
  {}
) {}

/** A draft that went red first: the model that drafted it, and its attempts. */
export interface DraftReady {
  readonly model: string;
  readonly attempts: number;
}

/**
 * Asks `<cli> proposal <id>` as `reader` until the draft is settled: ready,
 * or the step fails with the last refusal a failed draft names.
 */
export const awaitDraft = (input: {
  readonly reader: LoopPerson;
  readonly project: ProjectName;
  readonly proposal: ProposalId;
  readonly patience: Patience;
}) =>
  Effect.gen(function* () {
    const { project, proposal, reader } = input;

    /** Where the draft stands: settled, or still drafting, which is asked again. */
    const settled = (
      shown: Proposal
    ): Effect.Effect<DraftState, LoopFailed | StillDrafting> =>
      Option.match(Option.fromUndefinedOr(shown.draft), {
        onNone: () =>
          Effect.fail(
            failed("draft-ready", `the proposal ${proposal} has no draft`)
          ),
        onSome: (state) =>
          DraftState.guards.Drafting(state)
            ? Effect.fail(new StillDrafting())
            : Effect.succeed(state),
      });

    const draft = yield* cli(
      "draft-ready",
      reader,
      ["proposal", proposal, "--project", project],
      Shown
    ).pipe(
      Effect.flatMap(({ proposal: shown }) => settled(shown)),
      Effect.retry({
        schedule: Schedule.spaced(input.patience.every).pipe(
          Schedule.upTo({ duration: input.patience.within })
        ),
        while: Schema.is(StillDrafting),
      }),
      Effect.catchTag("StillDrafting", () =>
        Effect.fail(
          failed(
            "draft-ready",
            `the proposal ${proposal} was still drafting after ${Duration.format(input.patience.within)}`
          )
        )
      )
    );

    if (DraftState.guards.Ready(draft)) {
      return {
        attempts: draft.attempts,
        model: draft.model,
      } satisfies DraftReady;
    }

    return yield* failed(
      "draft-ready",
      DraftState.guards.Failed(draft)
        ? `the draft of ${proposal} failed after ${draft.attempts} attempts, last refused ${draft.refusal}`
        : `the proposal ${proposal} is still drafting`
    );
  });

const TodayIs = Schema.Struct({ decisions: Schema.Array(Decision) });

const Decided = Schema.Struct({ decision: Decision });

/**
 * Accepts the drafted proposal as `decider`, from their Today, and reads
 * the landing that opened its ask on main, fetched from the platform at
 * `origin` into the repo at `dir`: its
 * trailers, which must disclose the drafter (`Assisted-by:`) and credit
 * `proposer` as its asker.
 */
export const acceptDraft = (input: {
  readonly decider: LoopPerson;
  readonly proposer: Handle;
  readonly project: ProjectName;
  readonly proposal: ProposalId;
  readonly dir: string;
  readonly origin: string;
}) =>
  Effect.gen(function* () {
    const { decider, dir, project, proposal } = input;

    const { decisions } = yield* cli(
      "draft-accept",
      decider,
      ["today", "--project", project],
      TodayIs
    );

    const decision = yield* Effect.fromOption(
      Array.findFirst(
        decisions,
        ({ subject }) =>
          DecisionSubject.guards.OpenProposal(subject) &&
          subject.proposal === proposal
      )
    ).pipe(
      Effect.mapError(() =>
        failed(
          "draft-accept",
          `${decider.handle}'s Today holds no decision on ${proposal}`
        )
      )
    );

    yield* cli(
      "draft-accept",
      decider,
      [
        "decide",
        "--project",
        project,
        "--decision",
        decision.id,
        "--choice",
        "accept",
        "--yes",
      ],
      Decided
    );

    yield* gitOk("draft-accept", decider, dir, [
      "fetch",
      "--quiet",
      `${input.origin}/${project}.git`,
      "refs/heads/main",
    ]);

    const trailers = (yield* gitOk("draft-accept", decider, dir, [
      "log",
      "-1",
      "--format=%(trailers:only,unfold)",
      "FETCH_HEAD",
    ]))
      .split("\n")
      .filter((line) => line.length > 0);

    const missing = [
      "Assisted-by: ",
      `Asked-by: ${input.proposer} `,
      "Ask: ",
    ].filter((prefix) => !trailers.some((line) => line.startsWith(prefix)));

    return missing.length === 0
      ? trailers
      : yield* failed(
          "draft-accept",
          `the landing that opened ${proposal}'s ask lacks ${missing.map((prefix) => prefix.trim()).join(" and ")}: its trailers are ${trailers.join("; ") || "none"}`
        );
  });
