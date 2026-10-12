/**
 * The README a judge reads first, held to the tree: every path and command
 * it names exists, so a rename that leaves the README behind fails here.
 * Its credits name every upstream that a ported file's header names (the
 * `Ported from <owner>/<repo>@<sha>` line in the file's first lines: the
 * headers are the record of what is borrowed).
 *
 * A path is a token in the README's code (inline or fenced) or a link
 * target whose first segment is one of the repo's own top-level entries, or
 * that reads as a relative file path whatever its first segment, so a typo
 * or a renamed top-level folder is caught too; `{a,b}` names both, and `*`
 * or `<name>` stands for part of one segment, so such a pattern must match
 * at least one file. Pure file reads, and one `git ls-files` for the files
 * a path may name.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Array, Effect, FileSystem, Option, Path, Schema } from "effect";

import { committable, repoRoot, textOf } from "./root.ts";

/**
 * What a public README never holds: a home folder, the private plan's host,
 * or a pointer into the maintainer's gitignored working docs. Each is joined
 * at run time, so this file spells none of them for a search to find.
 */
const PRIVATE = [
  ["~", ""].join("/"),
  ["", "home", ""].join("/"),
  ["", "Users", ""].join("/"),
  ["plans", "gneiss", "run"].join("."),
  ["wanted", "explainer"].join("-"),
  ...["adr", "demo", "ops", "workflow", "scratch", "README"].map((folder) =>
    [".agents", folder].join("/")
  ),
] as const;

/** How many of a file's first lines may carry its `Ported from` header. */
const HEADER_LINES = 5;

/** A ported file's header: the upstream repository and the commit it was copied at. */
const PORTED = /Ported from (?<upstream>[\w.-]+\/[\w.-]+)@[\da-f]{7,40}\b/u;

/**
 * A token that reads as a relative file path: segments of path characters
 * (pattern ones included), at least two, the last with an extension. A URL,
 * a ref or a package name has a colon, no extension or a leading `@`, `/`
 * or `<`.
 */
const FILE_PATH = /^\.?[\w-][\w.-]*(?:\/[\w.[\]$<>{},*-]+)+\.\w+$/u;

// ------------------------------------------------------------ the repo

/** The README, or nothing yet: a missing README fails by assertion, not by a read error. */
const readme = Effect.map(
  textOf("README.md"),
  Option.getOrElse(() => "")
);

const Manifest = Schema.fromJsonString(
  Schema.Struct({ scripts: Schema.Record(Schema.String, Schema.String) })
);

/** The scripts of the `package.json` in `folder` (the root's when it is empty). */
const scriptsOf = (folder: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const text = yield* textOf(path.join(folder, "package.json"));

    return Option.isNone(text)
      ? {}
      : (yield* Schema.decodeEffect(Manifest)(text.value)).scripts;
  });

/** Every file git tracks or would track and that is on disk, from the repo root. */
const onDisk = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* repoRoot;

  return yield* Effect.filter(yield* committable, (file) =>
    fs.exists(path.join(cwd, file))
  );
});

/** The upstream repositories every committable file's header names, sorted. */
const portedUpstreams = (files: readonly string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;
    const decoder = new TextDecoder();

    const named = yield* Effect.forEach(files, (file) =>
      Effect.map(fs.readFile(path.join(root, file)), (bytes) => {
        const head = decoder
          .decode(bytes.subarray(0, 4096))
          .split("\n")
          .slice(0, HEADER_LINES)
          .join("\n");

        return Option.fromNullishOr(PORTED.exec(head)?.groups?.upstream);
      })
    );

    return Array.dedupe(Array.getSomes(named)).toSorted();
  });

// ------------------------------------------------------- reading the README

interface Section {
  readonly body: string;
  readonly title: string;
}

/** The README's lines, each with whether it sits inside a fenced block (fence lines count as inside). */
const fenced = (text: string) => {
  let inside = false;

  return text.split("\n").map((line) => {
    const fence = line.trimStart().startsWith("```");
    const wasInside = inside;

    if (fence) {
      inside = !inside;
    }

    return { inside: wasInside || fence, line };
  });
};

/** The README's H2 sections, in order, each with its text up to the next one. */
const sectionsOf = (text: string): readonly Section[] => {
  const sections: { readonly lines: string[]; readonly title: string }[] = [];

  for (const { inside, line } of fenced(text)) {
    const title = inside
      ? undefined
      : /^## (?<title>.+)$/u.exec(line)?.groups?.title;

    if (title === undefined) {
      sections.at(-1)?.lines.push(line);
    } else {
      sections.push({ lines: [], title: title.trim() });
    }
  }

  return sections.map(({ lines, title }) => ({
    body: lines.join("\n"),
    title,
  }));
};

/** One section's text, or none when the README lacks it. */
const bodyOf = (text: string, title: string) =>
  sectionsOf(text).find((section) => section.title === title)?.body ?? "";

