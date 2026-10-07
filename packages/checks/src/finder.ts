/**
 * The command finder: a project's own commands (how to set up, how to run
 * one test file, and the lanes every answer must pass), read from the files
 * it already has: GitHub and Forgejo workflows, lefthook, husky, pre-commit
 * and `package.json` scripts. Pure: it reads the contents it is given and
 * runs nothing. A maintainer confirms what it finds at init.
 */
import type { RunBlock } from "@repo/protocol/domain/run";
import { LaneName } from "@repo/protocol/ids";
import { Array as Arr, Option, Result, Schema } from "effect";
import { parse } from "yaml";

/** The run block as it travels before decoding. */
export type RunBlockEncoded = typeof RunBlock.Encoded;

/** One file of a repo, by its path from the root. */
export interface RepoFile {
  readonly content: string;
  readonly path: string;
}

/**
 * What the finder found: a partial run block, and where each part came from
 * (`checks.lint from .github/workflows/ci.yml`), plus every file it skipped
 * and why (`skipped <path>: <reason>`). The shape `@repo/rules`'
 * `Finishers.findRunBlock` takes.
 */
export interface FoundRunBlock {
  readonly run: Partial<RunBlockEncoded>;
  readonly sources: readonly string[];
}

/** The placeholder a `test` command holds for the one check file it runs. */
const PATH = "{path}";

/** The lane names the finder prefers; any other lane takes its script's name. */
type Canonical = "build" | "format" | "lint" | "types" | "unit";

const isLaneName = Schema.is(LaneName);

const words = (command: string): readonly string[] =>
  command.trim().split(/\s+/u).filter(Boolean);

const startsWith = (tokens: readonly string[], prefix: readonly string[]) =>
  prefix.every((word, index) => tokens[index] === word);

const hasAny = (tokens: readonly string[], flags: readonly string[]) =>
  tokens.some((token) =>
    flags.some((flag) => token === flag || token.startsWith(`${flag}=`))
  );

// --- What a command is --------------------------------------------------

const SETUP: readonly (readonly string[])[] = [
  ["corepack", "enable"],
  ["npm", "ci"],
  ["npm", "install"],
  ["npm", "i"],
  ["pnpm", "install"],
  ["pnpm", "i"],
  ["yarn", "install"],
  ["bun", "install"],
  ["bun", "i"],
  ["pip", "install"],
  ["pip3", "install"],
  ["python", "-m", "pip", "install"],
  ["python3", "-m", "pip", "install"],
  ["uv", "sync"],
  ["uv", "pip", "install"],
  ["poetry", "install"],
  ["pipenv", "install"],
  ["pdm", "install"],
  ["go", "mod", "download"],
  ["cargo", "fetch"],
  ["bundle", "install"],
  ["pre-commit", "install-hooks"],
];

// Leading `NAME=value` words set the environment; they aren't the command.
const withoutEnv = (tokens: readonly string[]) => {
  const first = tokens.findIndex((token) => !/^\w+=/u.test(token));

  return first === -1 ? [] : tokens.slice(first);
};

const isSetup = (command: string) => {
  const tokens = withoutEnv(words(command));

  return (
    (tokens.length === 1 && tokens[0] === "yarn") ||
    SETUP.some((prefix) => startsWith(tokens, prefix))
  );
};

// Words that run a tool rather than being one: `npx eslint`, `uv run pytest`.
const RUNNERS: readonly (readonly string[])[] = [
  ["npx"],
  ["bunx"],
  ["pnpm", "exec"],
  ["pnpm", "dlx"],
  ["yarn", "exec"],
  ["yarn", "dlx"],
  ["npm", "exec", "--"],
  ["npm", "exec"],
  ["uv", "run"],
  ["poetry", "run"],
  ["pipenv", "run"],
  ["pdm", "run"],
  ["hatch", "run"],
  ["python", "-m"],
  ["python3", "-m"],
  // pnpm and yarn run a package's binary by its bare name: `pnpm vitest`.
  ["pnpm"],
  ["yarn"],
];

