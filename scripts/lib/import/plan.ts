/**
 * What `scripts/import-examples.ts` imports, the pages it reads to warm
 * each import, and the commands its `--tags` backfill runs: pure, so a test
 * reads them without a network.
 *
 * Thirty-eight repos. The first eight were each picked for a shape the
 * code browser must render: a Rust crate with a `master` default and 105
 * annotated tags first, then a TypeScript library, a Go CLI, a Python
 * package with a long merge history, a Markdown list, a deep monorepo with
 * 740 scoped tags, large single-file C headers, and a repo off GitHub with
 * a submodule. The thirty after them are well-known projects in
 * TypeScript, JavaScript, Rust, Go, Python, C, Ruby and shell, so a reader
 * finds code they know; each is a copy, read-only here, under its own
 * licence.
 */
import { ProjectKey, ProjectName, sourceNamespaceOf } from "@repo/protocol/ids";
import { Option, Redacted } from "effect";

/**
 * One repo to import: the project it becomes, by its name at its source
 * path (`github.com/pallets/click`) and the key it was first imported
 * under (`click`), which the platform keeps as its repo's name and the
 * ledger records; where it is, its branch, what it is, and its licence.
 */
export interface ImportExample {
  readonly name: ProjectName;
  readonly key: ProjectKey;
  readonly url: string;
  /** The remote's default branch, named so the import never guesses. */
  readonly branch: string;
  /** What kind of repo it is, said for a person. */
  readonly kind: string;
  /** Its licence, as an SPDX expression. */
  readonly licence: string;
}

/** A row: its key, and its name at its source path, read from the URL. */
const example = (
  key: string,
  url: string,
  branch: string,
  kind: string,
  licence: string
): ImportExample => ({
  branch,
  key: ProjectKey.make(key),
  kind,
  licence,
  name: ProjectName.make(`${Option.getOrThrow(sourceNamespaceOf(url))}/${key}`),
  url,
});

