/**
 * `init`: makes the repo the CLI stands in, or a public HTTPS repo, a
 * project on the platform. In a repo, it reads how the repo already sets up,
 * tests and lints (`@repo/checks/finder`), writes and commits a proposed
 * `<configDir>/project.ts` saying so, has the platform make the project
 * (`initProject`), adds the project as a remote, sets up git's credential
 * helper for its host, and pushes the first landing. With `--import`, the
 * platform copies the public repo once instead, and nothing here changes.
 * It acts only with `--yes`; `--dry-run` prints what it would do.
 */
import { Brand } from "@repo/brand";
import { findRunBlock } from "@repo/checks/finder";
import type { RepoFile } from "@repo/checks/finder";
import { Client } from "@repo/protocol/contracts";
import type { InitProject } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import type { LandedSha } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import {
  Effect,
  FileSystem,
  Option,
  Path,
  Runtime,
  Schema,
  Stream,
} from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { gitHelperConfig } from "../credentials.ts";
import { Output, Reported } from "../output.ts";
import { parseRemote, repoContext } from "../repo-context.ts";
import { projectFile } from "./project-file.ts";

const COMMAND = "init";

/** The config file `init` proposes, from the repo's root. */
const CONFIG = `${Brand.configDir}/project.ts`;

/** The one commit `init` makes: the config file alone. */
const SUBJECT = `Add ${CONFIG}: the run block ${Brand.cli} ${COMMAND} found`;

/** What `--dry-run` shows where the platform's answer will go. */
const PENDING = { origin: "<platform>", remote: "<remote>" } as const;

/**
 * `init` changes things, so it acts only with `--yes`; `--dry-run` shows
 * what it would do. A usage error: the process exits 2.
 */
export class ApprovalNeeded extends Schema.TaggedError<ApprovalNeeded>()(
  "ApprovalNeeded",
  { command: Schema.String }
) {
  override readonly [Runtime.errorExitCode] = 2;

  override get message() {
    return `${Brand.cli} ${this.command} makes a project and pushes to it, so it acts only with --yes; --dry-run shows what it would do`;
  }
}

/** `init`'s flags ask for something it can't do. A usage error: exit 2. */
export class InitMisused extends Schema.TaggedError<InitMisused>()(
  "InitMisused",
  { reason: Schema.String }
) {
  override readonly [Runtime.errorExitCode] = 2;

  override get message() {
    return this.reason;
  }
}

/** A git command `init` ran failed; git's own words say why. */
export class GitFailed extends Schema.TaggedError<GitFailed>()("GitFailed", {
  argv: Schema.Array(Schema.String),
  stderr: Schema.String,
}) {
  override get message() {
    return `${this.argv.join(" ")} failed: ${this.stderr.trim()}`;
  }
}

/** The payload `initProject` takes. */
type Payload = typeof InitProject.payloadSchema.Type;

/** What `init` would write, send and run: `--dry-run` prints it. */
interface Plan {
  readonly files: readonly RepoFile[];
  readonly git: readonly (readonly string[])[];
  readonly payload: Payload;
}

const flags = {
  branch: Flag.String("branch").pipe(
    Flag.withDescription(
      "With --import: the branch to copy, instead of the repo's default."
    ),
    Flag.optional
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDefault(false),
    Flag.withDescription(
      "Print what init would write, send and run; do none of it."
    )
  ),
  import: Flag.String("import").pipe(
    Flag.withDescription(
      "A public repo's https:// URL for the platform to copy once, instead of this repo."
    ),
    Flag.optional
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Print machine-readable JSON")
  ),
  project: Flag.String("project").pipe(
    Flag.withDescription(
      "The project's name; by default this repo's folder, or the imported repo's name."
    ),
    Flag.optional
  ),
  push: Flag.Boolean("push").pipe(
    Flag.withDefault(true),
    Flag.withDescription(
      "Push HEAD to the new project's main (--no-push leaves that to you)."
    )
  ),
  yes: Flag.Boolean("yes").pipe(
    Flag.withDefault(false),
    Flag.withDescription(
      "Do it: write and commit the config, make the project, push."
    )
  ),
};