/** Where the tool starts in a command's words, past env and runner words. */
const toolIndex = (tokens: readonly string[]): number => {
  let at = tokens.length - withoutEnv(tokens).length;

  for (
    let runner = RUNNERS.find((prefix) => startsWith(tokens.slice(at), prefix));
    runner !== undefined;
    runner = RUNNERS.find((prefix) => startsWith(tokens.slice(at), prefix))
  ) {
    at += runner.length;
  }

  return at;
};

const CHECK_FLAGS = ["--check", "-c", "--list-different", "-l"];

/** A tool's words, the lane it checks, and whether these arguments check. */
const TOOLS: readonly {
  readonly lane: Canonical;
  readonly tool: readonly string[];
  readonly when?: (args: readonly string[]) => boolean;
}[] = [
  { lane: "unit", tool: ["vitest"] },
  { lane: "unit", tool: ["jest"] },
  { lane: "unit", tool: ["mocha"] },
  { lane: "unit", tool: ["ava"] },
  { lane: "unit", tool: ["bun", "test"] },
  { lane: "unit", tool: ["node", "--test"] },
  { lane: "unit", tool: ["deno", "test"] },
  { lane: "unit", tool: ["pytest"] },
  { lane: "unit", tool: ["go", "test"] },
  { lane: "unit", tool: ["cargo", "test"] },
  { lane: "unit", tool: ["zig", "build", "test"] },
  { lane: "lint", tool: ["eslint"] },
  { lane: "lint", tool: ["oxlint"] },
  { lane: "lint", tool: ["biome", "lint"] },
  { lane: "lint", tool: ["biome", "check"] },
  { lane: "lint", tool: ["biome", "ci"] },
  { lane: "lint", tool: ["ruff", "check"] },
  {
    lane: "format",
    tool: ["ruff", "format"],
    when: (args) => hasAny(args, CHECK_FLAGS),
  },
  // Bare `ruff` is `ruff check`; `ruff format` without `--check` rewrites.
  { lane: "lint", tool: ["ruff"], when: (args) => args[0] !== "format" },
  { lane: "lint", tool: ["flake8"] },
  { lane: "lint", tool: ["pylint"] },
  { lane: "lint", tool: ["golangci-lint"] },
  { lane: "lint", tool: ["go", "vet"] },
  { lane: "lint", tool: ["cargo", "clippy"] },
  { lane: "lint", tool: ["stylelint"] },
  { lane: "lint", tool: ["next", "lint"] },
  { lane: "lint", tool: ["deno", "lint"] },
  { lane: "lint", tool: ["shellcheck"] },
  {
    lane: "build",
    tool: ["tsc"],
    when: (args) => hasAny(args, ["-b", "--build"]),
  },
  { lane: "types", tool: ["tsc"] },
  { lane: "types", tool: ["tsgo"] },
  { lane: "types", tool: ["vue-tsc"] },
  { lane: "types", tool: ["mypy"] },
  { lane: "types", tool: ["pyright"] },
  { lane: "types", tool: ["basedpyright"] },
  { lane: "types", tool: ["deno", "check"] },
  {
    lane: "format",
    tool: ["prettier"],
    when: (args) => hasAny(args, CHECK_FLAGS),
  },
  {
    lane: "format",
    tool: ["oxfmt"],
    when: (args) => hasAny(args, ["--check"]),
  },
  {
    lane: "format",
    tool: ["biome", "format"],
    when: (args) => !hasAny(args, ["--write"]),
  },
  {
    lane: "format",
    tool: ["black"],
    when: (args) => hasAny(args, ["--check"]),
  },
  {
    lane: "format",
    tool: ["cargo", "fmt"],
    when: (args) => hasAny(args, ["--check"]),
  },
  { lane: "format", tool: ["gofmt"], when: (args) => hasAny(args, ["-l"]) },
  {
    lane: "format",
    tool: ["deno", "fmt"],
    when: (args) => hasAny(args, ["--check"]),
  },
  { lane: "build", tool: ["vite", "build"] },
  { lane: "build", tool: ["next", "build"] },
  { lane: "build", tool: ["tsup"] },
  { lane: "build", tool: ["tsdown"] },
  { lane: "build", tool: ["cargo", "build"] },
  { lane: "build", tool: ["go", "build"] },
  { lane: "build", tool: ["zig", "build"] },
];

