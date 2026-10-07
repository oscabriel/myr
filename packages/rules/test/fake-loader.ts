import { spawn } from "@repo/testkit/git";
import { Effect, FileSystem, Path, Predicate, Stream } from "effect";
import type { Context } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import type {
  LoaderBinding,
  LoaderCode,
  LoaderEntrypoint,
  LoaderModule,
} from "../src/rules-evaluator/worker.ts";

/** How a loaded worker's entrypoint answers every request. */
export type Answer =
  /** With this body. */
  | { readonly responds: string }
  /** By rejecting with this error, as the runtime does when the worker fails. */
  | { readonly rejects: Error }
  /** Never. */
  | { readonly hangs: true };

/** One cold start: the id the adapter asked for, and the code it handed over. */
export interface Load {
  readonly code: LoaderCode;
  readonly id: string;
}

/** A fake Worker Loader, and what it saw. */
export interface FakeLoader {
  readonly binding: LoaderBinding;
  /** The stubs and entrypoints handed out, and how many were disposed. */
  readonly handles: () => { readonly disposed: number; readonly out: number };
  /** Each cold start, in order: a warm id loads nothing. */
  readonly loads: readonly Load[];
  /** Each request's body, as sent. */
  readonly requests: readonly string[];
}

// `Symbol.dispose`, which the runtime calls a stub's release by; the lib the
// repo compiles against (ES2023) doesn't type it.
const disposeKey: unknown = Object.getOwnPropertyDescriptor(
  Symbol,
  "dispose"
)?.value;

/**
 * A fake Worker Loader whose workers answer every request the same way. It
 * keeps workers warm by id, as the Loader does: a second `get` with an id it
 * has seen calls no `getCode`.
 */
export const fakeLoader = (answer: Answer): FakeLoader => {
  const loads: Load[] = [];
  const requests: string[] = [];
  const warm = new Set<string>();
  const counts = { disposed: 0, out: 0 };

  /** A handle that counts itself out, and in again when disposed. */
  const handle = <A extends object>(value: A): A => {
    counts.out += 1;

    if (Predicate.isSymbol(disposeKey)) {
      Object.defineProperty(value, disposeKey, {
        value: () => {
          counts.disposed += 1;
        },
      });
    }

    return value;
  };

  const entrypoint = (): LoaderEntrypoint =>
    handle({
      fetch: (_url, init) => {
        requests.push(init.body);

        if ("responds" in answer) {
          return Promise.resolve({
            text: () => Promise.resolve(answer.responds),
          });
        }

        return "rejects" in answer
          ? Promise.reject(answer.rejects)
          : Promise.race([]);
      },
    });

  return {
    binding: {
      get: (id, getCode) => {
        if (!warm.has(id)) {
          warm.add(id);
          loads.push({ code: getCode(), id });
        }

        return handle({ getEntrypoint: entrypoint });
      },
    },
    handles: () => ({ ...counts }),
    loads,
    requests,
  };
};

/** A module's source, as the Loader would read it. */
const sourceOf = (module: LoaderModule) => {
  if ("js" in module) {
    return module.js;
  }

  return "json" in module ? JSON.stringify(module.json) : module.text;
};

/** Runs the main's default `fetch` once, and prints what it answered. */
const harness = `
import worker from "./main.js";
const body = await Bun.file(new URL("./request.json", import.meta.url)).text();
const response = await worker.fetch(new Request("https://rules.invalid/", { body, method: "POST" }));
process.stdout.write(await response.text());
process.exit(0);
`;

/** Writes the code's modules under a temp directory, and runs one request. */
const runInBun = (code: LoaderCode, body: string, sdk: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "loader-" });

      const files = {
        ...Object.fromEntries(
          Object.entries(code.modules).map(([name, module]) => [
            name,
            // The config modules import the sdk by its workspace name.
            sourceOf(module).replaceAll('"@repo/sdk"', JSON.stringify(sdk)),
          ])
        ),
        "request.json": body,
        "run.mjs": harness,
      };

      for (const [name, source] of Object.entries(files)) {
        const file = path.join(dir, name);

        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, source);
      }

      const child = yield* spawn("bun", [path.join(dir, "run.mjs")], {
        cwd: dir,
      });

      const [stdout, stderr] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.decodeText(), Stream.mkString),
        ],
        { concurrency: "unbounded" }
      );

      return stdout === "" ? `bun printed nothing: ${stderr}` : stdout;
    })
  ).pipe(Effect.orDie);

/**
 * A Loader that runs the code it is handed, in a `bun` subprocess per
 * request: Bun stands in for workerd, so the main and the prelude are run
 * as the JavaScript they are, without workerd's limits. Every import of the
 * sdk by its workspace name points at `sdk`.
 */
export const bunLoader = (
  services: Context.Context<
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >,
  sdk: string
): LoaderBinding => ({
  get: (_id, getCode) => {
    const code = getCode();

    return {
      getEntrypoint: () => ({
        fetch: (_url, init) =>
          Effect.runPromiseWith(services)(
            Effect.map(runInBun(code, init.body, sdk), (text) => ({
              text: () => Promise.resolve(text),
            }))
          ),
      }),
    };
  },
});