/** The code in `text`: each inline span outside fences, and each fenced line. */
const codeOf = (text: string) =>
  fenced(text).flatMap(({ inside, line }) =>
    inside
      ? [line]
      : [...line.matchAll(/`(?<code>[^`\n]+)`/gu)].map(
          (match) => match.groups?.code ?? ""
        )
  );

/** Link targets in `text` that point into the repo, not at a URL or an anchor. */
const linkTargets = (text: string) =>
  [...text.matchAll(/\]\((?<target>[^)\s]+)\)/gu)].flatMap((match) => {
    const target = match.groups?.target ?? "";

    return /^(?:[a-z][\d+.a-z-]*:|#)/iu.test(target)
      ? []
      : [target.replace(/#.*$/u, "")];
  });

/** A token without the punctuation prose or a command puts around it. */
const trimmed = (token: string) =>
  token.replace(/^[("'[]+/u, "").replace(/[)"',.:;]+$/u, "");

/** `{a,b}` names both: every path a braced token names. */
const expand = (token: string): readonly string[] => {
  const group = /\{(?<options>[^{}]*)\}/u.exec(token);

  if (group?.groups?.options === undefined) {
    return [token];
  }

  const before = token.slice(0, group.index);
  const after = token.slice(group.index + group[0].length);

  return group.groups.options
    .split(",")
    .flatMap((option) => expand(`${before}${option}${after}`));
};

/** The repo paths among `tokens`: those under a top-level entry, and any that read as a file path. */
const pathsAmong = (tokens: readonly string[], roots: ReadonlySet<string>) =>
  tokens.flatMap((token) => {
    const path = trimmed(token).replace(/^\.\//u, "");

    return roots.has(path.split("/")[0] ?? "") || FILE_PATH.test(path)
      ? expand(path)
      : [];
  });

/** Every repo path the README's code and links name. */
const pathsIn = (text: string, roots: ReadonlySet<string>) =>
  pathsAmong(
    [
      ...codeOf(text).flatMap((code) => code.split(/\s+/u)),
      ...linkTargets(text),
    ],
    roots
  );

/** `path` as a pattern over files: `*` and `<name>` stand for part of one segment. */
const patternOf = (path: string) =>
  new RegExp(
    `^${path
      .replace(/\/$/u, "")
      .split(/(?<wild>\*|<[^<>/]+>)/u)
      .map((part, at) =>
        at % 2 === 1
          ? "[^/]+"
          : part.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`)
      )
      .join("")}(?:/|$)`,
    "u"
  );

/** Whether `path` names a file, or a folder holding one. */
const exists = (path: string, files: readonly string[]) => {
  const pattern = patternOf(path);

  return files.some((file) => pattern.test(file));
};

/** Each `bun run` in `text`: the folder it runs in (the root, or `--cwd`'s) and its script. */
const runs = (text: string) =>
  [
    ...text.matchAll(
      /\bbun run (?:--cwd (?<folder>\S+) )?(?<script>[\w:.-]+)/gu
    ),
  ].map((match) => ({
    folder: match.groups?.folder ?? "",
    script: match.groups?.script ?? "",
  }));

/** Each file `bun` runs directly in `text`. */
const bunFiles = (text: string) =>
  [
    ...text.matchAll(/\bbun (?<file>(?:\.\/)?[\w.-]+(?:\/[\w.[\]$-]+)+)/gu),
  ].flatMap((match) => {
    const file = match.groups?.file ?? "";

    return /\.tsx?$/u.test(file) ? [file] : [];
  });

// ------------------------------------------------------------ the tests

/** The README with what it is read against: the files a path may name and their top-level entries. */
const world = Effect.gen(function* () {
  const files = yield* onDisk;

  return {
    files,
    roots: new Set(files.map((file) => file.split("/")[0] ?? "")),
    text: yield* readme,
  };
});

describe("the README", () => {
  it.live("exists at the repo root", () =>
    Effect.gen(function* () {
      expect(Option.isSome(yield* textOf("README.md"))).toBeTruthy();
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("names only repo paths that exist", () =>
    Effect.gen(function* () {
      const { files, roots, text } = yield* world;
      const named = pathsIn(text, roots);

      expect({
        missing: named.filter((path) => !exists(path, files)),
        names: named.length > 0,
      }).toStrictEqual({ missing: [], names: true });
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "runs only scripts its package.json has, and only files that exist",
    () =>
      Effect.gen(function* () {
        const { files, text } = yield* world;

        const scripts = yield* Effect.forEach(
          runs(text),
          ({ folder, script }) =>
            Effect.map(scriptsOf(folder), (known) =>
              Object.hasOwn(known, script)
                ? Option.none()
                : Option.some(`${folder || "."}: ${script}`)
            )
        );

        expect({
          files: bunFiles(text).filter((file) => !exists(file, files)),
          runs: runs(text).length > 0,
          scripts: Array.getSomes(scripts),
        }).toStrictEqual({ files: [], runs: true, scripts: [] });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("credits every upstream a ported file's header names", () =>
    Effect.gen(function* () {
      const { files, text } = yield* world;
      const upstreams = yield* portedUpstreams(files);
      const credits = bodyOf(text, "Credits");

      expect({
        found: upstreams.length > 0,
        uncredited: upstreams.filter((upstream) => !credits.includes(upstream)),
      }).toStrictEqual({ found: true, uncredited: [] });
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("holds no home folder and no pointer to the private plan", () =>
    Effect.gen(function* () {
      const text = yield* readme;

      expect(PRIVATE.filter((needle) => text.includes(needle))).toStrictEqual(
        []
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "installs the CLI from the platform, not a code host's releases",
    () =>
      Effect.gen(function* () {
        const text = yield* readme;

        expect({
          githubReleases: /github\.com\/\S*\/releases/u.test(text),
          install: text.includes("/install.sh | sh"),
        }).toStrictEqual({ githubReleases: false, install: true });
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
