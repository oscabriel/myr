/**
 * `login` and `logout`. A person logs in once, through the browser (PKCE
 * against the platform's own OAuth server, W3 316) or with a token piped to
 * `--token-stdin`; the CLI checks the token with the platform, keeps it as
 * a profile (`Credentials`), and names `git-credential-<slug>` in git's
 * global config for the platform's url, so plain `git clone`, `fetch` and
 * `push` work with no token in a url and no prompt. Profiles let one
 * machine act for several people (`<SLUG>_PROFILE=<name>`).
 *
 * The token stays `Redacted` from stdin or `/token` to the credentials
 * file; it is written out only in the `Authorization` header that checks
 * it, and later in the helper's `password=` line.
 */
import { BunHttpServer } from "@effect/platform-bun";
import { Brand } from "@repo/brand";
import { detectHarness } from "@repo/protocol/audit";
import { Contracts } from "@repo/protocol/contracts";
import type { Client } from "@repo/protocol/contracts";
import {
  Deferred,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
  Stdio,
  Stream,
} from "effect";
import type { Scope } from "effect";
import { Command, Flag } from "effect/cli";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import type { HttpServer, HttpServerError } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { currentEnv } from "../credential-helper.ts";
import { Credentials, gitHelperConfig } from "../credentials.ts";
import type { Profile } from "../credentials.ts";
import { Output } from "../output.ts";

/** The env names the CLI reads, spelled from the brand: `<SLUG>_URL`. */
const SLUG = Brand.slug.toUpperCase();

/** The address the loopback server binds: this machine only. */
const LOOPBACK = "127.0.0.1";

/** How long `login` waits for the browser to come back. */
const SIGN_IN_WAIT = "5 minutes";

/**
 * The CLI's OAuth client id on a platform: the URL of the Client ID
 * Metadata Document the platform serves for it (W3 316,
 * `apps/platform/src/auth/cli-client.ts`). It asks for no scope.
 */
const clientIdOf = (origin: string) => `${origin}/oauth/cli`;

// --- The host seams: each has a default the binary runs on, and tests swap it.

/**
 * Where `login` hears the browser come back: an HTTP server on one address,
 * for one scope. The binary listens with Bun.
 */
export const Loopback = Context.Reference<{
  readonly listen: (address: {
    readonly hostname: string;
    readonly port: number;
  }) => Effect.Effect<
    HttpServer.HttpServer["Service"],
    HttpServerError.ServeError,
    Scope.Scope
  >;
}>("cli/login/Loopback", {
  defaultValue: () => ({
    listen: ({ hostname, port }) => BunHttpServer.make({ hostname, port }),
  }),
});

/**
 * A client of the platform at `url` that presents `token` as its bearer:
 * what `login` checks a token with before it keeps it. The binary's calls
 * go over HTTP to `<url>/rpc`.
 */
export const PlatformClient = Context.Reference<{
  readonly connect: (profile: {
    readonly token: Redacted.Redacted;
    readonly url: string;
  }) => Effect.Effect<Client["Service"], never, Scope.Scope>;
}>("cli/login/PlatformClient", {
  defaultValue: () => ({
    connect: ({ token, url }) =>
      RpcClient.make(Contracts).pipe(
        Effect.provide(
          RpcClient.layerProtocolHttp({
            transformClient: HttpClient.mapRequest(
              HttpClientRequest.bearerToken(token)
            ),
            url: `${url}/rpc`,
          }).pipe(
            Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson])
          )
        )
      ),
  }),
});

/** Opens `url` with the first of `commands` that runs; none running is fine. */
const openWith = (url: string, commands: readonly string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    for (const command of commands) {
      const code = yield* spawner
        .exitCode(
          ChildProcess.make(command, [url], {
            stderr: "ignore",
            stdin: "ignore",
            stdout: "ignore",
          })
        )
        .pipe(Effect.timeout("10 seconds"), Effect.option);

      if (Option.exists(code, (exit) => exit === 0)) {
        return;
      }
    }
  });

/**
 * The person's browser. The binary asks the desktop's opener (`xdg-open`,
 * else macOS's `open`); the URL is printed either way.
 */