/** Script, task and hook names that say their lane outright. */
const NAMED: readonly { readonly lane: Canonical; readonly names: RegExp }[] = [
  { lane: "unit", names: /^(?:tests?|unit|tests?[:-](?:unit|ci))$/u },
  { lane: "lint", names: /^(?:lint|lint[:-](?:check|ci)|eslint|oxlint)$/u },
  {
    lane: "types",
    names:
      /^(?:types?|typecheck|type-check|tsc|(?:check[:-])types|types?[:-]check|typecheck[:-]ci)$/u,
  },
  {
    lane: "format",
    names: /^(?:(?:format|fmt|prettier)[:-]check|check[:-](?:format|fmt))$/u,
  },
  { lane: "build", names: /^build$/u },
];

// Names that are never a check, even when a workflow runs them.
const NEVER_A_LANE =
  /(?:^|[:-])(?:dev|start|serve|preview|watch|deploy|release|publish|prepare|install|clean|version|fix|docs)(?:$|[:-])/u;

const namedLane = (name: string): Option.Option<Canonical> =>
  Option.fromNullishOr(NAMED.find(({ names }) => names.test(name))?.lane);

/** A name as a lane name: `test:e2e` → `test-e2e`. */
const asLaneName = (name: string): Option.Option<string> =>
  Option.liftPredicate(
    name.replaceAll(/[^A-Za-z0-9-]+/gu, "-").replaceAll(/^-+|-+$/gu, ""),
    isLaneName
  );

/** A script or task's name as a lane, unless the name says it checks nothing. */
const scriptLane = (name: string): Option.Option<string> =>
  NEVER_A_LANE.test(name) ? Option.none() : asLaneName(name);

const FIXERS = ["--fix", "--write"];

/** Whether a command, or any command a script chains, rewrites files. */
const fixes = (body: string) =>
  body.split("&&").some((part) => hasAny(words(part), FIXERS));

/** The lane a tool command checks: `npx eslint .` → `lint`. Fixers check nothing. */
const toolLane = (command: string): Option.Option<Canonical> => {
  const tokens = words(command);
  const rest = tokens.slice(toolIndex(tokens));

  if (hasAny(rest, FIXERS)) {
    return Option.none();
  }

  return Option.fromNullishOr(
    TOOLS.find(
      ({ tool, when }) =>
        startsWith(rest, tool) && (when?.(rest.slice(tool.length)) ?? true)
    )?.lane
  );
};

// --- Scripts -------------------------------------------------------------

type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

const MANAGERS: readonly PackageManager[] = ["bun", "npm", "pnpm", "yarn"];

const isManager = (word: string | undefined): word is PackageManager =>
  MANAGERS.some((manager) => manager === word);

/** What the repo's root `package.json` says: its scripts and package manager. */
interface Scripts {
  readonly byName: ReadonlyMap<string, string>;
  readonly manager: Option.Option<PackageManager>;
}

/**
 * The script a command runs, if it runs one: `npm test`, `bun run lint`,
 * `pnpm typecheck` (a pnpm or yarn word that names a script).
 */
const scriptOf = (command: string, scripts: Scripts): Option.Option<string> => {
  const [manager, verb, name] = withoutEnv(words(command));

  if (!isManager(manager)) {
    return Option.none();
  }

  if (verb === "test" || verb === "t") {
    return manager === "bun" && verb === "test"
      ? Option.none()
      : Option.some("test");
  }

  if ((verb === "run" || verb === "run-script") && name !== undefined) {
    return Option.some(name);
  }

  return manager !== "npm" && verb !== undefined && scripts.byName.has(verb)
    ? Option.some(verb)
    : Option.none();
};

// Task runners name a task the way a script is named: `make test`,
// `just lint`, `turbo run typecheck`; several turbo tasks make one lane.
const TASKS: readonly (readonly string[])[] = [
  ["make"],
  ["just"],
  ["task"],
  ["mise", "run"],
  ["turbo", "run"],
  ["turbo"],
];