type Input = Command.Command.Config.Infer<typeof flags>;

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** Runs `argv` in `cwd` to the end; a failing command is a result, not an error. */
const run = (cwd: string, argv: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const [command = "git", ...args] = argv;

      const child = yield* spawner.spawn(
        ChildProcess.make(command, args, { cwd, stdin: "ignore" })
      );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [text(child.stdout), text(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { exitCode, stderr, stdout };
    })
  );

/** Runs `argv` in `cwd`, failing with git's own words when it fails. */
const runOk = (cwd: string, argv: readonly string[]) =>
  run(cwd, argv).pipe(
    Effect.filterOrFail(
      (ran) => ran.exitCode === 0,
      (ran) => new GitFailed({ argv, stderr: ran.stderr })
    )
  );

/** An argument as a shell reads it back: quoted only when it must be. */
const shellWord = (word: string) =>
  /^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

const shown = (argv: readonly string[]) => argv.map(shellWord).join(" ");

/**
 * The tracked files whose contents say how a repo sets up, tests and lints,
 * for the finder and the judge closure: every `package.json`, every
 * `tsconfig*.json`, CI workflows and hook configs.
 */
const READ = [
  /(?:^|\/)package\.json$/u,
  /(?:^|\/)tsconfig[^/]*\.json$/u,
  /^\.(?:github|forgejo)\/workflows\/[^/]+\.ya?ml$/u,
  /^\.?lefthook\.ya?ml$/u,
  /^\.husky\/[^/]+$/u,
  /^\.pre-commit-config\.yaml$/u,
];

/** Every tracked path, with contents for the files the finder reads (205 #5). */
const trackedFiles = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const listed = yield* runOk(root, ["git", "ls-files", "-z"]);

    return yield* Effect.forEach(
      listed.stdout.split("\0").filter((file) => file !== ""),
      (file): Effect.Effect<RepoFile> =>
        READ.some((pattern) => pattern.test(file))
          ? fs.readFileString(path.join(root, file)).pipe(
              Effect.orElseSucceed(() => ""),
              Effect.map((content) => ({ content, path: file }))
            )
          : Effect.succeed({ content: "", path: file }),
      { concurrency: 16 }
    );
  });

/** A name as a project's, or a usage error saying to name it. */
const projectNamed = (given: Option.Option<string>, fallback: string) =>
  Option.match(given, {
    onNone: () =>
      Effect.mapError(
        Schema.decodeEffect(ProjectName)(fallback),
        () =>
          new InitMisused({
            reason: `name the project with --project: "${fallback}" is no project name (lowercase words joined by dashes)`,
          })
      ),
    onSome: (name) =>
      Effect.mapError(
        Schema.decodeEffect(ProjectName)(name),
        () =>
          new InitMisused({
            reason: `--project "${name}" is no project name: use lowercase words joined by dashes`,
          })
      ),
  });

const HTTPS = /^https:\/\/\S+$/u;

const pathnameOf = Option.liftThrowable((url: string) => new URL(url).pathname);

/** The repo name an import URL ends in: `…/acme/widgets.git` → `widgets`. */
const lastSegment = (url: string) =>
  Option.getOrElse(pathnameOf(url), () => "")
    .split("/")
    .findLast((segment) => segment !== "")
    ?.replace(/\.git$/u, "") ?? "";

/** The project's remote and how to reach it: `git remote add|set-url`, the helper, the push. */
const wiring = (input: {
  readonly hasRemote: boolean;
  readonly origin: Option.Option<string>;
  readonly push: boolean;
  readonly remote: string;
}): readonly (readonly string[])[] => [
  [
    "git",
    "remote",
    input.hasRemote ? "set-url" : "add",
    Brand.slug,
    input.remote,
  ],
  ...Option.match(input.origin, {
    onNone: () => [],
    onSome: gitHelperConfig,
  }),
  ...(input.push ? [["git", "push", Brand.slug, "HEAD:main"]] : []),
];

