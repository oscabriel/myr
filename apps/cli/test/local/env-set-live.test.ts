/**
 * `<cli> env set` end to end (W6 616; spec §6.7's done-when for env): the
 * CLI's real `env set`, `env shape` and `ledger` commands, over its remote
 * client as the stored profile, against the platform's Node world with the
 * visibility cartridge composed under the fake env's test `MASTER_KEY`
 * (`apps/platform/test/visibility/serve-cartridge-world.ts`, a process of
 * its own: apps never import apps).
 *
 * ines-v makes datekit and first pushes it with its committed `.env.schema`
 * and config folder, which names her its decider and vouches for bram. She
 * pipes a token into `env set`; bram, not a decider, tries the same; she
 * tries a public item and a short value. Then she opens an ask, bram
 * answers it, and the world's Checker runs the answer's checks. The value
 * shows nowhere: not in what the CLI printed or logged, not in any `/rpc`
 * or `/mcp` body the world sent, any line it logged or printed, the
 * Project DO's event log or ledger, or any job the Checker was given; the
 * DO's `env_values` row holds it sealed. What the world kept, it gives
 * through its `kept` window, once every step has run.
 */
import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CheckJob } from "@repo/checks/check-runner";
import { Client } from "@repo/protocol/contracts";
import { EnvSchemaView } from "@repo/protocol/domain/env";
import { Ledger, LedgerEntry } from "@repo/protocol/domain/visibility";
import { Envelope } from "@repo/protocol/envelope";
import {
  AskId,
  EnvKey,
  Handle,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
import {
  NotDecider,
  NotSensitive,
  ValueTooShort,
} from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { git, gitOk, spawn } from "@repo/testkit/git";
import {
  Array,
  Cause,
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  Option,
  Path,
  Redacted,
  Ref,
  References,
  Runtime,
  Schema,
  Stdio,
  Stream,
  Terminal,
} from "effect";
import { CliOutput } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { TestConsole } from "effect/testing";

import { Credentials } from "../../src/credentials.ts";
import { program } from "../../src/main.ts";
import { OutputLive } from "../../src/output.ts";
import { policyFor } from "../../src/policy.ts";
import { RemoteClient } from "../../src/remote.ts";

/** The world, from the repo root: the platform's Node world, cartridge composed. */
const WORLD = "apps/platform/test/visibility/serve-cartridge-world.ts";

const project = ProjectName.make("datekit");

const token = EnvKey.make("SENTRY_AUTH_TOKEN");

/** What ines-v pipes in: a token of 24 characters, then the newline `echo` adds. */
const value = "sk_test_0123456789abcdef";

/** A value of 8 characters, under the 12 a value needs. */
const short = "tooshort";

/** The ask ines-v opens and bram answers: one of datekit's own. */
const ask = AskId.make("parse-iso-week");

interface Person {
  readonly handle: Handle;
  /** Their platform token, as the world's sessions list it. */
  readonly token: string;
}

const ines: Person = {
  handle: Handle.make("ines-v"),
  token: "ines-v-env-set-live-token-0123456789abcdef",
};

const bram: Person = {
  handle: Handle.make("bram"),
  token: "bram-env-set-live-token-0123456789abcdefgh",
};

/** Whether datekit's first commit carries a tracked file: the library before anyone asked. */
const seeded = (file: string) =>
  [
    ".env.schema",
    `${Brand.configDir}/project.ts`,
    `${Brand.configDir}/vouched.td`,
    "package.json",
    "tsconfig.json",
  ].includes(file) ||
  /^src\/[^/]+\.ts$/u.test(file) ||
  /^test\/[^/]+\.test\.ts$/u.test(file);

/** The ask's file and the check it names, as datekit commits them. */
const askFiles = [
  `${Brand.configDir}/asks/${ask}.ask.ts`,
  `test/asks/${ask}.test.ts`,
] as const;

// --------------------------------------------------------------- the world

const Serving = Schema.fromJsonString(
  Schema.Struct({ kept: Schema.String, origin: Schema.String })
);

const decodeServing = Schema.decodeUnknownOption(Serving);

/** Where the world serves: the platform, and the test's window on what it kept. */
interface Served {
  readonly origin: string;
  readonly kept: string;
  /** Everything the world's process printed so far, stdout and stderr. */
  readonly printed: Effect.Effect<string>;
}

/**
 * The world served by a process of its own for as long as the scope
 * lasts, with ines-v and bram among its sessions. Both of its streams are
 * kept to the end, so it never blocks on a full pipe and every line it
 * printed can be searched.
 */
const servedWorld = (root: string) =>
  Effect.gen(function* () {
    const child = yield* spawn("bun", [WORLD], {
      cwd: root,
      env: {
        WORLD_SESSIONS: JSON.stringify({
          [ines.token]: ines.handle,
          [bram.token]: bram.handle,
        }),
      },
    });

    const printed = yield* Ref.make("");
    const serving = yield* Deferred.make<typeof Serving.Type>();

    const keep = (text: string) => Ref.update(printed, (all) => all + text);

    yield* Stream.decodeText(child.stderr).pipe(
      Stream.runForEach(keep),
      Effect.ignore,
      Effect.forkScoped
    );

    yield* Stream.splitLines(Stream.decodeText(child.stdout)).pipe(
      Stream.runForEach((line) =>
        Effect.andThen(
          keep(`${line}\n`),
          Option.match(decodeServing(line), {
            onNone: () => Effect.void,
            onSome: (where) => Deferred.succeed(serving, where),
          })
        )
      ),
      Effect.ignore,
      Effect.forkScoped
    );

    const ended = child.exitCode.pipe(
      Effect.ignore,
      Effect.andThen(Ref.get(printed)),
      Effect.flatMap((said) =>
        Effect.die(`the world ended before it served: ${said}`)
      )
    );

    const where = yield* Effect.raceFirst(Deferred.await(serving), ended).pipe(
      Effect.timeout("60 seconds"),
      Effect.orDie
    );

    return { ...where, printed: Ref.get(printed) } satisfies Served;
  });

/** What the world's `kept` window gives: each part as the world encoded it. */
const Kept = Schema.fromJsonString(
  Schema.Struct({
    bodies: Schema.Array(Schema.String),
    jobs: Schema.Array(Schema.Unknown),
    logged: Schema.Array(Schema.String),
    store: Schema.NullOr(
      Schema.Struct({
        envValues: Schema.Array(
          Schema.Struct({
            key: Schema.String,
            sealed: Schema.Record(Schema.String, Schema.Unknown),
            setAt: Schema.String,
            setBy: Schema.String,
          })
        ),
        events: Schema.Array(Schema.Unknown),
        ledger: Schema.Array(Schema.Unknown),
      })
    ),
  })
);

/** What the world kept for datekit. */
const keptBy = (world: Served) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.get(`${world.kept}/kept?project=${project}`);

    return yield* Schema.decodeEffect(Kept)(yield* response.text);
  }).pipe(Effect.orDie);

