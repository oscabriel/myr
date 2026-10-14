import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { Handle } from "@repo/protocol/ids";
import {
  Authenticated,
  CurrentPrincipal,
  Person,
  Unauthenticated,
} from "@repo/protocol/principal";
import { asPerson, unanswered } from "@repo/protocol/testing";
import { spawn } from "@repo/testkit/git";
import {
  Clock,
  ConfigProvider,
  Context,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
  Ref,
  Schema,
  Stdio,
  Stream,
  Terminal,
} from "effect";
import { CliOutput } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpServer } from "effect/http";
import { RpcTest } from "effect/rpc";
import { TestClock, TestConsole } from "effect/testing";

import { Credentials, CredentialsFile } from "../../src/credentials.ts";
import { Browser, Loopback, PlatformClient } from "../../src/local/login.ts";
import { program } from "../../src/main.ts";
import { OutputPlain } from "../../src/output.ts";
import { oauthServer } from "../oauth-server.ts";

const SLUG = Brand.slug.toUpperCase();

const url = "https://platform.test";

const given = "tok-given-0123456789abcdefghijklmnopqrstuvwxyz";

const issued = "tok-issued-0123456789abcdefghijklmnopqrstuvwxyz";

const helperLines = (at: string) => [
  `git config --global --replace-all credential.${at}.helper ""`,
  `git config --global --add credential.${at}.helper ${Brand.slug}`,
  `git config --global credential.${at}.useHttpPath true`,
];

const helperArgv = (at: string) => [
  ["git", "config", "--global", "--replace-all", `credential.${at}.helper`, ""],
  ["git", "config", "--global", "--add", `credential.${at}.helper`, Brand.slug],
  ["git", "config", "--global", `credential.${at}.useHttpPath`, "true"],
];

const home = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped();

  return { GIT_CONFIG_GLOBAL: path.join(dir, ".gitconfig"), HOME: dir };
});

const credentialsIn = (env: Record<string, string>) =>
  CredentialsFile.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))
  );

const stored = (env: Record<string, string>, name: string) =>
  Effect.provide(
    Effect.flatMap(Effect.service(Credentials), ({ current }) => current),
    credentialsIn({ ...env, [`${SLUG}_PROFILE`]: name })
  ).pipe(
    Effect.map(
      Option.map(({ handle, token, url: at }) => ({
        handle,
        token: Redacted.value(token),
        url: at,
      }))
    )
  );

const gitConfig = (env: Record<string, string>, ...args: string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawn("git", ["config", "--global", ...args], {
        env,
      });

      const [stdout, exitCode] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.exitCode,
        ],
        { concurrency: "unbounded" }
      ).pipe(Effect.orDie);

      return { exitCode, stdout };
    })
  );

const isPerson = Schema.is(Person);

const whoamiHandler = Contracts.toLayerHandler("whoami", () =>
  Effect.flatMap(Effect.service(CurrentPrincipal), (principal) =>
    isPerson(principal)
      ? Effect.succeed({ handle: principal.handle })
      : Effect.die("whoami is for people signed in")
  )
);

const refusesEveryone = Layer.succeed(Authenticated, () =>
  Effect.fail(new Unauthenticated())
);

const seams = (server: Layer.Layer<Authenticated>) =>
  Effect.gen(function* () {
    const connected = yield* Ref.make<
      readonly { token: string; url: string }[]
    >([]);

    const opened = yield* Ref.make<readonly string[]>([]);

    const listened = yield* Ref.make<
      readonly { hostname: string; port: number }[]
    >([]);

    const layer = Layer.mergeAll(
      Layer.succeed(PlatformClient, {
        connect: ({ token, url: at }) =>
          Effect.andThen(
            Ref.update(connected, (all) => [
              ...all,
              { token: Redacted.value(token), url: at },
            ]),
            RpcTest.makeClient(Contracts).pipe(
              Effect.provide(Layer.mergeAll(unanswered, whoamiHandler, server))
            )
          ),
      }),
      Layer.succeed(Browser, {
        open: (at) => Ref.update(opened, (all) => [...all, at]),
      }),
      Layer.succeed(Loopback, {
        listen: (address) =>
          Effect.gen(function* () {
            yield* Ref.update(listened, (all) => [...all, address]);

            const built = yield* Layer.build(NodeHttpServer.layerTest);

            return Context.get(built, HttpServer.HttpServer);
          }),
      })
    );

    return {
      connected: Ref.get(connected),
      layer,
      listened: Ref.get(listened),
      opened: Ref.get(opened),
    };
  });