/** The config file's commit: added, then committed alone. */
const committing = (paths: readonly string[]) =>
  paths.flatMap((path) => [
    ["git", "add", "--", path],
    ["git", "commit", "--quiet", "--message", SUBJECT, "--", path],
  ]);

/** Prints `refusal` once, as the CLI prints every refusal, and ends as `Reported`. */
const refuse = (json: boolean) => (refusal: Refusal) =>
  Effect.gen(function* () {
    const output = yield* Output;

    yield* output.refused({ command: COMMAND, json, refusals: [refusal] });

    return yield* new Reported();
  });

/** Asks the platform to make the project; a refusal is printed once. */
const makeProject = (payload: Payload, json: boolean) =>
  Effect.gen(function* () {
    const client = yield* Client;

    return yield* client.initProject(payload).pipe(
      Effect.catchTags({
        ImportFailed: refuse(json),
        ProjectExists: refuse(json),
      })
    );
  });

/** `--dry-run` prints the plan; without `--yes` nothing happens at all. */
const approved = (input: Input, plan: Plan) =>
  Effect.gen(function* () {
    if (input.dryRun) {
      const output = yield* Output;

      yield* output.plan({ command: COMMAND, json: input.json, payload: plan });

      return false;
    }

    if (!input.yes) {
      return yield* new ApprovalNeeded({ command: COMMAND });
    }

    return true;
  });

/** An import comes from a public `https://` URL, or not at all. */
const httpsOnly = (url: string) =>
  HTTPS.test(url)
    ? Effect.void
    : Effect.fail(
        new InitMisused({
          reason: `--import takes a public repo's https:// URL, and ${url} is not one`,
        })
      );

/** `--branch` says which branch to import, so it needs `--import`. */
const importOnly = (branch: Option.Option<string>) =>
  Option.isNone(branch)
    ? Effect.void
    : Effect.fail(
        new InitMisused({
          reason:
            "--branch names the branch to import, so it goes with --import",
        })
      );

/** A reply as `--json` prints it: `landed` only when the platform gave one. */
const withLanded = <A extends object>(
  data: A,
  landed: LandedSha | undefined
) => (landed === undefined ? data : { ...data, landed });

/** Has the platform copy the repo at `url`, and says how to clone the project. */
const imported = (input: Input, url: string, payload: Payload) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const reply = yield* makeProject(payload, input.json);
    const clone = `git clone ${reply.remote}`;

    yield* output.success({
      command: COMMAND,
      data: withLanded(
        {
          clone,
          files: [],
          project: reply.project,
          pushed: false,
          remote: reply.remote,
        },
        reply.landed
      ),
      json: input.json,
      view: {
        markdown: `Imported ${url} as project **${reply.project}**. Clone it with:\n\n\`\`\`sh\n${clone}\n\`\`\``,
        text: `Imported ${url} as project ${reply.project}. Clone it with:\n  ${clone}`,
      },
    });
  });

/** `init --import <url>`: the platform copies a public repo; nothing here changes. */
const importing = (input: Input, url: string) =>
  Effect.gen(function* () {
    yield* httpsOnly(url);

    const project = yield* projectNamed(input.project, lastSegment(url));

    // The contract takes a non-empty branch; the client can't send an empty one.
    const source = yield* Option.match(input.branch, {
      onNone: () => Effect.succeed({ url }),
      onSome: (branch) =>
        branch === ""
          ? Effect.fail(
              new InitMisused({
                reason: "--branch takes the name of the branch to import",
              })
            )
          : Effect.succeed({ branch, url }),
    });

    const payload: Payload = { import: source, project };

    if (yield* approved(input, { files: [], git: [], payload })) {
      yield* imported(input, url, payload);
    }
  });

