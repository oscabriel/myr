import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client } from "@repo/protocol/contracts";
import { gitOk, spawn } from "@repo/testkit/git";
import { httpBackend } from "@repo/testkit/http-backend";
import {
  ConfigProvider,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Queue,
  Redacted,
  Ref,
  Schema,
  Sink,
  Stdio,
  Stream,
  Terminal,
} from "effect";
import type { Cause } from "effect";
import { CliOutput } from "effect/cli";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { ChildProcessSpawner } from "effect/process";
import { TestConsole } from "effect/testing";

import { credentialHelper, currentEnv } from "../../src/credential-helper.ts";
import { Credentials, CredentialsFile } from "../../src/credentials.ts";
import type { Profile } from "../../src/credentials.ts";
import { program } from "../../src/main.ts";
import { OutputPlain } from "../../src/output.ts";

const SLUG = Brand.slug.toUpperCase();

const token = "t0ken-0123456789abcdefghijklmnopqrstuvwxyz";

const platform: Profile = {
  token: Redacted.make(token),
  url: "https://platform.test",
};

const asked = (host: string, protocol = "https") =>
  `protocol=${protocol}\nhost=${host}\npath=datekit--fix-week--alice.git\n\n`;

const pi = { AI_AGENT: "pi", PI_MODEL: "kimi-k3" };

const encoder = new TextEncoder();

const decoder = new TextDecoder();

const credentialsIn = (env: Record<string, string>) =>
  CredentialsFile.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))
  );

const storedIn = (profiles: Readonly<Record<string, Profile>>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    const env = { HOME: "/nonexistent", XDG_CONFIG_HOME: dir };

    const credentials = yield* Effect.provide(
      Effect.service(Credentials),
      credentialsIn(env)
    );

    for (const [name, profile] of Object.entries(profiles)) {
      yield* credentials.put(name, profile);
    }

    return env;
  });

const noTerminal = Layer.succeed(
  Terminal.Terminal,
  Terminal.make({
    columns: Effect.die("the helper read the terminal's width"),
    display: () => Effect.die("the helper wrote to the terminal"),
    readInput: Effect.die("the helper read the terminal"),
    readLine: Effect.die("the helper prompted on the terminal"),
    rows: Effect.die("the helper read the terminal's height"),
  })
);

const helper = (
  op: string,
  stdin: Stream.Stream<Uint8Array>,
  env: Record<string, string>
) =>
  Effect.gen(function* () {
    const written = yield* Queue.unbounded<string | Uint8Array, Cause.Done>();

    const stdio = Stdio.layerTest({
      stdin,
      stdout: () => Sink.fromQueue(written),
    });

    const exit = yield* Effect.exit(
      program(["credential", op]).pipe(
        Effect.provide(
          // The test stdio and terminal come last, so they stand in for Node's.
          Layer.mergeAll(
            Layer.mergeAll(
              CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
              Layer.mock(Client)({}),
              OutputPlain,
              credentialsIn(env),
              ConfigProvider.layer(ConfigProvider.fromEnv({ env }))
            ).pipe(Layer.provideMerge(NodeServices.layer)),
            stdio,
            noTerminal
          )
        )
      )
    );

    const stderr = (yield* TestConsole.errorLines).map(String);

    const stdout = (yield* Queue.clear(written))
      .map((chunk) =>
        Predicate.isString(chunk) ? chunk : decoder.decode(chunk)
      )
      .join("");

    return { ok: Exit.isSuccess(exit), stderr, stdout };
  }).pipe(Effect.provide(TestConsole.layer));

const input = (text: string) => Stream.make(encoder.encode(text));