const signedInAs = (handle: string) => asPerson(Handle.make(handle));

const testServices = Layer.mergeAll(TestConsole.layer, NodeServices.layer);

const noTerminal = Layer.succeed(
  Terminal.Terminal,
  Terminal.make({
    columns: Effect.die("login read the terminal's width"),
    display: () => Effect.die("login wrote to the terminal"),
    readInput: Effect.die("login read the terminal"),
    readLine: Effect.die("login prompted on the terminal"),
    rows: Effect.die("login read the terminal's height"),
  })
);

interface Run {
  readonly env: Record<string, string>;
  readonly seams: Layer.Layer<never>;
  readonly stdin?: string;
  readonly terminal?: boolean;
}

const cli = (argv: readonly string[], run: Run) =>
  Effect.exit(
    program(argv).pipe(
      Effect.provide(
        // The test stdio and terminal come last, so they stand in for Node's.
        Layer.mergeAll(
          Layer.mergeAll(
            CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
            Layer.mock(Client)({}),
            OutputPlain,
            credentialsIn(run.env),
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: run.env })),
            run.seams
          ).pipe(Layer.provideMerge(NodeServices.layer)),
          Stdio.layerTest({
            stdin: Stream.make(new TextEncoder().encode(run.stdin ?? "")),
            stdoutIsTerminal: Effect.succeed(run.terminal ?? false),
          }),
          noTerminal
        )
      )
    )
  );

const lines = (all: readonly unknown[]) =>
  all.flatMap((chunk) => String(chunk).split("\n"));

const printed = Effect.gen(function* () {
  return {
    stderr: lines(yield* TestConsole.errorLines),
    stdout: lines(yield* TestConsole.logLines),
  };
});

const signInUrl = (origin: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const line = (yield* printed).stderr
        .map((text) => text.trim())
        .find((text) => text.startsWith(`${origin}/authorize?`));

      if (line !== undefined) {
        return line;
      }

      yield* Effect.sleep("20 millis");
    }

    return yield* Effect.die("login printed no sign-in URL");
  });

const visit = (at: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(at);

    return response.status;
  }).pipe(Effect.provide(FetchHttpClient.layer));

const fieldsOf = (query: URLSearchParams | undefined) =>
  Object.fromEntries(query?.entries() ?? []);