/** Carries every answer run the world has queued. */
const settle = (world: Served) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.post(`${world.kept}/settle`);

    return response.status === 204
      ? yield* Effect.void
      : yield* Effect.die(`the world did not settle: ${response.status}`);
  }).pipe(Effect.orDie);

// MCP's 2026-07-28 protocol is stateless: each request names its version
// and client in `_meta` and repeats its method in a header.
const mcpVersion = "2026-07-28";

const Listed = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      tools: Schema.Array(Schema.Struct({ name: Schema.String })),
    }),
  })
);

/** The names of the tools the world's `/mcp` lists to `as`. */
const toolsListed = (world: Served, as: Person) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const request = HttpClientRequest.post(`${world.origin}/mcp`).pipe(
      HttpClientRequest.setHeaders({
        accept: "application/json, text/event-stream",
        "mcp-method": "tools/list",
        "mcp-protocol-version": mcpVersion,
      }),
      HttpClientRequest.bearerToken(as.token),
      HttpClientRequest.bodyText(
        JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "tools/list",
          params: {
            _meta: {
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": {
                name: "test",
                version: "0.0.0",
              },
              "io.modelcontextprotocol/protocolVersion": mcpVersion,
            },
          },
        }),
        "application/json"
      )
    );

    const response = yield* http.execute(request);
    const text = yield* response.text;

    // The reply is plain JSON or an event stream; its last message answers.
    const last =
      response.headers["content-type"]?.includes("text/event-stream") === true
        ? (text
            .split("\n")
            .findLast((line) => line.startsWith("data: "))
            ?.slice("data: ".length) ?? "")
        : text;

    const { result } = yield* Schema.decodeEffect(Listed)(last);

    return result.tools.map(({ name }) => name);
  }).pipe(Effect.orDie);