export const Browser = Context.Reference<{
  readonly open: (
    url: string
  ) => Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner>;
}>("cli/login/Browser", {
  defaultValue: () => ({
    open: (url) => openWith(url, ["xdg-open", "open"]),
  }),
});

// --- Failures.

/** `login` was run in a way that cannot work; the message says what to run. */
export class LoginUsage extends Schema.TaggedError<LoginUsage>()("LoginUsage", {
  reason: Schema.String,
}) {
  override get message() {
    return this.reason;
  }
}

/** The platform, or the sign-in, said no; nothing was stored. */
export class LoginRefused extends Schema.TaggedError<LoginRefused>()(
  "LoginRefused",
  { reason: Schema.String }
) {
  override get message() {
    return this.reason;
  }
}

/** git would not take a config line; the message names it, to run by hand. */
export class GitConfigFailed extends Schema.TaggedError<GitConfigFailed>()(
  "GitConfigFailed",
  { command: Schema.String }
) {
  override get message() {
    return `git did not take this; run it yourself: ${this.command}`;
  }
}

// --- Shared parts.

const flags = {
  json: Flag.Boolean("json").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Print machine-readable JSON")
  ),
  profile: Flag.String("profile").pipe(
    Flag.withDescription(
      `The profile to use (default: $${SLUG}_PROFILE, else "default")`
    ),
    Flag.optional
  ),
};

/** The profile a command acts on: the flag, else `<SLUG>_PROFILE`, else `default`. */
const profileName = (
  flag: Option.Option<string>,
  env: Readonly<Record<string, string>>
) => Option.getOrElse(flag, () => env[`${SLUG}_PROFILE`] ?? "default");

/** An argv list as a person would type it in a shell. */
const typed = (argv: readonly string[]) =>
  argv
    .map((arg) => {
      if (arg === "") {
        return '""';
      }

      return /^[\w./:@=-]+$/u.test(arg)
        ? arg
        : `'${arg.replaceAll("'", String.raw`'\''`)}'`;
    })
    .join(" ");

/** Runs one `git config` argv list; `allowed` are the exit codes that mean done. */
const runGit = (
  argv: readonly string[],
  env: Readonly<Record<string, string>>,
  allowed: readonly number[] = [0]
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const [command = "git", ...args] = argv;

    const code = yield* spawner
      .exitCode(
        ChildProcess.make(command, args, {
          env,
          extendEnv: true,
          stderr: "ignore",
          stdin: "ignore",
          stdout: "ignore",
        })
      )
      .pipe(Effect.option);

    return Option.exists(code, (exit) => allowed.includes(exit))
      ? undefined
      : yield* new GitConfigFailed({ command: typed(argv) });
  });

const asUrl = Option.liftThrowable((text: string) => new URL(text));

/** Hosts that are this machine, where plain http keeps a token local. */
const THIS_MACHINE = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `given`'s origin, if it is a platform url: https, or http on this machine. */
const originOf = (given: string) =>
  Option.match(
    Option.filter(
      asUrl(given),
      ({ hostname, protocol }) =>
        protocol === "https:" ||
        (protocol === "http:" && THIS_MACHINE.has(hostname))
    ),
    {
      onNone: () =>
        Effect.fail(
          new LoginUsage({
            reason: `${given} is not a platform url: use https://<host> (plain http only for this machine)`,
          })
        ),
      onSome: ({ origin }) => Effect.succeed(origin),
    }
  );

/**
 * The platform to log in to: `--url`, else `<SLUG>_URL`, else the profile's
 * own. `Credentials` reads back only the current profile, so another
 * profile named by `--profile` needs `--url`: it is never logged in to the
 * current profile's platform by default.
 */