describe(`${Brand.cli} login --token-stdin`, () => {
  it.live(
    "checks the token with the platform, keeps it under the profile with the handle, and points git at the helper",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(signedInAs("alice"));

        const exit = yield* cli(
          ["login", "--url", url, "--token-stdin", "--profile", "alice"],
          { env, seams: platform.layer, stdin: `${given}\n` }
        );

        expect(Exit.isSuccess(exit)).toBeTruthy();
        expect({
          checked: yield* platform.connected,
          kept: yield* stored(env, "alice"),
        }).toStrictEqual({
          checked: [{ token: given, url }],
          kept: Option.some({ handle: "alice", token: given, url }),
        });
        expect({
          helper: yield* gitConfig(
            env,
            "--get-all",
            `credential.${url}.helper`
          ),
          useHttpPath: yield* gitConfig(
            env,
            "--get",
            `credential.${url}.useHttpPath`
          ),
        }).toStrictEqual({
          helper: { exitCode: 0, stdout: `\n${Brand.slug}\n` },
          useHttpPath: { exitCode: 0, stdout: "true\n" },
        });

        const { stderr, stdout } = yield* printed;

        expect(stdout.map((line) => line.trim())).toStrictEqual(
          expect.arrayContaining(helperLines(url))
        );
        expect([...stdout, ...stderr].join("\n")).not.toContain(given);
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "prints one envelope under --json, with the git config and without the token",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(signedInAs("alice"));

        yield* cli(["login", "--url", url, "--token-stdin", "--json"], {
          env,
          seams: platform.layer,
          stdin: `${given}\n`,
        });

        const { stdout } = yield* printed;
        const text = stdout.join("\n");

        expect(text).not.toContain(given);
        expect(JSON.parse(text)).toStrictEqual({
          command: "login",
          data: {
            gitConfig: helperArgv(url),
            gitConfigSet: true,
            handle: "alice",
            profile: "default",
            url,
          },
          ok: true,
          v: 1,
        });
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "with --no-git-config, leaves git's config alone and hands back the lines to set, in --json too",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(signedInAs("alice"));

        const exit = yield* cli(
          ["login", "--url", url, "--token-stdin", "--no-git-config", "--json"],
          { env, seams: platform.layer, stdin: `${given}\n` }
        );

        expect(Exit.isSuccess(exit)).toBeTruthy();
        expect(
          (yield* gitConfig(env, "--get-all", `credential.${url}.helper`))
            .exitCode
        ).toBe(1);

        expect(JSON.parse((yield* printed).stdout.join("\n"))).toMatchObject({
          data: { gitConfig: helperArgv(url), gitConfigSet: false },
          ok: true,
        });
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "prints each git config line so a shell takes it as it was run, quotes and all",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(signedInAs("alice"));
        const odd = "https://o'brien.test";

        yield* cli(["login", "--url", odd, "--token-stdin"], {
          env,
          seams: platform.layer,
          stdin: `${given}\n`,
        });

        expect(
          (yield* printed).stdout.map((line) => line.trim())
        ).toStrictEqual(
          expect.arrayContaining([
            String.raw`git config --global --add 'credential.https://o'\''brien.test.helper' ${Brand.slug}`,
          ])
        );
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "keeps nothing, and leaves git alone, when the platform refuses the token",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(refusesEveryone);

        const exit = yield* cli(["login", "--url", url, "--token-stdin"], {
          env,
          seams: platform.layer,
          stdin: `${given}\n`,
        });

        expect(Exit.isFailure(exit)).toBeTruthy();
        expect(yield* stored(env, "default")).toStrictEqual(Option.none());
        expect(
          (yield* gitConfig(env, "--get-all", `credential.${url}.helper`))
            .exitCode
        ).toBe(1);

        const { stderr, stdout } = yield* printed;

        expect(stderr.join("\n")).toContain(url);
        expect([...stdout, ...stderr].join("\n")).not.toContain(given);
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "never sends a token over plain http to a host that is not this machine",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(signedInAs("alice"));

        const exit = yield* cli(
          ["login", "--url", "http://platform.test", "--token-stdin"],
          { env, seams: platform.layer, stdin: `${given}\n` }
        );

        expect(Exit.isFailure(exit)).toBeTruthy();
        expect(yield* platform.connected).toStrictEqual([]);
        expect((yield* printed).stderr.join("\n")).toContain("https://");
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "without --url, logs the current profile in again on its platform, but asks for --url for another profile",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(signedInAs("alice"));
        const run = { env, seams: platform.layer, stdin: `${given}\n` };

        yield* cli(["login", "--url", url, "--token-stdin"], run);

        const again = yield* cli(["login", "--token-stdin"], run);

        const other = yield* cli(
          ["login", "--token-stdin", "--profile", "bob"],
          run
        );

        expect({
          again: Exit.isSuccess(again),
          bob: yield* stored(env, "bob"),
          checked: (yield* platform.connected).map(({ url: at }) => at),
          other: Exit.isSuccess(other),
        }).toStrictEqual({
          again: true,
          bob: Option.none(),
          checked: [url, url],
          other: false,
        });
        expect((yield* printed).stderr.join("\n")).toContain("--url");
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "with no --url and no stored profile, asks for --url",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(signedInAs("alice"));

        const exit = yield* cli(["login", "--token-stdin"], {
          env,
          seams: platform.layer,
          stdin: `${given}\n`,
        });

        expect(Exit.isFailure(exit)).toBeTruthy();
        expect((yield* printed).stderr.join("\n")).toContain("--url");
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );
});

