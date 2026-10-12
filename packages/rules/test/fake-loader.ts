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

export type Answer =
  | { readonly responds: string }
  | { readonly rejects: Error }
  | { readonly hangs: true };

export interface Load {
  readonly code: LoaderCode;
  readonly id: string;
}

export interface FakeLoader {
  readonly binding: LoaderBinding;
  readonly handles: () => { readonly disposed: number; readonly out: number };
  readonly loads: readonly Load[];
  readonly requests: readonly string[];
}

// `Symbol.dispose`, which the runtime calls a stub's release by; the lib the
// repo compiles against (ES2023) doesn't type it.
const disposeKey: unknown = Object.getOwnPropertyDescriptor(
  Symbol,
  "dispose"
)?.value;

/** Keeps workers warm by id, as the Loader does: a second `get` with a seen id calls no `getCode`. */
export const fakeLoader = (answer: Answer): FakeLoader => {
  const loads: Load[] = [];
  const requests: string[] = [];
  const warm = new Set<string>();
  const counts = { disposed: 0, out: 0 };

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

const sourceOf = (module: LoaderModule) => {
  if ("js" in module) {
    return module.js;
  }

  return "json" in module ? JSON.stringify(module.json) : module.text;
};

const harness = `
import worker from "./main.js";
const body = await Bun.file(new URL("./request.json", import.meta.url)).text();
const response = await worker.fetch(new Request("https://rules.invalid/", { body, method: "POST" }));
process.stdout.write(await response.text());
process.exit(0);
`;

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

/** Bun stands in for workerd, so the main and the prelude run as the JavaScript they are, without workerd's limits. */
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
