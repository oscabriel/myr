// Ported from joelhooks/rat-stack@fba26d8 `scripts/vcs-command-policy.js`
// (MIT, LICENSES/rat-stack.MIT.txt). Changes are listed in PROVENANCE.md.
/**
 * The hook policy. Each agent harness asks it about a shell command before the
 * command runs (`scripts/hooks/vcs-policy.ts` for Claude Code and Cursor,
 * `.pi/extensions/vcs-policy` for pi). It allows or denies; it never rewrites.
 *
 * It reads the command as a shell would (`./shell.ts`): simple commands,
 * quotes and escapes, and what runs inside `$(…)`, backticks, `sh -c`, `eval`
 * and a heredoc fed to a shell. Each simple command then loses its leading
 * `VAR=value` words, wrappers (`env`, `command`, `exec`, `sudo`, …), package
 * runners (`bunx`, `npx`, `bun run ops --`, …) and any path on argv[0], and is
 * judged by its argv (`./argv.ts`), so flag text inside a quoted `-m` message
 * is a message. Where a command's meaning is unclear, the policy denies.
 *
 * Pure, with no Effect runtime: Bun, Node and pi's loader all import it.
 */
import { Data, Option } from "effect";

import { grammar, names, NO_OPTIONS, parse } from "./argv.ts";
import type { Grammar, Parsed } from "./argv.ts";
import { simpleCommands, wordsOf } from "./shell.ts";

/** The rules, each from AGENTS.md. */
export type Rule =
  | "hook-bypass"
  | "push"
  | "delete"
  | "cf-project-command"
  | "closed-env-read";

export type Decision =
  | { readonly _tag: "Allow" }
  | { readonly _tag: "Deny"; readonly rule: Rule; readonly reason: string };

export const Decision = Data.taggedEnum<Decision>();

/** One sentence per rule: what AGENTS.md says, and what to do instead. */
export const reasons = {
  "cf-project-command":
    "cf's project commands are not our deploy tool; use infra/deploy.ts.",
  "closed-env-read":
    "Never read .env, .env.local or .env.*.local, even in a recursive search (rg and git grep skip them); run bun run env:check.",
  delete: "Deleting Cloudflare resources needs the user's OK.",
  "hook-bypass":
    "Hooks are early feedback; fix the failure instead of skipping it (AGENTS.md principle 11).",
  push: "Pushing is the user's step; commit on the branch and stop.",
} as const satisfies Readonly<Record<Rule, string>>;

/** The rule a command breaks, or none. */
type Verdict = Option.Option<Rule>;

const breaks = (rule: Rule, when: boolean): Verdict =>
  when ? Option.some(rule) : Option.none();

const basename = (word: string) => word.slice(word.lastIndexOf("/") + 1);

/** `wrangler@4.147.0` → `wrangler`; `@scope/pkg@1` → `@scope/pkg`. */
const withoutVersion = (name: string) => name.replace(/(?<=.)@[^/]*$/u, "");

const contains = (
  words: readonly string[],
  sequence: readonly string[]
): boolean =>
  words.some((_, index) =>
    sequence.every((word, offset) => words[index + offset] === word)
  );

// ---------------------------------------------------------------------------
// The rules.
// ---------------------------------------------------------------------------

// hook-bypass -----------------------------------------------------------------

/** Environment switches that turn a hook manager off. */
const HOOK_SWITCHES = names("HUSKY LEFTHOOK LEFTHOOK_EXCLUDE");

const ASSIGNMENT = /^[A-Za-z_]\w*=/u;

/** `LEFTHOOK=0`, `HUSKY=0`, or anything that sets `core.hooksPath`. */
const switchesOffHooks = (assignment: string) =>
  HOOK_SWITCHES.has(assignment.slice(0, assignment.indexOf("="))) ||
  /hookspath/iu.test(assignment);

/**
 * A git config key that can skip hooks: `core.hooksPath`, or an alias, which
 * can wrap `--no-verify` or a push where nothing here can see it.
 */
