/**
 * Code the server sends highlighted (ADR 0026): a blob page's file and a
 * commit page's first files, drawn by `@pierre/diffs/ssr` into a
 * declarative shadow root, in a fixed set of languages and within the
 * server's own limit; anything else is sent as plain text, as before.
 *
 * Each page is rendered as its route renders it on the server: the loader
 * draws the code ahead (`drawFileAhead`, `drawDiffAhead`), then the page
 * renders with the browser's drawing (`ClientFile`, `ClientDiffs`) holding
 * the server's fallback, which is all a server render shows.
 */
import { describe, expect, it } from "@effect/vitest";
import { ChangedFile, CommitDiff, FileView } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { DateTime, Effect, Schema } from "effect";
import { renderToStaticMarkup } from "react-dom/server";

import { BlobView } from "../src/features/code/blob-view.tsx";
import { ClientDiffs, ClientFile } from "../src/features/code/client-code.tsx";
import { CommitView } from "../src/features/code/commit-view.tsx";
import { drawnFiles } from "../src/features/code/diff-model.ts";
import { PlainDiff } from "../src/features/code/plain-diff.tsx";
import { prerenderFile } from "../src/features/code/prerender-server.ts";
import {
  drawDiffAhead,
  drawFileAhead,
  prerenderedPaths,
  prerendersFile,
  SERVER_FILES,
  SERVER_LINES,
} from "../src/features/code/prerender.ts";
import { FileFallback } from "../src/features/code/server-code.tsx";

const datekit = ProjectName.make("datekit");

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const AT = "a".repeat(40);

const decodeFile = Schema.decodeSync(FileView);

const decodeFiles = Schema.decodeSync(Schema.Array(ChangedFile));

/** A highlighted token, as Pierre draws one in the token theme. */
const TOKEN = /--diffs-token-light:var\(--diffs-token-[a-z-]+/gu;

/** How many highlighted tokens `markup` holds. */
const tokensIn = (markup: string) => [...markup.matchAll(TOKEN)].length;

/** How many server drawings `markup` holds. */
const shadowRootsIn = (markup: string) =>
  [...markup.matchAll(/<template shadowrootmode="open">/gu)].length;

const TYPESCRIPT = [
  'import { fromIso } from "./iso.ts";',
  "",
  "/** A date from an ISO week string. */",
  "export const parse = (text: string): Date => fromIso(text);",
  "",
].join("\n");

/** `count` lines of TypeScript. */
const linesOf = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `export const n${index} = ${index};`
  ).join("\n");

let blobs = 0;

/** A file at `path`, with a blob id of its own, so no drawing is shared. */
const fileAt = (path: string, text: string) => {
  blobs += 1;

  return decodeFile({
    at: AT,
    binary: false,
    path,
    sha: blobs.toString(16).padStart(40, "0"),
    size: text.length,
    text,
    truncated: false,
  });
};

/** The blob page's markup for `file`, as the server renders it once its loader has drawn the file. */
const blobPage = (file: FileView) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => drawFileAhead(file));

    const text = file.text ?? "";

    return renderToStaticMarkup(
      <BlobView
        code={
          <ClientFile
            fallback={
              <FileFallback path={file.path} sha={file.sha} text={text} />
            }
            path={file.path}
            sha={file.sha}
            text={text}
          />
        }
        file={file}
        now={now}
        project={datekit}
        rev="main"
      />
    );
  });

const signature = {
  at: "2026-10-06T15:00:00.000Z",
  email: "lin@example.com",
  name: "Lin",
};

/** A commit changing `files`, imported (no landing). */
const commitOf = (files: readonly (typeof ChangedFile.Encoded)[]) =>
  Schema.decodeSync(CommitDiff)({
    commit: {
      author: signature,
      body: "",
      committer: signature,
      parents: ["2".repeat(40)],
      sha: "1".repeat(40),
      subject: "Parse ISO weeks",
      trailers: [],
      tree: "4".repeat(40),
    },
    files,
    truncated: false,
  });

/** The commit page's markup, as the server renders it once its loader has drawn the first files. */
const commitPage = (diff: CommitDiff) =>
  Effect.gen(function* () {
    const drawn = drawnFiles(diff.files);

    yield* Effect.promise(() => drawDiffAhead(diff.files));

    return renderToStaticMarkup(
      <CommitView
        diff={diff}
        drawing={
          <ClientDiffs
            fallback={
              <PlainDiff
                drawn={drawn}
                files={diff.files}
                prerendered={prerenderedPaths(drawn)}
              />
            }
            files={diff.files}
            split={false}
          />
        }
        drawn={drawn}
        now={now}
        project={datekit}
      />
    );
  });

/** The markup of one file's section of a diff. */
const sectionOf = (markup: string, path: string) =>
  new RegExp(
    `<section aria-label="${path.replaceAll(".", "\\.")}"[\\s\\S]*?</section>`,
    "u"
  ).exec(markup)?.[0] ?? "";

/** An added file at `path`, `lines` long, with a blob id of its own. */
const added = (path: string, lines: number) => {
  blobs += 1;

  return {
    after: blobs.toString(16).padStart(40, "0"),
    binary: false,
    newText: linesOf(lines),
    path,
    status: "added" as const,
  };
};