const taskOf = (command: string): Option.Option<string> => {
  const tokens = withoutEnv(words(command));
  const runner = TASKS.find((prefix) => startsWith(tokens, prefix)) ?? [];

  const names = tokens
    .slice(runner.length)
    .filter((word) => !word.startsWith("-"));

  return runner.length > 0 && names.length > 0
    ? Option.some(names.join("-"))
    : Option.none();
};

const segments = (body: string) => body.split("&&").map((part) => part.trim());

/** A script's body, followed through scripts that only run another script. */
const bodyOf = (
  name: string,
  scripts: Scripts,
  depth = 0
): Option.Option<string> =>
  Option.flatMap(Option.fromNullishOr(scripts.byName.get(name)), (body) => {
    const [only, ...more] = segments(body);

    const inner =
      only === undefined || more.length > 0 || depth > 3
        ? Option.none()
        : scriptOf(only, scripts);

    return Option.isSome(inner) && inner.value !== name
      ? Option.orElse(bodyOf(inner.value, scripts, depth + 1), () =>
          Option.some(body)
        )
      : Option.some(body);
  });

/** How the repo's package manager runs a script: `pnpm run build`, `npm test`. */
const runScript = (manager: PackageManager, name: string) =>
  manager === "npm" && name === "test" ? "npm test" : `${manager} run ${name}`;

// --- One test file ------------------------------------------------------

const insertBefore = (
  tokens: readonly string[],
  marker: string,
  added: readonly string[]
) => {
  const at = tokens.indexOf(marker);

  return at === -1
    ? [...tokens, ...added]
    : [...tokens.slice(0, at), ...added, ...tokens.slice(at)];
};

/**
 * The command that runs one test file, for runners that can: `vitest run`
 * → `vitest run {path}`. Go runs a package and Cargo a test target, so theirs
 * name the file's directory or stem through the shell.
 */
const oneFile = (command: string): Option.Option<string> => {
  const tokens = words(command);
  const at = toolIndex(tokens);
  const head = tokens.slice(0, at);
  const rest = tokens.slice(at);

  const write = (...parts: readonly string[]) =>
    Option.some([...head, ...parts].join(" "));

  if (startsWith(rest, ["vitest"])) {
    const args = rest[1] === "run" ? rest.slice(2) : rest.slice(1);

    return write("vitest", "run", ...args, PATH);
  }

  if (
    ["jest", "mocha", "ava", "pytest"].some((tool) => rest[0] === tool) ||
    [
      ["bun", "test"],
      ["node", "--test"],
      ["deno", "test"],
    ].some((tool) => startsWith(rest, tool))
  ) {
    return write(...rest, PATH);
  }

  if (startsWith(rest, ["go", "test"])) {
    const flags = rest.slice(2).filter((arg) => arg.startsWith("-"));

    return write("go", "test", ...flags, `"./$(dirname ${PATH})"`);
  }

  if (startsWith(rest, ["cargo", "test"])) {
    return write(
      ...insertBefore(rest, "--", ["--test", `"$(basename ${PATH} .rs)"`])
    );
  }

  return Option.none();
};

// --- Reading sources ----------------------------------------------------

/** A command a source runs, with the name the source gives it, if any. */
interface Step {
  readonly command: string;
  readonly name: Option.Option<string>;
}

/** A lane a source offers: its command, and the file its test runner was read from. */
interface Offer {
  readonly command: string;
  readonly fallback: Option.Option<string>;
  readonly lane: string;
  readonly path: string;
  readonly runner: { readonly body: string; readonly path: string };
}

/** One source file, read: its setup commands and lanes, or why it was skipped. */
interface Read {
  readonly offers: readonly Offer[];
  readonly path: string;
  readonly setup: readonly string[];
}

const PACKAGE_JSON = "package.json";

// An error's message on one line, for a `skipped …` source.
const oneLine = (message: string) =>
  message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

/**
 * A YAML file decoded by `schema`, or why not. YAML errors keep their first
 * line (the rest is a code frame); schema errors keep every line.
 */