const overridesHooks = (setting: string) => {
  const key = setting.split("=")[0]?.toLowerCase() ?? "";

  return key === "core.hookspath" || key.startsWith("alias.");
};

/** `--no-verify`, or a prefix git may accept for it (`--no-verif`, `--no-ver`). */
const isNoVerify = (option: string) =>
  option.length >= "--no-v".length && "--no-verify".startsWith(option);

// Options before git's subcommand that take a value.
const GIT = grammar(
  "-C -c --attr-source --config-env --git-dir --list-cmds --namespace --super-prefix --work-tree"
);

// Subcommands where `-n` means `--no-verify`, with the options that take a
// value, so `-m -n` is a message and `-nm x` is not.
const NO_VERIFY_SHORT: ReadonlyMap<string, Grammar> = new Map([
  [
    "am",
    grammar(
      "--directory --empty --exclude --include --patch-format --quoted-cr --resolvemsg --whitespace",
      "-C -S -p"
    ),
  ],
  [
    "commit",
    grammar(
      "-C -F -c -m -t --author --cleanup --date --file --fixup --message --pathspec-from-file --reedit-message --reuse-message --squash --template --trailer",
      "-S -u"
    ),
  ],
]);

// `git config` forms that only read.
const CONFIG_READS = names(
  "--get --get-all --get-color --get-colorbool --get-regexp --get-urlmatch --list -l"
);

const writesHookConfig = (parsed: Parsed) => {
  const reads =
    parsed.options.some((option) => CONFIG_READS.has(option)) ||
    ["get", "list"].includes(parsed.operands[0] ?? "");

  return !reads && parsed.operands.some(overridesHooks);
};

/** What git's subcommand, after the global options, breaks. */
const judgeGitSubcommand = (
  subcommand: string,
  rest: readonly string[]
): Verdict => {
  if (
    subcommand === "push" ||
    subcommand === "send-pack" ||
    (subcommand === "subtree" && rest.includes("push"))
  ) {
    return Option.some("push");
  }

  const shortForm = NO_VERIFY_SHORT.get(subcommand);
  const parsed = parse(rest, shortForm ?? NO_OPTIONS, true);

  return breaks(
    "hook-bypass",
    parsed.options.some(isNoVerify) ||
      (shortForm !== undefined && parsed.options.includes("-n")) ||
      (subcommand === "config" && writesHookConfig(parsed))
  );
};

const judgeGit = (args: readonly string[]): Verdict => {
  const global = parse(args, GIT, false);

  const settings = global.values.flatMap(([option, value]) =>
    option === "-c" || option === "--config-env" ? [value] : []
  );

  const [subcommand, ...rest] = global.operands;

  if (settings.some(overridesHooks)) {
    return Option.some("hook-bypass");
  }

  // git runs `git <cmd> --help` as `git help <cmd>`.
  return subcommand === undefined || rest[0] === "--help"
    ? Option.none()
    : judgeGitSubcommand(subcommand, rest);
};

const judgeLefthook = (args: readonly string[]): Verdict =>
  breaks(
    "hook-bypass",
    parse(args, NO_OPTIONS, true).operands.includes("uninstall")
  );

// push ------------------------------------------------------------------------

const judgeJj = (args: readonly string[]): Verdict =>
  breaks(
    "push",
    contains(parse(args, NO_OPTIONS, true).operands, ["git", "push"])
  );

// delete ----------------------------------------------------------------------

/**
 * wrangler's deleting subcommands are all `delete` or `purge`, and it deletes
 * without asking when it runs without a terminal. Only whole words count, so a
 * deploy whose name says `remove` still deploys.
 */
const WRANGLER_DELETES = names("delete purge");

const judgeWrangler = (args: readonly string[]): Verdict =>
  breaks(
    "delete",
    parse(args, NO_OPTIONS, true).operands.some((word) =>
      WRANGLER_DELETES.has(word)
    )
  );