/** The repos, in the order they import: anyhow first, the probe for `master` and tags. */
export const examples: readonly ImportExample[] = [
  example(
    "anyhow",
    "https://github.com/dtolnay/anyhow",
    "master",
    "Rust crate",
    "MIT OR Apache-2.0"
  ),
  example(
    "ky",
    "https://github.com/sindresorhus/ky",
    "main",
    "TypeScript library",
    "MIT"
  ),
  example(
    "gum",
    "https://github.com/charmbracelet/gum",
    "main",
    "Go CLI",
    "MIT"
  ),
  example(
    "click",
    "https://github.com/pallets/click",
    "main",
    "Python package",
    "BSD-3-Clause"
  ),
  example(
    "awesome",
    "https://github.com/sindresorhus/awesome",
    "main",
    "Markdown list",
    "CC0-1.0"
  ),
  example(
    "changesets",
    "https://github.com/changesets/changesets",
    "main",
    "TypeScript monorepo",
    "MIT"
  ),
  example(
    "stb",
    "https://github.com/nothings/stb",
    "master",
    "C single-file headers",
    "MIT OR Unlicense"
  ),
  example(
    "fuzzel",
    "https://codeberg.org/dnkl/fuzzel",
    "master",
    "C on Codeberg",
    "MIT"
  ),
  // Well known, so a reader meets code they have read before: permissive
  // licences, each under 14 MB on GitHub, as the eight above import well.
  example(
    "hono",
    "https://github.com/honojs/hono",
    "main",
    "TypeScript web framework",
    "MIT"
  ),
  example(
    "express",
    "https://github.com/expressjs/express",
    "master",
    "JavaScript web framework",
    "MIT"
  ),
  example(
    "fastify",
    "https://github.com/fastify/fastify",
    "main",
    "JavaScript web framework",
    "MIT"
  ),
  example(
    "zustand",
    "https://github.com/pmndrs/zustand",
    "main",
    "TypeScript state library",
    "MIT"
  ),
  example(
    "immer",
    "https://github.com/immerjs/immer",
    "main",
    "JavaScript immutable state",
    "MIT"
  ),
  example(
    "nanoid",
    "https://github.com/ai/nanoid",
    "main",
    "JavaScript ID generator",
    "MIT"
  ),
  example(
    "commander",
    "https://github.com/tj/commander.js",
    "master",
    "JavaScript CLI parser",
    "MIT"
  ),
  example(
    "execa",
    "https://github.com/sindresorhus/execa",
    "main",
    "JavaScript process runner",
    "MIT"
  ),
  example(
    "chalk",
    "https://github.com/chalk/chalk",
    "main",
    "JavaScript terminal colours",
    "MIT"
  ),
  example(
    "mitt",
    "https://github.com/developit/mitt",
    "main",
    "TypeScript event emitter",
    "MIT"
  ),
  example(
    "clsx",
    "https://github.com/lukeed/clsx",
    "master",
    "JavaScript class names",
    "MIT"
  ),
  example(
    "ripgrep",
    "https://github.com/BurntSushi/ripgrep",
    "master",
    "Rust CLI",
    "Unlicense OR MIT"
  ),
  example(
    "serde",
    "https://github.com/serde-rs/serde",
    "master",
    "Rust serialization",
    "MIT OR Apache-2.0"
  ),
  example(
    "axum",
    "https://github.com/tokio-rs/axum",
    "main",
    "Rust web framework",
    "MIT"
  ),
  example(
    "fd",
    "https://github.com/sharkdp/fd",
    "master",
    "Rust CLI",
    "MIT OR Apache-2.0"
  ),
  example(
    "hyperfine",
    "https://github.com/sharkdp/hyperfine",
    "master",
    "Rust benchmarking CLI",
    "MIT OR Apache-2.0"
  ),
  example(
    "bubbletea",
    "https://github.com/charmbracelet/bubbletea",
    "main",
    "Go TUI framework",
    "MIT"
  ),
  example(
    "fzf",
    "https://github.com/junegunn/fzf",
    "master",
    "Go fuzzy finder",
    "MIT"
  ),
  example(
    "cobra",
    "https://github.com/spf13/cobra",
    "main",
    "Go CLI library",
    "Apache-2.0"
  ),
  example(
    "gin",
    "https://github.com/gin-gonic/gin",
    "master",
    "Go web framework",
    "MIT"
  ),
  example(
    "requests",
    "https://github.com/psf/requests",
    "main",
    "Python HTTP library",
    "Apache-2.0"
  ),
  example(
    "flask",
    "https://github.com/pallets/flask",
    "main",
    "Python web framework",
    "BSD-3-Clause"
  ),
  example(
    "httpx",
    "https://github.com/encode/httpx",
    "master",
    "Python HTTP client",
    "BSD-3-Clause"
  ),
  example(
    "typer",
    "https://github.com/fastapi/typer",
    "master",
    "Python CLI library",
    "MIT"
  ),
  example(
    "jinja",
    "https://github.com/pallets/jinja",
    "main",
    "Python templates",
    "BSD-3-Clause"
  ),
  example(
    "lua",
    "https://github.com/lua/lua",
    "master",
    "C language interpreter",
    "MIT"
  ),
  example(
    "jq",
    "https://github.com/jqlang/jq",
    "master",
    "C JSON processor",
    "MIT"
  ),
  example(
    "kilo",
    "https://github.com/antirez/kilo",
    "master",
    "C text editor",
    "BSD-2-Clause"
  ),
  example(
    "sinatra",
    "https://github.com/sinatra/sinatra",
    "main",
    "Ruby web framework",
    "MIT"
  ),
  example(
    "nvm",
    "https://github.com/nvm-sh/nvm",
    "master",
    "Shell version manager",
    "MIT"
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
    ({ name }) =>
      Option.match(only, {
        onNone: () => true,
        onSome: (named) => named === name,
      }) && !listed.has(name)
  );

/**
 * The pages read once after an import, so its first reader does not pay
 * for a cold read: its home, its root folder, its landings, and, when it
 * has a README, the README and why each of its lines is there. Why and a
 * file's history are kept by commit once read (ADR 0020).
 */
export const warmPaths = (
  project: ProjectName,
  readme: Option.Option<string>
): readonly string[] => [
  `/${project}`,
  `/${project}/tree/main`,
  `/${project}/commits/main`,
  ...Option.match(readme, {
    onNone: () => [],
    onSome: (path) => [
      `/${project}/blob/main/${path}`,
      `/${project}/why/main/${path}`,
    ],
  }),
];

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