/** What `init` found in the repo it stands in, and so will do there. */
interface Found {
  /** The config file to commit: none when HEAD has one. */
  readonly commits: readonly string[];
  /** Whether the repo already has a remote by the CLI's name. */
  readonly hasRemote: boolean;
  readonly payload: Payload;
  readonly root: string;
  /** The config file to write: none when the work tree or HEAD has one. */
  readonly writes: readonly RepoFile[];
}

/** Writes and commits the config, makes the project, wires the remote and pushes. */
const made = (input: Input, found: Found) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const output = yield* Output;
    const { commits, hasRemote, payload, root, writes } = found;

    if (writes.length === 0) {
      yield* output.note(`kept ${CONFIG} as it is`);
    }

    for (const file of writes) {
      yield* fs.makeDirectory(path.dirname(path.join(root, file.path)), {
        recursive: true,
      });
      yield* fs.writeFileString(path.join(root, file.path), file.content);
    }

    for (const argv of committing(commits)) {
      yield* runOk(root, argv);
    }

    const reply = yield* makeProject(payload, input.json);
    const origin = Option.map(parseRemote(reply.remote), (at) => at.origin);

    for (const argv of wiring({
      hasRemote,
      origin,
      push: input.push,
      remote: reply.remote,
    })) {
      if (argv.includes("--global")) {
        yield* output.note(`changed your git config: ${shown(argv)}`);
      }

      const ran = yield* runOk(root, argv);

      if (argv[1] === "push" && ran.stderr.trim() !== "") {
        yield* output.note(ran.stderr.trimEnd());
      }
    }

    const config =
      writes.length === 0 ? `Kept ${CONFIG} as it is` : `Wrote ${CONFIG}`;

    const done = [
      `Made project ${reply.project} at ${reply.remote}.`,
      commits.length === 0 ? `${config}.` : `${config} and committed it alone.`,
      input.push
        ? `Pushed HEAD to its main through the remote ${Brand.slug}.`
        : `Push when ready: git push ${Brand.slug} HEAD:main`,
    ];

    yield* output.success({
      command: COMMAND,
      data: withLanded(
        {
          files: commits,
          project: reply.project,
          pushed: input.push,
          remote: reply.remote,
        },
        reply.landed
      ),
      json: input.json,
      view: { markdown: done.join("\n\n"), text: done.join("\n") },
    });
  });

/** `init` in a repo: propose the config, make the project, wire the remote, push. */
const inRepo = (input: Input) =>
  Effect.gen(function* () {
    yield* importOnly(input.branch);

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // The folder the CLI was started in: git and the spawner resolve it.
    const { root } = yield* repoContext(".");
    const project = yield* projectNamed(input.project, path.basename(root));
    const inTree = yield* fs.exists(path.join(root, CONFIG));

    // HEAD is what the push sends: a config only the work tree has (a run
    // whose commit failed left it) is kept as it is, and committed.
    const atHead =
      (yield* run(root, ["git", "cat-file", "-e", `HEAD:${CONFIG}`]))
        .exitCode === 0;

    const block = findRunBlock(yield* trackedFiles(root));

    const writes: readonly RepoFile[] =
      inTree || atHead
        ? []
        : [{ content: projectFile(block.run, block.sources), path: CONFIG }];

    const commits: readonly string[] = atHead ? [] : [CONFIG];

    const hasRemote =
      (yield* run(root, ["git", "remote", "get-url", Brand.slug])).exitCode ===
      0;

    const payload: Payload = { project };

    const plan: Plan = {
      files: writes,
      git: [
        ...committing(commits),
        ...wiring({
          hasRemote,
          origin: Option.some(PENDING.origin),
          push: input.push,
          remote: PENDING.remote,
        }),
      ],
      payload,
    };

    if (yield* approved(input, plan)) {
      yield* made(input, { commits, hasRemote, payload, root, writes });
    }
  });

export const init = Command.make(COMMAND, flags, (input) =>
  Option.match(input.import, {
    onNone: () => inRepo(input),
    onSome: (url) => importing(input, url),
  })
).pipe(
  Command.withDescription(
    "Make this repo, or a public HTTPS repo, a project: find its checks, write its config and push."
  )
);