/** A cf command word that deletes: `delete`, `bulk-delete`, `revoke`, `purge`… */
const DESTRUCTIVE = /(?:^|-)(?:delete|destroy|purge|remove|revoke)(?:-|$)/u;

// cf-project-command ----------------------------------------------------------

// cf's global options that take a value (`cf --help`, cf 1.0.0-beta.12).
const CF = grammar("-m -z --mode --persist-to --profile --zone");

const CF_PROJECT = names("build deploy dev init migrate previews");

const CF_PROJECT_SEQUENCES: readonly (readonly string[])[] = [
  ["workers", "triggers", "deploy"],
  ["workers", "versions", "create"],
];

/** cf's commands that only read: AGENTS.md's `cli search` and `schema`. */
const CF_DISCOVERY = names("cli schema");

/**
 * The words that may be cf's command. cf parses with yargs, which gives an
 * option it doesn't declare the next word as its value, so each such word may
 * be the command too: `cf --account-id x deploy`. The last word is the first
 * one no option can have taken.
 */
const cfCommandWords = (args: readonly string[]): readonly string[] => {
  const [word, next, ...rest] = args;

  if (word === undefined) {
    return [];
  }

  if (word === "--") {
    return next === undefined ? [] : [next];
  }

  if (!word.startsWith("-") || word === "-") {
    return [word];
  }

  if (word.includes("=") || next === undefined || next.startsWith("-")) {
    return cfCommandWords(args.slice(1));
  }

  const after = cfCommandWords(rest);

  return CF.values.has(word) ? after : [next, ...after];
};

/** Values yargs reads as false for a boolean flag. */
const OFF = names("0 false");

const DRY_RUN = "--dry-run";

const setsDryRun = (word: string) =>
  word === DRY_RUN || word === "--no-dry-run" || word.startsWith(`${DRY_RUN}=`);

/** Whether the last `--dry-run`, `--dry-run=…` or `--no-dry-run` turns it on. */
const dryRun = (args: readonly string[]): boolean => {
  const end = args.indexOf("--");
  const flags = end === -1 ? args : args.slice(0, end);
  const last = flags.findLastIndex(setsDryRun);
  const word = flags[last] ?? "--no-dry-run";

  if (word === "--no-dry-run") {
    return false;
  }

  return !OFF.has(
    word === DRY_RUN ? (flags[last + 1] ?? "") : word.slice(DRY_RUN.length + 1)
  );
};

const judgeCf = (args: readonly string[]): Verdict => {
  const parsed = parse(args, CF, true);
  const commands = cfCommandWords(args);
  const [command = ""] = commands;

  if (commands.length === 1 && CF_DISCOVERY.has(command)) {
    return Option.none();
  }

  if (
    commands.some((word) => CF_PROJECT.has(word)) ||
    CF_PROJECT_SEQUENCES.some((sequence) => contains(parsed.operands, sequence))
  ) {
    return Option.some("cf-project-command");
  }

  // `<command> --help` prints the command's help, as cf's own help suggests.
  const executes = !parsed.options.includes("--help") && !dryRun(args);

  return breaks(
    "delete",
    executes && parsed.operands.some((word) => DESTRUCTIVE.test(word))
  );
};

// closed-env-read -------------------------------------------------------------

/**
 * Closed names to test globs against: one of each fixed name and a few of the
 * `.env.*.local` shape, so a glob covers the shape only if it matches them all.
 */
const CLOSED_SAMPLES = [
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  ".env.test.local",
];

const isClosedName = (name: string) =>
  name === ".env" || name === ".env.local" || /^\.env\..+\.local$/u.test(name);