const platformOf = (
  flag: Option.Option<string>,
  profile: Option.Option<string>,
  env: Readonly<Record<string, string>>
) =>
  Effect.gen(function* () {
    const named = Option.orElse(flag, () =>
      Option.fromNullishOr(env[`${SLUG}_URL`])
    );

    if (Option.isSome(named)) {
      return yield* originOf(named.value);
    }

    const name = profileName(profile, env);

    const current =
      name === profileName(Option.none(), env)
        ? yield* (yield* Credentials).current
        : Option.none<Profile>();

    if (Option.isSome(current)) {
      return yield* originOf(current.value.url);
    }

    return yield* new LoginUsage({
      reason: `no platform to log in to for profile ${name}: run ${Brand.cli} login --url https://<platform host>${Option.isSome(profile) ? ` --profile ${name}` : ""}`,
    });
  });

// --- The token, by one of two ways.

/** The token piped to `--token-stdin`: its first line, read no further. */
const tokenFromStdin = Effect.gen(function* () {
  const { stdin } = yield* Stdio.Stdio;

  const [line = ""] = yield* stdin.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.take(1),
    Stream.runCollect,
    Effect.orElseSucceed((): readonly string[] => [])
  );

  const token = line.trim();

  if (token === "") {
    return yield* new LoginUsage({
      reason: `--token-stdin read no token: pipe it in, one line, e.g. ${Brand.cli} login --token-stdin < token.txt`,
    });
  }

  return Redacted.make(token);
});

const encodeBase64Url = Schema.encodeEffect(Schema.Uint8ArrayFromBase64Url);

/** `size` bytes from WebCrypto's `getRandomValues`, in base64url. */
const randomText = (size: number) =>
  Effect.sync(() => crypto.getRandomValues(new Uint8Array(size))).pipe(
    Effect.flatMap(encodeBase64Url),
    Effect.orDie
  );

/** The S256 code challenge for `verifier`: `BASE64URL(SHA256(verifier))`. */
const challengeOf = (verifier: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  ).pipe(
    Effect.flatMap((digest) => encodeBase64Url(new Uint8Array(digest))),
    Effect.orDie
  );

/**
 * A server on 127.0.0.1 at a port the system picks, for this scope, that
 * takes the browser's one return to `/callback`: its `redirect_uri`, and
 * the query the browser brought back.
 */
const loopback = Effect.gen(function* () {
  const { listen } = yield* Loopback;
  const server = yield* listen({ hostname: LOOPBACK, port: 0 });
  const returned = yield* Deferred.make<URLSearchParams>();

  yield* server.serve(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const at = new URL(request.url, `http://${LOOPBACK}`);

      if (request.method !== "GET" || at.pathname !== "/callback") {
        return HttpServerResponse.text("Not found.", { status: 404 });
      }

      const first = yield* Deferred.succeed(returned, at.searchParams);

      return HttpServerResponse.text(
        first
          ? `${Brand.cli} login has the sign-in. You can close this tab; the terminal says how it ended.`
          : "This sign-in has already come back.",
        {
          // One request per connection, so closing the server waits on none.
          headers: { "cache-control": "no-store", connection: "close" },
          status: first ? 200 : 410,
        }
      );
    })
  );

  if (!("port" in server.address)) {
    return yield* Effect.die("the loopback server listens on a socket");
  }

  return {
    redirectUri: `http://${LOOPBACK}:${server.address.port}/callback`,
    returned: Deferred.await(returned),
  };
});

/** What `/token` answers a good code with. */
const TokenResponse = Schema.Struct({
  access_token: Schema.RedactedFromValue(Schema.NonEmptyString),
  token_type: Schema.String,
});

const decodeTokenResponse = Schema.decodeUnknownEffect(TokenResponse);

/** Trades the code for an access token at `<url>/token`, showing the verifier. */
const exchange = (input: {
  readonly code: string;
  readonly redirectUri: string;
  readonly url: string;
  readonly verifier: string;
}) => {
  const refused = new LoginRefused({
    reason: `${input.url}/token would not trade the sign-in for a token: run ${Brand.cli} login again`,
  });

  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.execute(
      HttpClientRequest.post(`${input.url}/token`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyUrlParams({
          client_id: clientIdOf(input.url),
          code: input.code,
          code_verifier: input.verifier,
          grant_type: "authorization_code",
          redirect_uri: input.redirectUri,
        })
      )
    );

    if (response.status !== 200) {
      return yield* refused;
    }

    const body = yield* decodeTokenResponse(yield* response.json);

    if (body.token_type.toLowerCase() !== "bearer") {
      return yield* refused;
    }

    return body.access_token;
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError(() => refused)
  );
};