const readYaml = <A>(
  schema: Schema.ConstraintDecoder<A>,
  content: string
): Result.Result<A, string> =>
  Result.try({
    catch: (thrown) => String(thrown).split("\n")[0] ?? "unreadable YAML",
    try: () =>
      Schema.decodeUnknownResult(schema)(
        parse(content, { logLevel: "error", strict: false })
      ),
  }).pipe(
    Result.flatMap((decoded) =>
      Result.mapError(decoded, (issue) => oneLine(issue.message))
    )
  );

// A shell line split into the commands it chains; comments and blank lines
// dropped, `\` continuations joined.
const shellCommands = (text: string): readonly string[] =>
  text
    .replaceAll("\\\n", " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .flatMap(segments)
    .filter((command) => command !== "");

const Workflow = Schema.Struct({
  jobs: Schema.Record(
    Schema.String,
    Schema.Struct({
      steps: Schema.optionalKey(
        Schema.Array(Schema.Struct({ run: Schema.optionalKey(Schema.String) }))
      ),
    })
  ),
});

const workflowSteps = (content: string) =>
  readYaml(Workflow, content).pipe(
    Result.map((workflow) =>
      Object.values(workflow.jobs)
        .flatMap((job) => job.steps ?? [])
        .flatMap((step) => shellCommands(step.run ?? ""))
        // A workflow expression has no value until the workflow runs.
        .filter((command) => !command.includes("${{"))
        .map((command): Step => ({ command, name: Option.none() }))
    )
  );

const LefthookHook = Schema.Struct({
  commands: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Struct({ run: Schema.optionalKey(Schema.String) })
    )
  ),
  jobs: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        run: Schema.optionalKey(Schema.String),
      })
    )
  ),
});

const Lefthook = Schema.Struct({
  "pre-commit": Schema.optionalKey(LefthookHook),
  "pre-push": Schema.optionalKey(LefthookHook),
});

// Lefthook fills these with the files a commit touches; a check runs on all.
const lefthookFiles = (command: string) =>
  command.replaceAll(/\{(?:staged_files|push_files|all_files|files)\}/gu, ".");

const lefthookSteps = (content: string) =>
  readYaml(Lefthook, content).pipe(
    Result.map((config) =>
      [config["pre-commit"], config["pre-push"]].flatMap((hook) => [
        ...Object.entries(hook?.commands ?? {}).flatMap(([name, { run }]) =>
          shellCommands(lefthookFiles(run ?? "")).map((command): Step => ({
            command,
            name: Option.some(name),
          }))
        ),
        ...(hook?.jobs ?? []).flatMap(({ name, run }) =>
          shellCommands(lefthookFiles(run ?? "")).map((command): Step => ({
            command,
            name: Option.fromNullishOr(name),
          }))
        ),
      ])
    )
  );

// Husky's own lines source its helper; they aren't the project's commands.
const huskySteps = (content: string): readonly Step[] =>
  shellCommands(content)
    .filter((line) => !/^(?:\.|source)\s/u.test(line))
    .map((command) => ({ command, name: Option.none() }));

const PreCommit = Schema.Struct({
  repos: Schema.Array(
    Schema.Struct({
      hooks: Schema.Array(
        Schema.Struct({
          id: Schema.NonEmptyString,
          stages: Schema.optionalKey(Schema.Array(Schema.String)),
        })
      ),
    })
  ),
});

const PRE_COMMIT_STAGES = new Set(["commit", "pre-commit"]);

/** pre-commit's hook ids that name a canonical lane. */
const HOOKS: ReadonlyMap<string, Canonical> = new Map([
  ["ruff", "lint"],
  ["ruff-check", "lint"],
  ["flake8", "lint"],
  ["pylint", "lint"],
  ["eslint", "lint"],
  ["golangci-lint", "lint"],
  ["ruff-format", "format"],
  ["black", "format"],
  ["prettier", "format"],
  ["isort", "format"],
  ["mypy", "types"],
  ["pyright", "types"],
  ["pytest", "unit"],
]);