describe("a blob page's code, as the server sends it", () => {
  it.effect(
    "holds a TypeScript file highlighted, in a declarative shadow root",
    () =>
      Effect.gen(function* () {
        const markup = yield* blobPage(fileAt("src/parse.ts", TYPESCRIPT));

        expect(shadowRootsIn(markup)).toBe(1);
        expect(markup).toContain('data-code="prerendered"');
        expect(markup).toContain("<diffs-container");
        expect(tokensIn(markup)).toBeGreaterThan(5);
        expect(markup).not.toContain('data-code="plain"');
      })
  );

  it.effect(
    "holds a file in a language the server does not highlight as numbered plain text",
    () =>
      Effect.gen(function* () {
        const markup = yield* blobPage(
          fileAt("src/parse.rs", "fn parse() -> u32 {\n    1\n}\n")
        );

        expect(shadowRootsIn(markup)).toBe(0);
        expect(tokensIn(markup)).toBe(0);
        expect(markup).toContain('data-code="plain"');
        expect(markup).toContain('id="L1"');
      })
  );

  it.effect(
    "holds a file past the server's limit as plain text: too many lines, or a line too long",
    () =>
      Effect.gen(function* () {
        const long = yield* blobPage(
          fileAt("src/long.ts", linesOf(SERVER_LINES + 1))
        );

        const wide = yield* blobPage(
          fileAt("src/wide.ts", `export const wide = "${"x".repeat(1000)}";\n`)
        );

        const within = yield* blobPage(
          fileAt("src/within.ts", linesOf(SERVER_LINES))
        );

        expect([long, wide, within].map(shadowRootsIn)).toStrictEqual([
          0, 0, 1,
        ]);
        expect(long).toContain('data-code="plain"');
        expect(wide).toContain('data-code="plain"');
      })
  );
});

describe("a commit page's diff, as the server sends it", () => {
  it.effect(
    "holds a TypeScript file's changes highlighted, and an unknown language's as plain lines",
    () =>
      Effect.gen(function* () {
        const markup = yield* commitPage(
          commitOf([
            {
              after: "a".repeat(40),
              before: "b".repeat(40),
              binary: false,
              newText: TYPESCRIPT.replace(
                "fromIso(text)",
                "fromIso(text.trim())"
              ),
              oldText: TYPESCRIPT,
              path: "src/parse.ts",
              status: "modified",
            },
            {
              after: "c".repeat(40),
              binary: false,
              newText: "fn week() -> u32 {\n    1\n}\n",
              path: "src/week.rs",
              status: "added",
            },
          ])
        );

        const typescript = sectionOf(markup, "src/parse.ts");
        const rust = sectionOf(markup, "src/week.rs");

        expect(shadowRootsIn(typescript)).toBe(1);
        expect(tokensIn(typescript)).toBeGreaterThan(5);
        expect(shadowRootsIn(rust)).toBe(0);
        expect(rust).toContain('data-line-type="addition"');
        expect(rust).toContain("fn week() -&gt; u32 {");
      })
  );
});

describe("which code the server highlights", () => {
  it("highlights its languages by Pierre's names for them, and no other", () => {
    const highlighted = [
      "a.ts",
      "a.tsx",
      "a.js",
      "a.mjs",
      "a.cjs",
      "a.jsx",
      "a.json",
      "a.md",
      "a.yaml",
      "a.yml",
      "a.toml",
      "a.sh",
      "a.css",
      "a.html",
    ];

    expect(
      highlighted.filter((path) => !prerendersFile({ path, text: "x" }))
    ).toStrictEqual([]);
    expect(
      ["a.rs", "a.py", "Makefile", "a.go", "a.txt"].filter((path) =>
        prerendersFile({ path, text: "x" })
      )
    ).toStrictEqual([]);
  });

  it.effect("has a grammar for each of its languages, aliases included", () =>
    Effect.gen(function* () {
      const samples = {
        "a.css": "a { color: red; }",
        "a.html": '<p class="x">hi</p>',
        "a.js": "const a = 1;",
        "a.json": '{ "a": 1 }',
        "a.jsx": "const a = <p>hi</p>;",
        "a.md": "See [the docs](https://example.com).",
        "a.sh": 'echo "hi"',
        "a.toml": 'a = "b"',
        "a.ts": "const a: number = 1;",
        "a.tsx": "const a = <p>{1}</p>;",
        "a.yaml": "a: b",
        "a.yml": "a: b",
      };

      const drawn = yield* Effect.forEach(
        Object.entries(samples),
        ([path, text]) =>
          prerenderFile({ path, sha: `grammar:${path}`, text }).pipe(
            Effect.map((html) => [path, tokensIn(html ?? "") > 0] as const)
          )
      );

      expect(drawn.filter(([, highlighted]) => !highlighted)).toStrictEqual([]);
    })
  );

  it("highlights a diff's first open files within its lines, never a folded one", () => {
    // `a` is folded (an added file past 80 lines starts so); `b` and `c`
    // fit together; `d` would pass the limit; `e` still fits after it.
    const drawn = drawnFiles(
      decodeFiles([
        added("a.ts", 90),
        added("b.ts", 60),
        added("c.ts", 60),
        added("d.ts", SERVER_LINES),
        added("e.ts", 10),
      ])
    );

    expect([...prerenderedPaths(drawn)]).toStrictEqual([
      "b.ts",
      "c.ts",
      "e.ts",
    ]);

    const many = drawnFiles(
      decodeFiles(
        Array.from({ length: SERVER_FILES + 2 }, (_, index) =>
          added(`f${index}.ts`, 1)
        )
      )
    );

    expect(prerenderedPaths(many).size).toBe(SERVER_FILES);
  });
});