// ----------------------------------------------------------------- people

/** Credentials holding `as`'s profile on the world, as `login` would have stored it. */
const signedIn = (world: Served, as: Person) =>
  Layer.succeed(Credentials)({
    current: Effect.succeedSome({
      handle: as.handle,
      token: Redacted.make(as.token),
      url: world.origin,
    }),
    forHost: () => Effect.succeedNone,
    put: () => Effect.die("the test stores no profile"),
    remove: () => Effect.die("the test removes no profile"),
  });

/** The CLI's own client of the contracts, as `as`, for the steps the test sets up. */
const clientOf = (world: Served, as: Person) =>
  Effect.map(
    Layer.build(RemoteClient.pipe(Layer.provide(signedIn(world, as)))),
    (built) => Context.get(built, Client)
  );

/**
 * `as`'s git: every command through a credential helper that gives their
 * handle and token, as the CLI's helper gives git a stored profile's.
 */
const gitOf = (helpers: string, as: Person) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const helper = `${helpers}/${as.handle}`;

    yield* fs.writeFileString(
      helper,
      [
        "#!/bin/sh",
        'test "$1" = get || exit 0',
        `echo username=${as.handle}`,
        `echo password=${as.token}`,
        "",
      ].join("\n")
    );

    yield* fs.chmod(helper, 0o700);

    const helped = ["-c", `credential.helper=${helper}`];

    return {
      ok: (cwd: string, ...args: string[]) => gitOk(cwd, ...helped, ...args),
      run: (cwd: string, ...args: string[]) => git(cwd, ...helped, ...args),
    };
  });

// -------------------------------------------------------------- the CLI

/** What one run of the CLI did: its exit code, and what it printed and logged, by line. */
interface Ran {
  readonly code: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
  readonly logged: readonly string[];
}

/** A terminal that fails any prompt: nothing here may prompt. */
const noPrompts = Layer.succeed(Terminal.Terminal)(
  Terminal.make({
    columns: Effect.succeed(80),
    display: () => Effect.die("the CLI prompted"),
    readInput: Effect.die("the CLI prompted"),
    readLine: Effect.die("the CLI prompted"),
    rows: Effect.succeed(24),
  })
);

/** How the process would exit, by the runtime's own rule. */
const exitCodeOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? 0 : Runtime.getErrorExitCode(Cause.squash(exit.cause));

/** Each line of what a stream got, however it was written. */
const linesOf = (chunks: readonly unknown[]) =>
  chunks.flatMap((chunk) => String(chunk).split("\n"));

/**
 * `<cli> <args>` as `as`, a person at a terminal whose stdin is `stdin`
 * piped in: the real command tree and output, the real remote client over
 * HTTP to the world, and their stored profile.
 */
