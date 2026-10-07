/**
 * git's credential helper: `git-credential-<slug>`, which `login` names in
 * git's config for the platform's url (`gitHelperConfig`). git asks it for a
 * password after a 401 that names Basic; it answers from the stored profile
 * for that host, and never prompts, opens a terminal, or reads past the
 * blank line that ends git's request.
 *
 * The username it hands back carries the harness behind the push as audit
 * metadata (`@repo/protocol/audit`), never identity: the token in the
 * password slot is the only identity the platform reads.
 */
import { Brand } from "@repo/brand";
import { auditUser, detectHarness } from "@repo/protocol/audit";
import {
  ConfigProvider,
  Effect,
  Match,
  Option,
  Redacted,
  Stdio,
  Stream,
} from "effect";
import { Argument, Command } from "effect/cli";

import { Credentials } from "./credentials.ts";
import { Output } from "./output.ts";

/** What git asks a helper to do. */
export type Operation = "get" | "store" | "erase";

const operations = [
  "get",
  "store",
  "erase",
] as const satisfies readonly Operation[];

/** The env, by name: what `detectHarness` reads. */
export type Env = Readonly<Record<string, string | undefined>>;

/** The env-name parts below `path` and their values, from the CLI's config provider. */
const namesBelow = (
  provider: ConfigProvider.ConfigProvider,
  path: ConfigProvider.Path
): Effect.Effect<readonly (readonly [string, string])[]> =>
  provider.load(path).pipe(
    Effect.map(Option.fromNullishOr),
    Effect.orElseSucceed(() => Option.none<ConfigProvider.Node>()),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed([]),
        onSome: (node) => {
          const own =
            path.length > 0 && node.value !== undefined
              ? [[path.join("_"), node.value] as const]
              : [];

          const children = Match.valueTags(node, {
            Array: ({ length }) =>
              Array.from({ length }, (_, at) => String(at)),
            Record: ({ keys }) => [...keys],
            Value: () => [],
          });

          return Effect.map(
            Effect.forEach(children, (child) =>
              namesBelow(provider, [...path, child])
            ),
            (nested) => [...own, ...nested.flat()]
          );
        },
      })
    )
  );

/**
 * The env as the CLI sees it, every name with its value: read through the
 * config provider (the process env when nothing else is given), so a test's
 * env is the one a command sees and passes on.
 */
export const currentEnv: Effect.Effect<Readonly<Record<string, string>>> =
  Effect.gen(function* () {
    const provider = yield* ConfigProvider.ConfigProvider;

    return Object.fromEntries(yield* namesBelow(provider, []));
  });

/** git's request: its `key=value` lines, up to the blank line that ends it. */
const requestOf = (input: string) => {
  const fields = new Map<string, string>();

  for (const line of input.split("\n")) {
    if (line === "") {
      break;
    }

    const equals = line.indexOf("=");

    if (equals > 0) {
      fields.set(line.slice(0, equals), line.slice(equals + 1));
    }
  }

  return fields;
};

/** `url`'s scheme without its colon, if it is a URL. */
const schemeOf = Option.liftThrowable((url: string) =>
  new URL(url).protocol.replace(/:$/u, "")
);

/** A value git's credential protocol can carry: one line, no NUL. */
const fitsOneLine = (value: string) => !/[\n\r\0]/u.test(value);

/** What the helper prints: for git on stdout, and maybe a line for a person on stderr. */
interface Answer {
  readonly stdout: string;
  readonly note: Option.Option<string>;
}

const silent: Answer = { note: Option.none(), stdout: "" };

/**
 * The helper's answer to `op` with git's `input`. `get` answers only for a
 * host a profile is on, over that profile's scheme; with no login at all it
 * also says, once, how to log in. `store` and `erase` do nothing: the stored
 * token changes only through `login` and `logout`.
 */
const answer = (op: Operation, input: string, env: Env) =>
  Effect.gen(function* () {
    if (op !== "get") {
      return silent;
    }

    const request = requestOf(input);
    const host = request.get("host");
    const protocol = request.get("protocol");

    if (host === undefined || protocol === undefined) {
      return silent;
    }

    const credentials = yield* Credentials;

    const profile = Option.filter(
      yield* credentials.forHost(host),
      ({ token, url }) =>
        Option.contains(schemeOf(url), protocol) &&
        fitsOneLine(Redacted.value(token))
    );

    if (Option.isSome(profile)) {
      return {
        note: Option.none(),
        stdout: `username=${auditUser(detectHarness(env))}\npassword=${Redacted.value(profile.value.token)}\n`,
      } satisfies Answer;
    }

    return Option.isNone(yield* credentials.current)
      ? {
          note: Option.some(
            `no ${Brand.cli} login for ${host}: run ${Brand.cli} login --url ${protocol}://${host}`
          ),
          stdout: "",
        }
      : silent;
  });

/**
 * What the helper prints on stdout for `op`, given git's `input` and the
 * env it runs in: `username=<audit>\npassword=<token>\n`, or nothing.
 */
export const credentialHelper = (
  op: Operation,
  input: string,
  env: Env
): Effect.Effect<string, never, Credentials> =>
  Effect.map(answer(op, input, env), ({ stdout }) => stdout);

/**
 * git's request from stdin: the lines up to the first blank one, read no
 * further, or up to the end if git closes stdin first.
 */
const readRequest = Effect.gen(function* () {
  const { stdin } = yield* Stdio.Stdio;

  const lines = yield* stdin.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.takeWhile((line) => line !== ""),
    Stream.runCollect,
    Effect.orElseSucceed((): readonly string[] => [])
  );

  return `${lines.join("\n")}\n\n`;
});

/** `<cli> credential <get|store|erase>`: what `git-credential-<slug>` runs. */
export const credential = Command.make(
  "credential",
  {
    operation: Argument.Literals("operation", operations).pipe(
      Argument.withDescription("What git asks: get, store or erase")
    ),
  },
  ({ operation }) =>
    Effect.gen(function* () {
      const stdio = yield* Stdio.Stdio;
      const output = yield* Output;
      const request = yield* readRequest;
      const given = yield* answer(operation, request, yield* currentEnv);

      if (given.stdout !== "") {
        yield* Stream.make(given.stdout).pipe(
          Stream.run(stdio.stdout()),
          Effect.orDie
        );
      }

      yield* Option.match(given.note, {
        onNone: () => Effect.void,
        onSome: output.note,
      });
    })
).pipe(
  Command.withDescription(
    "Be git's credential helper: hand git the stored token for a platform."
  )
);