const fileNamed = (path: string) => (file: RepoFile) => file.path === path;

const workflowFile = /^\.(?:github|forgejo)\/workflows\/[^/]+\.ya?ml$/u;

const isWorkflow = (file: RepoFile) => workflowFile.test(file.path);

const huskyFile = /^\.husky\/pre-(?:commit|push)$/u;

const LEFTHOOK = new Set(["lefthook.yml", "lefthook.yaml", ".lefthook.yml"]);

const PRE_COMMIT = ".pre-commit-config.yaml";

const byPath = (left: RepoFile, right: RepoFile) =>
  left.path < right.path ? -1 : Number(left.path > right.path);

const PackageJson = Schema.fromJsonString(
  Schema.Struct({
    packageManager: Schema.optionalKey(Schema.String),
    scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  })
);

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

// --- Putting it together ------------------------------------------------

const offerFromStep = (
  step: Step,
  path: string,
  scripts: Scripts
): Option.Option<Offer> => {
  const script = scriptOf(step.command, scripts);
  const body = Option.flatMap(script, (name) => bodyOf(name, scripts));

  const runner = Option.match(body, {
    onNone: () => ({ body: step.command, path }),
    onSome: (text) => ({ body: text, path: PACKAGE_JSON }),
  });

  const task = Option.orElse(script, () => taskOf(step.command));
  const ownName = Option.orElse(step.name, () => task);
  const byBody = Option.firstSomeOf(segments(runner.body).map(toolLane));

  const lane = Option.isSome(task)
    ? Option.orElse(namedLane(task.value), () => byBody)
    : Option.orElse(toolLane(step.command), () =>
        Option.flatMap(step.name, namedLane)
      );

  const fallback = Option.flatMap(ownName, scriptLane);

  return fixes(runner.body)
    ? Option.none()
    : Option.map(
        Option.orElse(lane, () => fallback),
        (name) => ({
          command: step.command,
          fallback,
          lane: name,
          path,
          runner,
        })
      );
};

const readSteps = (
  file: RepoFile,
  steps: readonly Step[],
  scripts: Scripts
): Read => ({
  offers: steps.flatMap((step) =>
    isSetup(step.command)
      ? []
      : Option.toArray(offerFromStep(step, file.path, scripts))
  ),
  path: file.path,
  setup: steps.flatMap(({ command }) => (isSetup(command) ? [command] : [])),
});

const readPreCommit = (file: RepoFile) =>
  readYaml(PreCommit, file.content).pipe(
    Result.map((config): Read => ({
      offers: config.repos
        .flatMap(({ hooks }) => hooks)
        .filter(
          ({ stages }) =>
            stages === undefined ||
            stages.some((stage) => PRE_COMMIT_STAGES.has(stage))
        )
        .flatMap(({ id }) => {
          const command = `pre-commit run ${id} --all-files`;
          const fallback = asLaneName(id);

          return Option.toArray(
            Option.map(
              Option.orElse(
                Option.fromNullishOr(HOOKS.get(id)),
                () => fallback
              ),
              (lane) => ({
                command,
                fallback,
                lane,
                path: file.path,
                runner: { body: command, path: file.path },
              })
            )
          );
        }),
      path: file.path,
      setup: [],
    }))
  );

// Root scripts that name or run a check become lanes, run the repo's way.
const readScripts = (manager: PackageManager, scripts: Scripts): Read => ({
  offers: [...scripts.byName].flatMap(([name, body]) => {
    const lane = Option.orElse(namedLane(name), () =>
      Option.firstSomeOf(segments(body).map(toolLane))
    );

    return fixes(body) || NEVER_A_LANE.test(name)
      ? []
      : Option.toArray(
          Option.map(lane, (found) => ({
            command: runScript(manager, name),
            fallback: scriptLane(name),
            lane: found,
            path: PACKAGE_JSON,
            runner: {
              body: Option.getOrElse(bodyOf(name, scripts), () => body),
              path: PACKAGE_JSON,
            },
          }))
        );
  }),
  path: PACKAGE_JSON,
  setup: [],
});