const cli = (
  world: Served,
  as: Person,
  args: readonly string[],
  stdin = ""
): Effect.Effect<Ran> =>
  Effect.suspend(() => {
    const logged: string[] = [];
    const policy = policyFor({ env: {}, isTTY: true });
    const credentials = signedIn(world, as);

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(program(args));

      return {
        code: exitCodeOf(exit),
        err: linesOf(yield* TestConsole.errorLines),
        logged,
        out: linesOf(yield* TestConsole.logLines),
      };
    }).pipe(
      Effect.provideService(References.MinimumLogLevel, "All"),
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          TestConsole.layer,
          CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
          RemoteClient.pipe(Layer.provide(credentials)),
          credentials,
          policy,
          OutputLive.pipe(Layer.provide(policy)),
          noPrompts,
          Logger.layer([
            Logger.make((options) => {
              logged.push(Logger.formatSimple.log(options));
            }),
          ]),
          // Last, so it stands in for the host's stdio.
          Stdio.layerTest({
            stdin: Stream.make(new TextEncoder().encode(stdin)),
            stdinIsTerminal: Effect.succeed(false),
          })
        )
      )
    );
  });

// ------------------------------------------------------------ the scenario

/** Everything the scenario did and the world kept, read by each test below. */
class Scenario extends Context.Service<
  Scenario,
  {
    /** ines-v's `env set` of the token, its refusals, and bram's. */
    readonly set: Ran;
    readonly byBram: Ran;
    readonly publicItem: Ran;
    readonly tooShort: Ran;
    /** `env shape --json` and `ledger --json` once the token was set. */
    readonly envView: Ran;
    readonly ledger: Ran;
    /** bram's push of his answer, as git printed it. */
    readonly answered: { readonly exitCode: number; readonly stderr: string };
    /** The jobs the Checker was given for the answer: those made while the world settled. */
    readonly answerJobs: readonly CheckJob[];
    /** The tools `/mcp` lists to ines-v. */
    readonly tools: readonly string[];
    readonly kept: typeof Kept.Type;
    /** All the world's process printed, stdout and stderr. */
    readonly printed: string;
  }
>()("test/EnvSetLiveScenario") {}

/**
 * The jobs as the world encoded them: by `CheckJob`'s fields alone, so a
 * job of unlanded code that carries values decodes, and a test refuses it.
 */
const decodeJobs = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct(CheckJob.fields))
);

/**
 * The scenario, run once: datekit made and first pushed by ines-v, the
 * token set and the refusals met through the CLI, then an ask opened by
 * ines-v and answered by bram, the answer's checks run, and what the world
 * kept read back.
 */