describe(`${Brand.cli} login in the browser (PKCE)`, () => {
  it.live(
    "with --no-browser, prints the sign-in URL; following it signs in and keeps the platform's token",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const server = yield* oauthServer({ token: issued });
        const platform = yield* seams(signedInAs("alice"));

        const fiber = yield* Effect.forkChild(
          cli(
            [
              "login",
              "--url",
              server.origin,
              "--no-browser",
              "--profile",
              "alice",
            ],
            { env, seams: platform.layer }
          )
        );

        expect(yield* visit(yield* signInUrl(server.origin))).toBe(200);
        expect(Exit.isSuccess(yield* Fiber.join(fiber))).toBeTruthy();

        const [query] = yield* server.authorizations;
        const fields = fieldsOf(query);
        const urlSafe43 = /^[A-Za-z0-9_-]{43}$/u;

        expect({
          asked: {
            challenge: urlSafe43.test(fields.code_challenge ?? ""),
            clientId: fields.client_id,
            method: fields.code_challenge_method,
            names: Object.keys(fields).toSorted(),
            redirect: /^http:\/\/127\.0\.0\.1:\d+\/callback$/u.test(
              fields.redirect_uri ?? ""
            ),
            responseType: fields.response_type,
            state: urlSafe43.test(fields.state ?? ""),
          },
          checked: yield* platform.connected,
          kept: yield* stored(env, "alice"),
          listened: yield* platform.listened,
          opened: yield* platform.opened,
        }).toStrictEqual({
          asked: {
            challenge: true,
            clientId: `${server.origin}/oauth/cli`,
            method: "S256",
            names: [
              "client_id",
              "code_challenge",
              "code_challenge_method",
              "redirect_uri",
              "response_type",
              "state",
            ],
            redirect: true,
            responseType: "code",
            state: true,
          },
          checked: [{ token: issued, url: server.origin }],
          kept: Option.some({
            handle: "alice",
            token: issued,
            url: server.origin,
          }),
          listened: [{ hostname: "127.0.0.1", port: 0 }],
          opened: [],
        });

        // The loopback server took its one callback and closed.
        const again = yield* Effect.exit(
          visit(`${fields.redirect_uri}?code=code-1&state=${fields.state}`)
        );

        const { stderr, stdout } = yield* printed;

        expect({
          closed: Exit.isFailure(again),
          leaked: [...stdout, ...stderr].join("\n").includes(issued),
        }).toStrictEqual({ closed: true, leaked: false });
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "refuses a sign-in that comes back with another state, and keeps nothing",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const server = yield* oauthServer({ state: "other", token: issued });
        const platform = yield* seams(signedInAs("alice"));

        const fiber = yield* Effect.forkChild(
          cli(["login", "--url", server.origin, "--no-browser"], {
            env,
            seams: platform.layer,
          })
        );

        yield* visit(yield* signInUrl(server.origin));

        expect(Exit.isFailure(yield* Fiber.join(fiber))).toBeTruthy();
        expect((yield* printed).stderr.join("\n")).toContain("state");
        expect(yield* platform.connected).toStrictEqual([]);
        expect(yield* stored(env, "default")).toStrictEqual(Option.none());
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "at a person's terminal, opens the browser on the sign-in URL",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const server = yield* oauthServer({ token: issued });
        const platform = yield* seams(signedInAs("alice"));

        const fiber = yield* Effect.forkChild(
          cli(["login", "--url", server.origin], {
            env,
            seams: platform.layer,
            terminal: true,
          })
        );

        const shown = yield* signInUrl(server.origin);

        expect(yield* visit(shown)).toBe(200);
        expect(Exit.isSuccess(yield* Fiber.join(fiber))).toBeTruthy();
        expect(yield* platform.opened).toStrictEqual([shown]);
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "under an agent, prints the URL for a person instead of opening a browser, and never prompts",
    () =>
      Effect.gen(function* () {
        const env = { ...(yield* home), CLAUDECODE: "1" };
        const server = yield* oauthServer({ token: issued });
        const platform = yield* seams(signedInAs("alice"));

        const fiber = yield* Effect.forkChild(
          cli(["login", "--url", server.origin], {
            env,
            seams: platform.layer,
            terminal: true,
          })
        );

        expect(yield* visit(yield* signInUrl(server.origin))).toBe(200);
        expect(Exit.isSuccess(yield* Fiber.join(fiber))).toBeTruthy();
        expect(yield* platform.opened).toStrictEqual([]);
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "stops waiting after 5 minutes, says how to sign in instead, and closes the loopback server",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const server = yield* oauthServer({ token: issued });
        const platform = yield* seams(signedInAs("alice"));
        const clock = yield* TestClock.make();

        const fiber = yield* Effect.forkChild(
          cli(["login", "--url", server.origin, "--no-browser"], {
            env,
            seams: platform.layer,
          }).pipe(Effect.provideService(Clock.Clock, clock))
        );

        const shown = yield* signInUrl(server.origin);

        yield* clock.adjust("5 minutes");

        expect(Exit.isFailure(yield* Fiber.join(fiber))).toBeTruthy();

        const said = (yield* printed).stderr.join("\n");

        expect(said).toContain("5 minutes");
        expect(said).toContain("--token-stdin");
        expect(yield* stored(env, "default")).toStrictEqual(Option.none());

        const callback = new URL(shown).searchParams.get("redirect_uri") ?? "";

        expect(
          Exit.isFailure(
            yield* Effect.exit(visit(`${callback}?code=x&state=y`))
          )
        ).toBeTruthy();
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );
});

describe(`${Brand.cli} logout`, () => {
  it.live(
    "removes the profile and the git config that names the helper for its platform",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(signedInAs("alice"));
        const run = { env, seams: platform.layer, stdin: `${given}\n` };

        yield* cli(
          ["login", "--url", url, "--token-stdin", "--profile", "alice"],
          run
        );

        const exit = yield* cli(["logout", "--profile", "alice"], run);

        expect(Exit.isSuccess(exit)).toBeTruthy();
        expect(yield* stored(env, "alice")).toStrictEqual(Option.none());
        expect(
          (yield* gitConfig(env, "--get-all", `credential.${url}.helper`))
            .exitCode
        ).toBe(1);
        expect(
          (yield* gitConfig(env, "--get", `credential.${url}.useHttpPath`))
            .exitCode
        ).toBe(1);
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "removes useHttpPath even when git's config holds it twice",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(signedInAs("alice"));
        const run = { env, seams: platform.layer, stdin: `${given}\n` };

        yield* cli(["login", "--url", url, "--token-stdin"], run);
        yield* gitConfig(env, "--add", `credential.${url}.useHttpPath`, "true");

        const exit = yield* cli(["logout"], run);

        expect(Exit.isSuccess(exit)).toBeTruthy();
        expect(
          (yield* gitConfig(env, "--get-all", `credential.${url}.useHttpPath`))
            .exitCode
        ).toBe(1);
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );

  it.live(
    "keeps git asking the helper while another profile is on the same platform",
    () =>
      Effect.gen(function* () {
        const env = yield* home;
        const platform = yield* seams(signedInAs("alice"));
        const run = { env, seams: platform.layer, stdin: `${given}\n` };

        for (const name of ["alice", "bob"]) {
          yield* cli(
            ["login", "--url", url, "--token-stdin", "--profile", name],
            run
          );
        }

        yield* cli(["logout", "--profile", "alice"], run);

        expect(
          yield* gitConfig(env, "--get-all", `credential.${url}.helper`)
        ).toStrictEqual({ exitCode: 0, stdout: `\n${Brand.slug}\n` });
        expect(Option.isSome(yield* stored(env, "bob"))).toBeTruthy();

        yield* cli(["logout", "--profile", "bob"], run);

        expect(
          (yield* gitConfig(env, "--get-all", `credential.${url}.helper`))
            .exitCode
        ).toBe(1);
      }).pipe(Effect.scoped, Effect.provide(testServices)),
    30_000
  );
});