/** Lanes by name, in the order found, each with its offer. */
type Lanes = ReadonlyMap<string, Offer>;

// One group's offers, merged under the lanes already found by the groups
// before it. Inside a group a second offer for a lane takes its own name;
// a later group only fills lanes the earlier ones lack.
const mergeGroup = (found: Lanes, group: readonly Read[]): Lanes => {
  const added = new Map<string, Offer>();
  const commands = new Set([...found.values()].map(({ command }) => command));

  for (const offer of group.flatMap(({ offers }) => offers)) {
    const free = (lane: string) => !found.has(lane) && !added.has(lane);

    const repeated = [...added.values()].some(
      ({ command }) => command === offer.command
    );

    if (!commands.has(offer.command) && !repeated && !found.has(offer.lane)) {
      const lane = free(offer.lane)
        ? Option.some(offer.lane)
        : Option.filter(offer.fallback, free);

      if (Option.isSome(lane)) {
        added.set(lane.value, offer);
      }
    }
  }

  return new Map([...found, ...added]);
};

const managerOf = (
  files: readonly RepoFile[],
  scripts: Scripts,
  setup: readonly string[]
): PackageManager =>
  Option.firstSomeOf([
    scripts.manager,
    Option.fromNullishOr(
      LOCKFILES.find(([lockfile]) => files.some(fileNamed(lockfile)))?.[1]
    ),
    Option.fromNullishOr(
      setup.map((command) => words(command)[0]).find(isManager)
    ),
  ]).pipe(Option.getOrElse((): PackageManager => "npm"));

const INSTALL = {
  bun: "bun install --frozen-lockfile",
  npm: "npm ci",
  pnpm: "pnpm install --frozen-lockfile",
  yarn: "yarn install --frozen-lockfile",
} as const satisfies Record<PackageManager, string>;

const skip = (path: string, reason: string) => `skipped ${path}: ${reason}`;

/** Each file read, and a `skipped …` line for each one that wasn't. */
const readEach = (
  files: readonly RepoFile[],
  read: (file: RepoFile) => Result.Result<Read, string>
) => {
  const results = files.map((file) =>
    Result.mapError(read(file), (reason) => skip(file.path, reason))
  );

  return {
    reads: Arr.getSuccesses(results),
    skipped: Arr.getFailures(results),
  };
};

/** The root `package.json`'s scripts and package manager, or why it can't be read. */
const readPackage = (files: readonly RepoFile[]) =>
  Option.map(
    Option.fromNullishOr(files.find(fileNamed(PACKAGE_JSON))),
    (file) =>
      Result.mapError(Schema.decodeResult(PackageJson)(file.content), (issue) =>
        skip(PACKAGE_JSON, oneLine(issue.message))
      )
  );

const scriptsOf = (root: Option.Option<typeof PackageJson.Type>): Scripts => ({
  byName: new Map(
    Object.entries(Option.getOrUndefined(root)?.scripts ?? {}).filter(
      ([, body]) => body.trim() !== ""
    )
  ),
  manager: Option.flatMap(root, ({ packageManager = "" }) =>
    Option.fromNullishOr(
      MANAGERS.find((manager) => packageManager.startsWith(`${manager}@`))
    )
  ),
});

/** Setup commands with the file each came from, deduplicated, in order. */
type Setup = readonly (readonly [command: string, path: string])[];

// The install commands of the source group setup comes from, plus the hook
// environments pre-commit's lanes need before the network closes.
const setupOf = (reads: readonly Read[], lanes: Lanes): Setup => {
  const found = reads.flatMap(({ path, setup }) =>
    setup.map((command) => [command, path] as const)
  );

  const hooks = [...lanes.values()].some(({ path }) => path === PRE_COMMIT)
    ? [["pre-commit install-hooks", PRE_COMMIT] as const]
    : [];

  return [...new Map([...found, ...hooks])];
};

/** The one-file test command, and where its runner was read. */
const testOf = (lanes: Lanes) =>
  Option.map(Option.fromNullishOr(lanes.get("unit")), (unit) =>
    Option.match(Option.firstSomeOf(segments(unit.runner.body).map(oneFile)), {
      onNone: () => ({ command: unit.command, path: unit.path }),
      onSome: (command) => ({ command, path: unit.runner.path }),
    })
  );

