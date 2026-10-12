import { Brand } from "@repo/brand";
import { gitOk } from "@repo/testkit/git";
import { Effect, FileSystem, Path } from "effect";

export const project = "alice/fixture";

export const ask = "fix-a";

export const handle = "alice";

export const platform = "https://platform.example.dev";

const forkRemote = `${platform}/${project}--${ask}--${handle}.git`;

export const policyFile = `${Brand.configDir}/policy.json`;

export const checkFile = "packages/a/test/a.test.ts";

// The fixture's `{configDir}` is written over with the brand's folder name.
export const policyText = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const file = yield* path.fromFileUrl(
    new URL("../fixtures/check/policy.json", import.meta.url)
  );

  const text = yield* fs.readFileString(file);

  return text.replaceAll("{configDir}", Brand.configDir);
});

const testOnMain = [
  'import { expect, it } from "vitest";',
  'import { a } from "../src/a.ts";',
  "",
  'it("is two", () => expect(a).toBe(2));',
  "",
].join("\n");

const onMain = {
  [checkFile]: testOnMain,
  "package.json":
    '{ "name": "fixture", "private": true, "workspaces": ["packages/*"] }\n',
  "packages/a/package.json":
    '{ "name": "a", "exports": { ".": "./src/a.ts" } }\n',
  "packages/a/src/a.ts": "export const a = 1;\n",
  "packages/b/package.json": '{ "name": "b" }\n',
  "packages/b/src/b.ts": "export const b = 1;\n",
} as const satisfies Readonly<Record<string, string>>;

const straying = {
  [checkFile]: testOnMain.replace(
    "it(",
    'it.skip("is one", () => expect(a).toBe(1));\nit('
  ),
  "packages/a/src/a.ts": "export const a = 2;\n",
  "packages/b/src/b.ts": "export const b = 2;\n",
} as const satisfies Readonly<Record<string, string>>;

const clean = {
  "packages/a/src/a.ts": "export const a = 2;\n",
} as const satisfies Readonly<Record<string, string>>;

export interface CheckRepo {
  readonly root: string;
  readonly main: string;
  readonly straying: string;
  readonly clean: string;
}

const write = (root: string, files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    for (const [file, content] of Object.entries(files)) {
      const at = path.join(root, file);

      yield* fs.makeDirectory(path.dirname(at), { recursive: true });
      yield* fs.writeFileString(at, content);
    }
  });

export const commit = (
  root: string,
  files: Readonly<Record<string, string>>,
  message: string
) =>
  Effect.gen(function* () {
    yield* write(root, files);
    yield* gitOk(root, "add", "--all");
    yield* gitOk(root, "commit", "--quiet", "--message", message);

    return yield* gitOk(root, "rev-parse", "HEAD");
  });

export const aCheckRepo = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());

  yield* gitOk(root, "init", "--quiet", "--initial-branch", "main");
  yield* gitOk(root, "remote", "add", "origin", forkRemote);

  const main = yield* commit(
    root,
    { ...onMain, [policyFile]: yield* policyText },
    "Start the fixture"
  );

  yield* gitOk(root, "checkout", "--quiet", "-b", "clean");

  const fixed = yield* commit(root, clean, "Make a two");

  yield* gitOk(root, "checkout", "--quiet", "-b", "straying", "main");

  const strayed = yield* commit(root, straying, "Make a two, and more");

  return { clean: fixed, main, root, straying: strayed } satisfies CheckRepo;
});