const ScenarioOnce = Layer.effect(
  Scenario,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const root = yield* path.fromFileUrl(
      new URL("../../../../", import.meta.url)
    );

    const example = path.join(root, "examples", "datekit");
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "env-set-live-" });
    const world = yield* servedWorld(root);
    const helpers = path.join(home, "helpers");

    yield* fs.makeDirectory(helpers);

    const inesGit = yield* gitOf(helpers, ines);
    const bramGit = yield* gitOf(helpers, bram);
    const asInes = yield* clientOf(world, ines);
    const asBram = yield* clientOf(world, bram);

    // ines-v makes datekit and first pushes the library as committed, its
    // `.env.schema` and its config folder in it.
    const made = yield* asInes.initProject({ project });
    const start = path.join(home, "start");

    const tracked = yield* gitOk(example, "ls-files", "--full-name", ".");
    const prefix = "examples/datekit/";

    yield* fs.makeDirectory(start);

    for (const file of tracked
      .split("\n")
      .map((line) => line.slice(prefix.length))) {
      if (seeded(file)) {
        yield* fs.makeDirectory(path.dirname(path.join(start, file)), {
          recursive: true,
        });
        yield* fs.copyFile(path.join(example, file), path.join(start, file));
      }
    }

    yield* gitOk(start, "init", "--quiet", "--initial-branch=main");
    yield* gitOk(start, "add", "--all");
    yield* gitOk(start, "commit", "--quiet", "--message", "Start datekit");
    yield* inesGit.ok(start, "push", "--quiet", made.remote, "HEAD:main");

    // The token, piped in as `printf '%s\n' "$TOKEN" |` gives it; then bram,
    // a public item and a short value.
    const setting = (key: string) => [
      "env",
      "set",
      key,
      "--project",
      project,
      "--yes",
    ];

    const set = yield* cli(world, ines, setting(token), `${value}\n`);
    const byBram = yield* cli(world, bram, setting(token), `${value}\n`);

    const publicItem = yield* cli(
      world,
      ines,
      setting("APP_ENV"),
      `${value}\n`
    );

    const tooShort = yield* cli(world, ines, setting(token), `${short}\n`);

    const envView = yield* cli(world, ines, [
      "env",
      "shape",
      "--project",
      project,
      "--json",
    ]);

    const ledger = yield* cli(world, ines, [
      "ledger",
      "--project",
      project,
      "--json",
    ]);

    // ines-v opens one of datekit's asks (red first on the world's
    // Checker); bram claims it and pushes an answer to his claim's fork.
    const files = yield* Effect.forEach(askFiles, (file) =>
      Effect.map(fs.readFileString(path.join(example, file)), (content) => ({
        content,
        path: RepoPath.make(file),
      }))
    );

    yield* asInes.openAsk({
      ask,
      files: Array.isReadonlyArrayNonEmpty(files)
        ? files
        : yield* Effect.die("the ask has no files"),
      project,
    });

    const { claim } = yield* asBram.claim({ ask, project });
    const work = path.join(home, "work");

    yield* bramGit.ok(home, "clone", "--quiet", claim.remote, work);

    const parse = path.join(work, "src", "parse.ts");

    yield* fs.writeFileString(
      parse,
      `${yield* fs.readFileString(parse)}// Week dates next.\n`
    );

    yield* gitOk(
      work,
      "commit",
      "--quiet",
      "--all",
      "--message",
      "Read week dates"
    );

    const answered = yield* bramGit.run(work, "push", "origin", "HEAD:main");
    const before = (yield* keptBy(world)).jobs.length;

    yield* settle(world);

    // Last, what MCP lists, then everything the world kept and printed.
    const tools = yield* toolsListed(world, ines);
    const kept = yield* keptBy(world);

    return {
      answerJobs: yield* decodeJobs(kept.jobs.slice(before)),
      answered,
      byBram,
      envView,
      kept,
      ledger,
      printed: yield* world.printed,
      publicItem,
      set,
      tooShort,
      tools,
    };
  }).pipe(Effect.orDie)
).pipe(Layer.provide([NodeServices.layer, FetchHttpClient.layer]));

// ------------------------------------------------------------------ tests

const decodeEnvelope = <A extends Schema.Top>(data: A) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(Envelope(data)));

/** What a `--json` run printed: its one envelope's data, as encoded, if it was not refused. */
const dataOf = (ran: Ran) =>
  Effect.map(
    decodeEnvelope(Schema.Unknown)(ran.out.join("\n")).pipe(Effect.orDie),
    (printed) => (printed.ok ? printed.data : undefined)
  );

/** A run's lines, less the empty ones a trailing newline leaves. */
const filled = (lines: readonly string[]) =>
  lines.filter((line) => line.length > 0);

/** Everything a run printed or logged, as one text. */
const allOf = (ran: Ran) => [...ran.out, ...ran.err, ...ran.logged].join("\n");

/**
 * The value base64-encoded from `shift` bytes into a longer text, less the
 * characters it shares there with its neighbours: what any base64 text
 * holding the value at that alignment contains.
 */
const base64At = (shift: number) => {
  const encoded = btoa(`${"\0".repeat(shift)}${value}`);

  return encoded.slice(
    shift === 0 ? 0 : 4,
    (shift + value.length) % 3 === 0 ? encoded.length : encoded.length - 4
  );
};

/**
 * The value, and what base64 or base64url leaves of it wherever it starts
 * inside an encoded text.
 */
const forms = [
  value,
  ...[0, 1, 2]
    .map(base64At)
    .flatMap((form) => [form, form.replaceAll("+", "-").replaceAll("/", "_")]),
];