/**
 * The token from a browser sign-in: PKCE (S256) against the platform's
 * `/authorize`, its code at the loopback server, then `/token`. The URL is
 * always printed; the browser opens only when `opens`. Waits at most five
 * minutes for the browser, then stops with a usage error.
 */
const tokenFromBrowser = (url: string, opens: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      const output = yield* Output;
      const verifier = yield* randomText(32);
      const state = yield* randomText(32);
      const { redirectUri, returned } = yield* loopback;

      const authorize = new URL("/authorize", url);

      authorize.search = new URLSearchParams({
        client_id: clientIdOf(url),
        code_challenge: yield* challengeOf(verifier),
        code_challenge_method: "S256",
        redirect_uri: redirectUri,
        response_type: "code",
        state,
      }).toString();

      const query = yield* Effect.gen(function* () {
        yield* output.note(
          opens
            ? `Opening a browser to sign in to ${url}. If it does not open, visit:\n  ${authorize.href}`
            : `To sign in to ${url}, open this in a browser:\n  ${authorize.href}`
        );

        if (opens) {
          yield* (yield* Browser).open(authorize.href);
        }

        return yield* returned;
      }).pipe(
        Effect.timeoutOrElse({
          duration: SIGN_IN_WAIT,
          orElse: () =>
            Effect.fail(
              new LoginUsage({
                reason: `no sign-in came back within ${SIGN_IN_WAIT}: run ${Brand.cli} login again, or pipe a token to ${Brand.cli} login --token-stdin`,
              })
            ),
        })
      );

      if (query.get("state") !== state) {
        return yield* new LoginRefused({
          reason: `the sign-in came back with another state, so it may not be yours; nothing was stored: run ${Brand.cli} login again`,
        });
      }

      const code = query.get("code");

      if (code === null || code === "") {
        return yield* new LoginRefused({
          reason: `${url} did not sign you in (${query.get("error") ?? "no code"}): run ${Brand.cli} login again`,
        });
      }

      return yield* exchange({ code, redirectUri, url, verifier });
    })
  );

/** Asks the platform at `url` who `token` is; a refusal or no answer stores nothing. */
const verify = (url: string, token: Redacted.Redacted) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* (yield* PlatformClient).connect({ token, url });

      return (yield* client.status({})).handle;
    })
  ).pipe(
    Effect.mapError(
      () =>
        new LoginRefused({
          reason: `${url} did not take this token, or could not be reached; nothing was stored`,
        })
    )
  );

/** Whether `login` may open a browser: only for a person at a terminal. */
const mayOpenBrowser = (env: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const { mode } = yield* Output;
    const { stdoutIsTerminal } = yield* Stdio.Stdio;

    return (
      mode === "human" &&
      detectHarness(env).harness === undefined &&
      env.CI === undefined &&
      (yield* stdoutIsTerminal)
    );
  });

/** The lines of a view: a sentence, then each command on its own line. */
const viewOf = (said: string, commands: readonly (readonly string[])[]) => {
  const lines = commands.map((argv) => typed(argv));

  return {
    markdown:
      lines.length === 0
        ? said
        : `${said}\n\n\`\`\`sh\n${lines.join("\n")}\n\`\`\``,
    text: [said, ...lines.map((line) => `  ${line}`)].join("\n"),
  };
};