const GLOB = /[*?[]/u;

const REGEXP_SPECIAL = /[$()*+.?[\\\]^{|}]/u;

const globPart = (part: string) => {
  if (part === "*") {
    return ".*";
  }

  if (part === "?" || part.startsWith("[")) {
    return ".";
  }

  return REGEXP_SPECIAL.test(part) ? `\\${part}` : part;
};

/**
 * Whether a glob could match `name`, as fnmatch does without `FNM_PERIOD`. A
 * bracket matches any one character, which only widens the match.
 */
const fnmatch = (pattern: string, name: string) =>
  new RegExp(
    `^${pattern.replaceAll(/\[[^\]]*\]|[\s\S]/gu, globPart)}$`,
    "u"
  ).test(name);

/**
 * Whether a shell glob could match the dotfile `name`: a leading `*` never
 * matches one, as in a shell without `dotglob`.
 */
const globMatches = (pattern: string, name: string) =>
  pattern.startsWith(".") && fnmatch(pattern, name);

/** `a{b,c}d` → `abd`, `acd`, as a shell expands braces. */
const braces = (word: string): readonly string[] => {
  const match = /\{(?<options>[^{}]*,[^{}]*)\}/u.exec(word);

  if (match === null) {
    return [word];
  }

  const before = word.slice(0, match.index);
  const after = word.slice(match.index + match[0].length);

  return (match.groups?.options ?? "")
    .split(",")
    .flatMap((option) => braces(`${before}${option}${after}`));
};

/** Whether `word`, or the part after its first `=`, names a closed env file. */
const namesClosedEnv = (word: string) =>
  [word, word.slice(word.indexOf("=") + 1)].some((value) =>
    braces(value).some((path) => {
      const name = basename(path.replace(/\/+$/u, ""));

      return GLOB.test(name)
        ? CLOSED_SAMPLES.some((sample) => globMatches(name, sample))
        : isClosedName(name);
    })
  );

/** The globs one option names, braces expanded: `--include={a,b}`. */
const globsOf = (parsed: Parsed, option: string) =>
  parsed.values.flatMap(([name, value]) =>
    name === option ? braces(value) : []
  );

const GREP_RECURSIVE = names("-R -r --dereference-recursive --recursive");

/**
 * `grep -r` reads every file under its paths, the closed ones too, unless
 * `--include` leaves them out or `--exclude` covers them (grep matches both
 * against the file's name with fnmatch, so `*` matches a leading dot).
 */
const grepReachesClosed = (parsed: Parsed) => {
  const recursive =
    parsed.options.some((option) => GREP_RECURSIVE.has(option)) ||
    parsed.values.some(
      ([option, value]) =>
        (option === "-d" || option === "--directories") && value === "recurse"
    );

  const includes = globsOf(parsed, "--include");
  const excludes = globsOf(parsed, "--exclude");

  return (
    recursive &&
    CLOSED_SAMPLES.some(
      (sample) =>
        (includes.length === 0 ||
          includes.some((glob) => fnmatch(glob, sample))) &&
        !excludes.some((glob) => fnmatch(glob, sample))
    )
  );
};

const RG_HIDDEN = names("-. --hidden");

const RG_IGNORED = names("--no-ignore --no-ignore-parent --no-ignore-vcs");

/**
 * rg skips hidden files and the files .gitignore names, and the closed files
 * are both, so it reaches them only when told to search both: `-uu`, or
 * `--hidden` with `--no-ignore`.
 */
const rgReachesClosed = (parsed: Parsed) => {
  const unrestricted = parsed.options.filter(
    (option) => option === "-u" || option === "--unrestricted"
  ).length;

  return (
    (unrestricted >= 2 ||
      parsed.options.some((option) => RG_HIDDEN.has(option))) &&
    (unrestricted >= 1 ||
      parsed.options.some((option) => RG_IGNORED.has(option)))
  );
};

/**
 * A reader whose first operand is a pattern or a script, not a file, unless
 * one of `instead` supplies it.
 */
interface PatternFirst {
  readonly grammar: Grammar;
  readonly instead: ReadonlySet<string>;
  /** Options whose value is a pattern or a glob, never a file it reads. */
  readonly patterns: ReadonlySet<string>;
  /** Whether a search of whole directories can reach a closed file. */
  readonly reachesClosed: (parsed: Parsed) => boolean;
}

const GREP: PatternFirst = {
  grammar: grammar(
    "-A -B -C -D -d -e -f -m --after-context --before-context --binary-files --context --devices --directories --exclude --exclude-dir --exclude-from --file --include --label --max-count --regexp"
  ),
  instead: names("-e -f --file --regexp"),
  patterns: names("-e --exclude --exclude-dir --include --regexp"),
  reachesClosed: grepReachesClosed,
};

const AWK: PatternFirst = {
  grammar: grammar(
    "-E -F -W -f -i -l -v --assign --exec --field-separator --file --include --load"
  ),
  instead: names("-E -f --exec --file"),
  patterns: names(""),
  reachesClosed: () => false,
};

const RG: PatternFirst = {
  grammar: grammar(
    "-A -B -C -E -M -T -d -e -f -g -j -m -r -t --after-context --before-context --color --colors --context --context-separator --encoding --engine --file --glob --iglob --ignore-file --max-columns --max-count --max-depth --max-filesize --path-separator --pre --pre-glob --regexp --replace --sort --sortr --threads --type --type-add --type-not"
  ),
  instead: names("-e -f --file --files --regexp --type-list"),
  patterns: names("-e --regexp"),
  reachesClosed: rgReachesClosed,
};

const SED: PatternFirst = {
  grammar: grammar("-e -f -l --expression --file --line-length", "-i"),
  instead: names("-e -f --expression --file"),
  patterns: names(""),
  reachesClosed: () => false,
};

const PATTERN_FIRST: ReadonlyMap<string, PatternFirst> = new Map([
  ["awk", AWK],
  ["egrep", GREP],
  ["fgrep", GREP],
  ["gawk", AWK],
  ["grep", GREP],
  ["mawk", AWK],
  ["nawk", AWK],
  ["rg", RG],
  ["sed", SED],
  ["zgrep", GREP],
]);

/** Commands that read or copy the files they name. */
const READERS = new Set([
  ...names(
    ". ack ag base64 bat batcat cat cmp cp cut dd diff emacs head hexdump jq less more most nano nl nvim od paste rsync scp sort source strings tac tail uniq vi view vim wc xxd yq"
  ),
  ...PATTERN_FIRST.keys(),
]);

const judgeRead = (program: string, args: readonly string[]): Verdict => {
  const patternFirst = PATTERN_FIRST.get(program);
  const parsed = parse(args, patternFirst?.grammar ?? NO_OPTIONS, true);

  if (patternFirst === undefined) {
    return breaks(
      "closed-env-read",
      [...parsed.values.map(([, value]) => value), ...parsed.operands].some(
        namesClosedEnv
      )
    );
  }

  const skipsFirst = !parsed.options.some((option) =>
    patternFirst.instead.has(option)
  );

  const files = [
    ...parsed.values.flatMap(([option, value]) =>
      patternFirst.patterns.has(option) ? [] : [value]
    ),
    ...(skipsFirst ? parsed.operands.slice(1) : parsed.operands),
  ];

  return breaks(
    "closed-env-read",
    files.some(namesClosedEnv) || patternFirst.reachesClosed(parsed)
  );
};

// ---------------------------------------------------------------------------
// What actually runs: wrappers, shells and package runners.
// ---------------------------------------------------------------------------

/** Reserved words that may open a simple command: `if git push; then`. */
const KEYWORDS = names("! do elif else if then until while { }");

const DECLARATIONS = names("declare export local readonly typeset");

const SHELLS = names("ash bash dash fish ksh sh zsh");

const SHELL = grammar("-o --init-file --rcfile");

/** Commands that run the command in their operands, with the options they take. */
const WRAPPERS: ReadonlyMap<string, Grammar> = new Map([
  ["builtin", NO_OPTIONS],
  ["command", NO_OPTIONS],
  ["doas", grammar("-C -a -u")],
  ["env", grammar("-C -P -S -u --chdir --split-string --unset")],
  ["exec", grammar("-a")],
  ["nice", grammar("-n --adjustment")],
  ["nohup", NO_OPTIONS],
  ["stdbuf", grammar("-e -i -o --error --input --output")],
  [
    "sudo",
    grammar(
      "-C -D -R -T -U -g -h -p -r -t -u --chdir --chroot --close-from --command-timeout --group --host --other-user --prompt --role --type --user"
    ),
  ],
  ["time", grammar("-f -o --format --output")],
  ["timeout", grammar("-k -s --kill-after --signal")],
  [
    "xargs",
    grammar(
      "-E -I -L -P -a -d -n -s --arg-file --delimiter --eof --max-args --max-chars --max-lines --max-procs --process-slot-var --replace",
      "-e -i -l"
    ),
  ],
]);

/** The command a wrapper runs: `sudo -u root git push` → `git push`. */
const wrapped = (program: string, args: readonly string[]) => {
  const parsed = parse(args, WRAPPERS.get(program) ?? NO_OPTIONS, false);

  // `env -S 'git push'` splits its string into words.
  const split = parsed.values.flatMap(([option, value]) =>
    option === "-S" || option === "--split-string" ? wordsOf(value) : []
  );

  // `timeout 5 git push`: the duration comes first.
  const operands =
    program === "timeout" ? parsed.operands.slice(1) : parsed.operands;

  return [...split, ...operands];
};

const LAUNCHER = grammar("-p --package");

const NPX = grammar("-c -p -w --call --package --workspace");

const BUN = grammar(
  "-F -c -d -e -l -p -r --conditions --config --cwd --define --elide-lines --env-file --eval --filter --import --loader --preload --print --require --shell --tsconfig-override"
);

// `bun -e` runs JavaScript, which is past what this policy can read.
const EVALUATES = names("-e -p --eval --print");

const PACKAGE_MANAGER = grammar(
  "-C -F -w --cwd --dir --filter --prefix --workspace"
);

const VARLOCK = grammar("-p --env --path");

const SCRIPT_RUNS = names("run run-script");

const PACKAGE_RUNS = names("dlx exec x");

/** A launched package's command: `wrangler@4 delete` → `wrangler delete`. */
const launched = ([name = "", ...rest]: readonly string[]) => [
  withoutVersion(name),
  ...rest,
];

/** What `npx` and its kin run: a package's bin, or `-c`'s script. */
const npx = (args: readonly string[]): readonly string[] => {
  const parsed = parse(args, NPX, false);

  const call = parsed.values.find(
    ([option]) => option === "-c" || option === "--call"
  );

  return call === undefined ? launched(parsed.operands) : ["sh", "-c", call[1]];
};

/**
 * A package script, or a file or bin run by name. `ops` is the root script
 * `varlock run --path infra/ -- cf`, so `bun run ops -- x` runs `cf x`.
 */
const script = ([name = "", ...rest]: readonly string[]) => {
  const args = rest[0] === "--" ? rest.slice(1) : rest;

  return name === "ops" ? ["cf", ...args] : [name, ...args];
};

/** What bun, npm, pnpm or yarn runs, if anything. */
const packageManagerRuns = (
  program: string,
  args: readonly string[]
): Option.Option<readonly string[]> => {
  const parsed = parse(args, program === "bun" ? BUN : PACKAGE_MANAGER, false);
  const [subcommand = "", ...rest] = parsed.operands;

  if (parsed.options.some((option) => EVALUATES.has(option))) {
    return Option.none();
  }

  if (program === "bun" && subcommand === "exec") {
    return Option.some(["sh", "-c", rest.join(" ")]);
  }

  if (SCRIPT_RUNS.has(subcommand)) {
    return Option.some(script(parse(rest, PACKAGE_MANAGER, false).operands));
  }

  if (PACKAGE_RUNS.has(subcommand)) {
    return Option.some(npx(rest));
  }

  // npm runs scripts only through `run`; bun, pnpm and yarn take a bare name.
  return program === "npm"
    ? Option.none()
    : Option.some(script(parsed.operands));
};

/** The command a package runner runs, as words, if it runs one. */
const runs = (
  program: string,
  args: readonly string[]
): Option.Option<readonly string[]> => {
  if (program === "bunx" || program === "pnpx") {
    return Option.some(launched(parse(args, LAUNCHER, false).operands));
  }

  if (program === "npx") {
    return Option.some(npx(args));
  }

  if (program === "varlock") {
    const [subcommand, ...rest] = parse(args, VARLOCK, false).operands;

    return subcommand === "run"
      ? Option.some(parse(rest, VARLOCK, false).operands)
      : Option.none();
  }

  return packageManagerRuns(program, args);
};

const PACKAGE_RUNNERS = names("bun bunx npm npx pnpm pnpx varlock yarn");

const PROGRAMS: ReadonlyMap<string, (args: readonly string[]) => Verdict> =
  new Map([
    ["cf", judgeCf],
    // cf's package installs the same bin as `cloudflare`.
    ["cloudflare", judgeCf],
    ["git", judgeGit],
    ["jj", judgeJj],
    ["lefthook", judgeLefthook],
    ["wrangler", judgeWrangler],
  ]);

type Judge = (command: string) => Verdict;

/** A shell runs `-c`'s script, or with no script operand, the one on stdin. */
const judgeShell = (
  args: readonly string[],
  stdin: readonly string[],
  judge: Judge
): Verdict => {
  const parsed = parse(args, SHELL, false);

  const scripts = parsed.options.includes("-c")
    ? parsed.operands.slice(0, 1)
    : stdin;

  return Option.firstSomeOf(scripts.map(judge));
};

/**
 * The rule one simple command breaks, if any. `judge` reads a nested script,
 * such as `sh -c`'s.
 */
const judgeWords = (
  words: readonly string[],
  stdin: readonly string[],
  judge: Judge
): Verdict => {
  const leading = words.findIndex((word) => !ASSIGNMENT.test(word));
  const assignments = leading === -1 ? words : words.slice(0, leading);
  const [head = "", ...args] = leading === -1 ? [] : words.slice(leading);
  const program = basename(head);

  if (assignments.some(switchesOffHooks)) {
    return Option.some("hook-bypass");
  }

  if (KEYWORDS.has(program)) {
    return judgeWords(args, stdin, judge);
  }

  if (DECLARATIONS.has(program)) {
    return breaks("hook-bypass", args.some(switchesOffHooks));
  }

  if (program === "eval") {
    return judge(args.join(" "));
  }

  if (SHELLS.has(program)) {
    return judgeShell(args, stdin, judge);
  }

  if (WRAPPERS.has(program)) {
    return judgeWords(wrapped(program, args), stdin, judge);
  }

  if (PACKAGE_RUNNERS.has(program)) {
    return Option.flatMap(runs(program, args), (inner) =>
      judgeWords(inner, stdin, judge)
    );
  }

  const judgeProgram = PROGRAMS.get(program);

  if (judgeProgram !== undefined) {
    return judgeProgram(args);
  }

  return READERS.has(program) ? judgeRead(program, args) : Option.none();
};

const ruleOf: Judge = (command) =>
  Option.firstSomeOf(
    simpleCommands(command).map((simple) =>
      simple.reads.some(namesClosedEnv)
        ? Option.some<Rule>("closed-env-read")
        : judgeWords(simple.words, simple.stdin, ruleOf)
    )
  );

/** Allow, or Deny with the rule the command breaks and what to do instead. */
export const decide = (command: string): Decision =>
  Option.match(ruleOf(command), {
    onNone: () => Decision.Allow(),
    onSome: (rule) => Decision.Deny({ reason: reasons[rule], rule }),
  });