/** Whether a text holds the value in any form. */
const holds = (text: string) => forms.some((form) => text.includes(form));

/** When the token was set, as the CLI printed it. */
const setAtOf = (set: Ran) =>
  / at (?<at>\S+Z)\. /u.exec(filled(set.out)[0] ?? "")?.groups?.at;

/** A ledger's entries as encoded: each one's fields, whatever they are. */
const Entries = Schema.Struct({
  entries: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
});

/** The token's item in the env shape `env shape --json` printed, if it lists one. */
const tokenItem = (envView: Ran) =>
  Effect.map(
    decodeEnvelope(EnvSchemaView)(envView.out.join("\n")).pipe(Effect.orDie),
    (printed) =>
      printed.ok
        ? printed.data.items.find(({ key }) => key === token)
        : undefined
  );

/** What unlanded code sees in place of the token: its key, made a placeholder. */
const placeholder = `__${token}_PLACEHOLDER__`;

layer(ScenarioOnce, { excludeTestServices: true, timeout: "240 seconds" })(
  `${Brand.cli} env set against the platform's Node world, the visibility cartridge composed`,
  (it) => {
    it.effect(
      "stores ines-v's piped token and prints one line naming the key, ines-v and a time",
      () =>
        Effect.gen(function* () {
          const { set } = yield* Scenario;

          expect({
            code: set.code,
            err: filled(set.err),
            out: filled(set.out),
          }).toStrictEqual({
            code: 0,
            err: [],
            out: [
              expect.stringMatching(
                /^SENTRY_AUTH_TOKEN on datekit was set by ines-v at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\. Nobody can read it back\.$/u
              ),
            ],
          });
        })
    );

    it.effect(
      "shows who set the token and when in env shape and in the ledger, and nothing more of it",
      () =>
        Effect.gen(function* () {
          const { envView, ledger, set } = yield* Scenario;
          const item = yield* tokenItem(envView);
          const at = setAtOf(set) ?? "never";

          const data = yield* dataOf(ledger);
          const { entries } = yield* Schema.decodeUnknownEffect(Ledger)(data);
          const encoded = yield* Schema.decodeUnknownEffect(Entries)(data);

          expect({
            code: envView.code,
            sensitive: item?.sensitive,
            setAt: item?.value && DateTime.formatIso(item.value.setAt),
            setBy: item?.value?.setBy,
          }).toStrictEqual({
            code: 0,
            sensitive: true,
            setAt: at,
            setBy: "ines-v",
          });
          expect(entries).toStrictEqual([
            LedgerEntry.cases.ValueSet.make({
              at: DateTime.makeUnsafe(at),
              by: ines.handle,
              key: token,
              seq: 1,
            }),
          ]);
          // The entry is who, which key and when, numbered: no field holds more.
          expect(
            encoded.entries.map((entry) => Object.keys(entry).toSorted())
          ).toStrictEqual([["_tag", "at", "by", "key", "seq"]]);
        })
    );

    it.effect(
      "leaves the value in no output, response body, log line, event, ledger entry or job, and the DO's row holds it sealed",
      () =>
        Effect.gen(function* () {
          const scenario = yield* Scenario;
          const { kept, printed, set } = scenario;

          const runs = [
            scenario.set,
            scenario.byBram,
            scenario.publicItem,
            scenario.tooShort,
            scenario.envView,
            scenario.ledger,
          ];

          // Counts, so a failure never prints what it found.
          expect({
            bodies: kept.bodies.filter(holds).length,
            cli: runs.filter((ran) => holds(allOf(ran))).length,
            envValues: holds(JSON.stringify(kept.store?.envValues ?? null)),
            events: holds(JSON.stringify(kept.store?.events ?? null)),
            jobs: holds(JSON.stringify(kept.jobs)),
            ledger: holds(JSON.stringify(kept.store?.ledger ?? null)),
            logged: kept.logged.filter(holds).length,
            printed: holds(printed),
          }).toStrictEqual({
            bodies: 0,
            cli: 0,
            envValues: false,
            events: false,
            jobs: false,
            ledger: false,
            logged: 0,
            printed: false,
          });

          // What was searched holds what happened: the set's reply, its
          // log line, its sealed row and its ledger event.
          const reply = JSON.stringify({
            key: token,
            setAt: setAtOf(set),
            setBy: "ines-v",
          });

          expect({
            event: JSON.stringify(kept.store?.events ?? null).includes(
              '"entry":{"_tag":"ValueSet"'
            ),
            logged: kept.logged.filter((line) =>
              line.includes('"a write-only value was set"')
            ),
            printed: printed.includes("a write-only value was set"),
            replies: kept.bodies.filter((body) => body.includes(reply)).length,
            rows: kept.store?.envValues.map(
              ({ key, sealed, setAt, setBy }) => ({
                key,
                sealed: Object.keys(sealed).length > 0,
                setAt,
                setBy,
              })
            ),
          }).toStrictEqual({
            event: true,
            logged: [
              `["a write-only value was set"] {"by":"ines-v","key":"${token}"}`,
            ],
            printed: true,
            replies: 1,
            rows: [
              {
                key: token,
                sealed: true,
                setAt: setAtOf(set),
                setBy: "ines-v",
              },
            ],
          });
        })
    );

    it.effect(
      "refuses bram, no decider, with NotDecider printed once and exit 1",
      () =>
        Effect.gen(function* () {
          const { byBram } = yield* Scenario;

          expect({
            code: byBram.code,
            err: filled(byBram.err),
            out: filled(byBram.out),
          }).toStrictEqual({
            code: 1,
            err: explain([new NotDecider({})]),
            out: [],
          });
        })
    );

    it.effect(
      "refuses a public item NotSensitive, and a short value ValueTooShort that tells neither the value nor its length",
      () =>
        Effect.gen(function* () {
          const { publicItem, tooShort } = yield* Scenario;

          expect({
            publicItem: {
              code: publicItem.code,
              err: filled(publicItem.err),
              out: filled(publicItem.out),
            },
            tooShort: {
              code: tooShort.code,
              err: filled(tooShort.err),
              out: filled(tooShort.out),
            },
          }).toStrictEqual({
            publicItem: {
              code: 1,
              err: explain([new NotSensitive({ key: EnvKey.make("APP_ENV") })]),
              out: [],
            },
            tooShort: {
              code: 1,
              err: explain([ValueTooShort.of(token, 12)]),
              out: [],
            },
          });
          expect(allOf(tooShort)).not.toContain(short);
          expect(allOf(tooShort)).not.toContain(String(short.length));
        })
    );

    it.effect(
      "gives the answer's checks the token's placeholder, and no value",
      () =>
        Effect.gen(function* () {
          const { answerJobs, answered } = yield* Scenario;

          expect(answered.exitCode).toBe(0);
          expect(answered.stderr).toContain(`remote: checking ${ask} at `);
          expect(answerJobs.map(({ repo }) => repo)).toContain(
            `${project}--${ask}--${bram.handle}`
          );
          expect(
            answerJobs.map((job) => ({
              landed: job.landed ?? false,
              placeholders: job.placeholders,
              proxies: job.proxies,
              values: job.values?.length ?? 0,
            }))
          ).toStrictEqual(
            answerJobs.map(() => ({
              landed: false,
              placeholders: [{ key: token, placeholder }],
              proxies: [
                {
                  block: false,
                  host: "sentry.io",
                  key: token,
                  path: "/api/**",
                  placeholder,
                },
              ],
              values: 0,
            }))
          );
        })
    );

    it.effect(
      "serves no setEnv tool over /mcp, where it serves the env shape's",
      () =>
        Effect.gen(function* () {
          const { tools } = yield* Scenario;

          expect(tools).toContain("envShape");
          expect(tools).not.toContain("setEnv");
        })
    );
  }
);