/**
 * Finds a project's run block in its files. Sources rank CI workflows first,
 * then lefthook, husky and pre-commit hooks, then root `package.json`
 * scripts; a lower source only adds lanes the higher ones lack. Lanes are
 * named `lint`, `types`, `unit`, `build` and `format` when the finder knows
 * the tool or the name, else by their script's name. `test` runs one file
 * (`{path}`) for runners it knows (vitest, jest, bun test, pytest, go test,
 * cargo test, and a few more); otherwise it is the unit lane's command as
 * found. Setup is the install commands the top source runs, or else the
 * package manager's install. A file that doesn't parse is skipped with its
 * reason in `sources`; nothing found leaves `run` and `sources` empty.
 */
export const findRunBlock = (files: readonly RepoFile[]): FoundRunBlock => {
  const sorted = files.toSorted(byPath);
  const root = readPackage(sorted);
  const rootPackage = Option.flatMap(root, Result.getSuccess);
  const scripts = scriptsOf(rootPackage);

  const workflows = readEach(sorted.filter(isWorkflow), (file) =>
    Result.map(workflowSteps(file.content), (steps) =>
      readSteps(file, steps, scripts)
    )
  );

  const lefthook = readEach(
    sorted.filter(({ path }) => LEFTHOOK.has(path)).slice(0, 1),
    (file) =>
      Result.map(lefthookSteps(file.content), (steps) =>
        readSteps(file, steps, scripts)
      )
  );

  const husky = sorted.flatMap((file) =>
    huskyFile.test(file.path)
      ? [readSteps(file, huskySteps(file.content), scripts)]
      : []
  );

  const preCommit = readEach(
    sorted.filter(fileNamed(PRE_COMMIT)),
    readPreCommit
  );

  const hooks = [...lefthook.reads, ...husky, ...preCommit.reads];

  // Setup comes from the highest-ranked group that installs anything.
  const installing =
    [workflows.reads, hooks].find((reads) =>
      reads.some(({ setup }) => setup.length > 0)
    ) ?? [];

  const manager = managerOf(
    sorted,
    scripts,
    installing.flatMap(({ setup }) => setup)
  );

  let lanes: Lanes = new Map();

  for (const group of [
    workflows.reads,
    hooks,
    Option.isSome(rootPackage) ? [readScripts(manager, scripts)] : [],
  ]) {
    lanes = mergeGroup(lanes, group);
  }

  const setup = setupOf(installing, lanes);

  const lockfile = LOCKFILES.find(
    ([name, owner]) => owner === manager && sorted.some(fileNamed(name))
  );

  const inferred =
    setup.length === 0 && Option.isSome(rootPackage)
      ? Option.some({
          command: INSTALL[manager],
          from: lockfile?.[0] ?? PACKAGE_JSON,
        })
      : Option.none();

  const commands = [
    ...setup.map(([command]) => command),
    ...Option.toArray(Option.map(inferred, ({ command }) => command)),
  ];

  const test = testOf(lanes);

  return {
    run: {
      ...(lanes.size > 0 && {
        checks: Object.fromEntries(
          [...lanes].map(([lane, { command }]) => [lane, command])
        ),
      }),
      ...(commands.length > 0 && { setup: commands.join(" && ") }),
      ...(Option.isSome(test) && { test: test.value.command }),
    },
    sources: [
      ...new Set(setup.map(([, path]) => `setup from ${path}`)),
      ...Option.toArray(
        Option.map(inferred, ({ from }) => `setup inferred from ${from}`)
      ),
      ...Option.toArray(Option.map(test, ({ path }) => `test from ${path}`)),
      ...[...lanes].map(([lane, { path }]) => `checks.${lane} from ${path}`),
      ...Option.toArray(Option.flatMap(root, Result.getFailure)),
      ...workflows.skipped,
      ...lefthook.skipped,
      ...preCommit.skipped,
    ],
  };
};