export const login = Command.make(
  "login",
  {
    ...flags,
    noBrowser: Flag.Boolean("no-browser").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print the sign-in URL instead of opening a browser")
    ),
    noGitConfig: Flag.Boolean("no-git-config").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Leave git's config alone; print the lines to set instead"
      )
    ),
    tokenStdin: Flag.Boolean("token-stdin").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Read a token you were given from stdin, one line, instead of signing in"
      )
    ),
    url: Flag.String("url").pipe(
      Flag.withDescription(
        `The platform's origin, e.g. https://<host> (default: $${SLUG}_URL, else the profile's)`
      ),
      Flag.optional
    ),
  },
  (given) =>
    Effect.gen(function* () {
      const output = yield* Output;
      const credentials = yield* Credentials;
      const env = yield* currentEnv;
      const name = profileName(given.profile, env);
      const url = yield* platformOf(given.url, given.profile, env);

      const token = given.tokenStdin
        ? yield* tokenFromStdin
        : yield* tokenFromBrowser(
            url,
            !given.noBrowser && (yield* mayOpenBrowser(env))
          );

      const handle = yield* verify(url, token);

      yield* credentials.put(name, { handle, token, url });

      const commands = gitHelperConfig(url);

      if (!given.noGitConfig) {
        for (const argv of commands) {
          yield* runGit(argv, env);
        }
      }

      yield* output.success({
        command: "login",
        data: {
          // The lines, set or not: under --no-git-config they are what to run.
          gitConfig: commands,
          gitConfigSet: !given.noGitConfig,
          handle,
          profile: name,
          url,
        },
        json: given.json,
        view: viewOf(
          given.noGitConfig
            ? `Logged in to ${url} as ${handle} (profile ${name}). git's config is unchanged; for git to use this login, run:`
            : `Logged in to ${url} as ${handle} (profile ${name}). git now asks ${Brand.cli} for this platform's token; its global config got:`,
          commands
        ),
      });
    })
).pipe(
  Command.withDescription(
    "Sign in to a platform; git and this CLI then use its token."
  )
);

/** The `git config --global` lines that undo `gitHelperConfig(url)`; exit 5 means already gone. */
const gitHelperUnset = (url: string): readonly (readonly string[])[] => [
  ["git", "config", "--global", "--unset-all", `credential.${url}.helper`],
  ["git", "config", "--global", "--unset-all", `credential.${url}.useHttpPath`],
];

const HELPER_KEY = /^credential\.(?<url>.+)\.helper$/u;

/** The urls whose git config names this CLI's helper. */
const helperUrls = (env: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const lines = yield* spawner
      .lines(
        ChildProcess.make(
          "git",
          [
            "config",
            "--global",
            "--get-regexp",
            String.raw`^credential\..*\.helper$`,
          ],
          { env, extendEnv: true, stderr: "ignore", stdin: "ignore" }
        )
      )
      .pipe(Effect.orElseSucceed((): readonly string[] => []));

    const urls = lines.flatMap((line) => {
      const space = line.indexOf(" ");
      const key = space === -1 ? line : line.slice(0, space);
      const value = space === -1 ? "" : line.slice(space + 1);
      const url = HELPER_KEY.exec(key)?.groups?.url;

      return value === Brand.slug && url !== undefined ? [url] : [];
    });

    return [...new Set(urls)];
  });

export const logout = Command.make("logout", flags, (given) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const credentials = yield* Credentials;
    const env = yield* currentEnv;
    const name = profileName(given.profile, env);
    const removed = yield* credentials.remove(name);

    // git keeps asking the helper for a platform another profile is still on.
    const unused: string[] = [];

    for (const url of yield* helperUrls(env)) {
      const host = Option.map(asUrl(url), ({ host: at }) => at);

      if (
        Option.isSome(host) &&
        Option.isNone(yield* credentials.forHost(host.value))
      ) {
        unused.push(url);
      }
    }

    const commands = unused.flatMap(gitHelperUnset);

    for (const argv of commands) {
      yield* runGit(argv, env, [0, 5]);
    }

    yield* output.success({
      command: "logout",
      data: { gitConfig: commands, profile: name, removed },
      json: given.json,
      view: viewOf(
        `${removed ? `Logged out: profile ${name} removed.` : `No profile ${name} to remove.`}${
          commands.length === 0
            ? ""
            : ` git no longer asks ${Brand.cli} for ${unused.join(", ")}; its global config lost:`
        }`,
        commands
      ),
    });
  })
).pipe(
  Command.withDescription(
    "Forget a profile's token, and stop git asking for a platform no profile is on."
  )
);
