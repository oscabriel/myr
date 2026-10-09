/**
 * What `scripts/import-examples.ts` imports, and the commands its `--tags`
 * backfill runs: pure, so a test reads both without a network.
 *
 * Eight repos, each picked for a shape the code browser must render: a Rust crate with
 * a `master` default and 105 annotated tags first, then a TypeScript
 * library, a Go CLI, a Python package with a long merge history, a
 * Markdown list, a deep monorepo with 740 scoped tags, large single-file C
 * headers, and a repo off GitHub with a submodule.
 */
import { ProjectName } from "@repo/protocol/ids";
import { Option, Redacted } from "effect";

/** One repo to import: the project it becomes, where it is, its branch, and what it exercises. */
export interface ImportExample {
  readonly project: ProjectName;
  readonly url: string;
  /** The remote's default branch, named so the import never guesses. */
  readonly branch: string;
  /** What kind of repo it is, said for a person. */
  readonly kind: string;
}

const example = (
  project: string,
  url: string,
  branch: string,
  kind: string
): ImportExample => ({ branch, kind, project: ProjectName.make(project), url });

/** The repos, in the order they import: anyhow first, the probe for `master` and tags. */
export const examples: readonly ImportExample[] = [
  example(
    "anyhow",
    "https://github.com/dtolnay/anyhow",
    "master",
    "Rust crate"
  ),
  example(
    "ky",
    "https://github.com/sindresorhus/ky",
    "main",
    "TypeScript library"
  ),
  example("gum", "https://github.com/charmbracelet/gum", "main", "Go CLI"),
  example(
    "click",
    "https://github.com/pallets/click",
    "main",
    "Python package"
  ),
  example(
    "awesome",
    "https://github.com/sindresorhus/awesome",
    "main",
    "Markdown list"
  ),
  example(
    "changesets",
    "https://github.com/changesets/changesets",
    "main",
    "TypeScript monorepo"
  ),
  example(
    "stb",
    "https://github.com/nothings/stb",
    "master",
    "C single-file headers"
  ),
  example(
    "fuzzel",
    "https://codeberg.org/dnkl/fuzzel",
    "master",
    "C on Codeberg"
  ),
];

/**
 * The imports still to run: `only`'s example when it names one, else every
 * example, less each project the platform lists already. A name it lists
 * is never imported again, whatever repo it came from.
 */
export const planImports = (
  all: readonly ImportExample[],
  listed: ReadonlySet<ProjectName>,
  only: Option.Option<ProjectName>
): readonly ImportExample[] =>
  all.filter(
    ({ project }) =>
      Option.match(only, {
        onNone: () => true,
        onSome: (named) => named === project,
      }) && !listed.has(project)
  );

/** A git remote and the token that writes to it, kept apart so the URL can be shown. */
export interface RedactedUrl {
  readonly url: string;
  readonly token: Redacted.Redacted;
}

/**
 * One command a run spawns: its argv, which may be printed, and env values
 * of its own, which never are.
 */
export interface Command {
  readonly argv: readonly string[];
  readonly env?: Readonly<Record<string, Redacted.Redacted>>;
}

/** How a command is shown: its argv alone, never its env. */
export const shownCommand = ({ argv }: Command) => argv.join(" ");

/** Every tag, under its own name: the one refspec the backfill pushes. */
const TAGS = "refs/tags/*:refs/tags/*";

/**
 * The backfill of an import that came without its tags: fetch the
 * source's tags into the bare repo `mirror`, then push those tags, and
 * only those, to `remote`. The write token goes to git as an
 * `Authorization` header through git's `GIT_CONFIG_*` env, so it is in no
 * argument, no URL and no printed line. Nothing pushes a branch: `main`
 * moves only by a landing.
 *
 * Only the tags are fetched (not `clone --mirror`, which would bring every
 * `refs/pull/*` GitHub keeps): the canonical repo already has the history
 * they point into, so the push sends the tag objects and little else.
 */
export const tagBackfillCommands = (input: {
  readonly source: string;
  readonly mirror: string;
  readonly remote: RedactedUrl;
}): readonly Command[] => [
  { argv: ["git", "init", "--bare", "--quiet", input.mirror] },
  {
    argv: [
      "git",
      "--git-dir",
      input.mirror,
      "fetch",
      "--quiet",
      "--no-tags",
      input.source,
      TAGS,
    ],
  },
  {
    argv: [
      "git",
      "--git-dir",
      input.mirror,
      "push",
      "--quiet",
      input.remote.url,
      TAGS,
    ],
    env: {
      GIT_CONFIG_COUNT: Redacted.make("1"),
      GIT_CONFIG_KEY_0: Redacted.make("http.extraHeader"),
      GIT_CONFIG_VALUE_0: Redacted.make(
        `Authorization: Bearer ${Redacted.value(input.remote.token)}`
      ),
    },
  },
];