describe(`${Brand.cli} credential, git's credential helper`, () => {
  it.live(
    "hands git the stored token for the platform's host, with the harness as audit metadata in the username",
    () =>
      Effect.gen(function* () {
        const env = yield* storedIn({ default: platform });

        const ran = yield* helper("get", input(asked("platform.test")), {
          ...env,
          ...pi,
        });

        expect(ran).toStrictEqual({
          ok: true,
          stderr: [],
          stdout: `username=audit;harness=pi&model=kimi-k3\npassword=${token}\n`,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("says nothing for another host, so git asks its next helper", () =>
    Effect.gen(function* () {
      const env = yield* storedIn({ default: platform });

      const ran = yield* helper("get", input(asked("github.com")), {
        ...env,
        ...pi,
      });

      expect(ran).toStrictEqual({ ok: true, stderr: [], stdout: "" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("never hands the token to the platform's host over plain http", () =>
    Effect.gen(function* () {
      const env = yield* storedIn({ default: platform });

      const ran = yield* helper(
        "get",
        input(asked("platform.test", "http")),
        env
      );

      expect(ran.ok).toBeTruthy();
      expect(ran.stdout).toBe("");
      expect(ran.stderr.join("\n")).not.toContain(token);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "with no login, says nothing to git and one line to the person naming login",
    () =>
      Effect.gen(function* () {
        const env = yield* storedIn({});

        const ran = yield* helper("get", input(asked("platform.test")), env);

        expect(ran.ok).toBeTruthy();
        expect(ran.stdout).toBe("");
        expect(ran.stderr).toHaveLength(1);
        expect(ran.stderr[0]).toContain(`${Brand.cli} login`);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "under a named profile, answers only as that person, never with another profile's token on the host",
    () =>
      Effect.gen(function* () {
        const bob: Profile = {
          token: Redacted.make("bob-token-0123456789abcdefghijklmnopqrstuv"),
          url: "https://elsewhere.test",
        };

        const env = yield* storedIn({ alice: platform, bob });

        const asBob = yield* helper("get", input(asked("platform.test")), {
          ...env,
          [`${SLUG}_PROFILE`]: "bob",
        });

        const asCarol = yield* helper("get", input(asked("platform.test")), {
          ...env,
          [`${SLUG}_PROFILE`]: "carol",
        });

        expect({ asBob, asCarol: asCarol.stdout }).toStrictEqual({
          asBob: { ok: true, stderr: [], stdout: "" },
          asCarol: "",
        });
        expect(asCarol.stderr).toHaveLength(1);
        expect(asCarol.stderr[0]).toContain(
          `${Brand.cli} login --profile carol`
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live.each(["store", "erase"])(
    "%s reads what git sends, prints nothing and keeps the stored token",
    (op) =>
      Effect.gen(function* () {
        const env = yield* storedIn({ default: platform });

        const ran = yield* helper(
          op,
          input(`${asked("platform.test")}username=x\npassword=${token}\n\n`),
          env
        );

        expect(ran).toStrictEqual({ ok: true, stderr: [], stdout: "" });

        const kept = yield* Effect.provide(
          Effect.flatMap(
            Effect.service(Credentials),
            (stored) => stored.current
          ),
          credentialsIn(env)
        );

        expect(
          Option.map(kept, (profile) => Redacted.value(profile.token))
        ).toStrictEqual(Option.some(token));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "answers at the blank line without reading further, even if stdin never ends",
    () =>
      Effect.gen(function* () {
        const env = yield* storedIn({ default: platform });

        const endless = Stream.concat(
          input(asked("platform.test")),
          Stream.never
        );

        const pastTheEnd = Stream.concat(
          input(asked("platform.test")),
          Stream.die("the helper read past the blank line")
        );

        for (const stdin of [endless, pastTheEnd]) {
          const ran = yield* helper("get", stdin, env);

          expect(ran.stdout).toBe(`username=audit;\npassword=${token}\n`);
        }
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe(credentialHelper, () => {
  it.live(
    "names no harness when none runs it, and answers from the profile on the asked host",
    () =>
      Effect.gen(function* () {
        const env = yield* storedIn({
          default: {
            token: Redacted.make("other-token"),
            url: "https://x.test",
          },
          platform,
        });

        const stdout = yield* credentialHelper(
          "get",
          asked("platform.test"),
          {}
        ).pipe(Effect.provide(credentialsIn(env)));

        expect(stdout).toBe(`username=audit;\npassword=${token}\n`);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("the env the CLI sees", () => {
  it.effect(
    "reads the env in a bounded walk, even with a huge number in a name",
    () =>
      Effect.gen(function* () {
        const source = ConfigProvider.fromEnv({
          env: { AI_AGENT: "pi", RUN_0: "first", RUN_100000: "far" },
        });

        const reads = yield* Ref.make(0);

        const counted = ConfigProvider.make((at) =>
          Effect.andThen(
            Ref.update(reads, (n) => n + 1),
            source.load(at)
          )
        );

        const read = yield* currentEnv.pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, counted)
        );

        expect(read).toStrictEqual({ AI_AGENT: "pi", RUN_0: "first" });
        expect(yield* Ref.get(reads)).toBeLessThan(2000);
      })
  );
});

const Basic = /^Basic (?<encoded>\S+)$/u;

const fromBase64 = Schema.decodeOption(Schema.StringFromBase64);

// A request without credentials gets the 401 that makes git ask its helper.
const guarded = (root: string) =>
  Effect.gen(function* () {
    const spawner =
      yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();

    const seen = yield* Ref.make<readonly { user: string; password: string }[]>(
      []
    );

    const backend = httpBackend(root);

    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.toWeb(
        yield* HttpServerRequest.HttpServerRequest
      );

      const pair = Option.fromNullishOr(
        Basic.exec(request.headers.get("authorization") ?? "")?.groups?.encoded
      ).pipe(Option.flatMap(fromBase64));

      if (Option.isNone(pair)) {
        return HttpServerResponse.text("sign in", {
          headers: { "www-authenticate": 'Basic realm="test"' },
          status: 401,
        });
      }

      const colon = pair.value.indexOf(":");

      yield* Ref.update(seen, (all) => [
        ...all,
        {
          password: pair.value.slice(colon + 1),
          user: pair.value.slice(0, colon),
        },
      ]);

      return HttpServerResponse.fromWeb(
        yield* Effect.scoped(backend(request)).pipe(Effect.provide(spawner))
      );
    }).pipe(Effect.orDie);

    const server = yield* Layer.build(
      HttpServer.serve(app).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
    ).pipe(Effect.orDie);

    const { address } = Context.get(server, HttpServer.HttpServer);

    const origin =
      "port" in address
        ? `http://127.0.0.1:${address.port}`
        : yield* Effect.die("the test server listens on a socket, not a port");

    return { origin, seen: Ref.get(seen) };
  });

describe("real git with the helper", () => {
  it.live(
    "git ls-remote sends the stored token as the basic-auth password, with no token in the url",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        const work = yield* fs.makeTempDirectoryScoped();

        yield* gitOk(
          root,
          "init",
          "--quiet",
          "--bare",
          "-b",
          "main",
          "demo.git"
        );
        yield* gitOk(work, "init", "--quiet", "-b", "main");
        yield* gitOk(work, "commit", "--quiet", "--allow-empty", "-m", "first");
        yield* gitOk(
          work,
          "push",
          "--quiet",
          path.join(root, "demo.git"),
          "main"
        );

        const head = yield* gitOk(work, "rev-parse", "HEAD");
        const server = yield* guarded(root);

        const env = yield* storedIn({
          default: { token: Redacted.make(token), url: server.origin },
        });

        const bin = yield* path.fromFileUrl(
          new URL("../../src/bin.ts", import.meta.url)
        );

        const child = yield* spawn(
          "git",
          [
            "-c",
            "credential.helper=",
            "-c",
            `credential.helper=!bun '${bin}' credential`,
            "ls-remote",
            `${server.origin}/demo.git`,
          ],
          {
            cwd: work,
            env: {
              ...env,
              ...pi,
              [`${SLUG}_PROFILE`]: "",
              [`${SLUG}_TOKEN`]: "",
              [`${SLUG}_URL`]: "",
              PI_PROVIDER: "",
              PI_SESSION_ID: "",
            },
          }
        );

        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            child.stdout.pipe(Stream.decodeText(), Stream.mkString),
            child.stderr.pipe(Stream.decodeText(), Stream.mkString),
            child.exitCode,
          ],
          { concurrency: "unbounded" }
        );

        expect({ exitCode, stderr }).toStrictEqual({ exitCode: 0, stderr: "" });
        expect(stdout).toBe(`${head}\tHEAD\n${head}\trefs/heads/main\n`);
        expect(yield* server.seen).toContainEqual({
          password: token,
          user: "audit;harness=pi&model=kimi-k3",
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    30_000
  );
});
