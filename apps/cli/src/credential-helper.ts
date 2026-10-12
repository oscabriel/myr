// The username carries the harness as audit metadata, never identity: the token is the only identity the platform reads.
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

export type Operation = "get" | "store" | "erase";

const operations = [
  "get",
  "store",
  "erase",
] as const satisfies readonly Operation[];

export type Env = Readonly<Record<string, string | undefined>>;

/** The config provider reports only an all-numeric level's largest index, so a name like `RUN_4294967294` would make the walk count to four billion. */
const INDEX_LIMIT = 1024;

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
              Array.from({ length: Math.min(length, INDEX_LIMIT) }, (_, at) =>
                String(at)
              ),
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

export const currentEnv: Effect.Effect<Readonly<Record<string, string>>> =
  Effect.gen(function* () {
    const provider = yield* ConfigProvider.ConfigProvider;

    return Object.fromEntries(yield* namesBelow(provider, []));
  });

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

const SLUG = Brand.slug.toUpperCase();

const placeOf = Option.liftThrowable((url: string) => {
  const { host, protocol } = new URL(url);

  return { host: host.toLowerCase(), scheme: protocol.replace(/:$/u, "") };
});

const fitsOneLine = (value: string) => !/[\n\r\0]/u.test(value);

interface Answer {
  readonly stdout: string;
  readonly note: Option.Option<string>;
}

const silent: Answer = { note: Option.none(), stdout: "" };

/** Under `<SLUG>_PROFILE` only that profile may answer, so another person's token for the same host is never handed over. */
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

    const named = Option.filter(
      Option.fromNullishOr(env[`${SLUG}_PROFILE`]),
      (name) => name !== ""
    );

    const candidate = Option.isSome(named)
      ? yield* credentials.current
      : yield* credentials.forHost(host);

    const profile = Option.filter(
      candidate,
      ({ token, url }) =>
        Option.exists(
          placeOf(url),
          (at) => at.scheme === protocol && at.host === host.toLowerCase()
        ) && fitsOneLine(Redacted.value(token))
    );

    if (Option.isSome(profile)) {
      return {
        note: Option.none(),
        stdout: `username=${auditUser(detectHarness(env))}\npassword=${Redacted.value(profile.value.token)}\n`,
      } satisfies Answer;
    }

    const flag = Option.match(named, {
      onNone: () => "",
      onSome: (name) => ` --profile ${name}`,
    });

    return Option.isNone(yield* credentials.current)
      ? {
          note: Option.some(
            `no ${Brand.cli} login for ${host}: run ${Brand.cli} login${flag} --url ${protocol}://${host}`
          ),
          stdout: "",
        }
      : silent;
  });

export const credentialHelper = (
  op: Operation,
  input: string,
  env: Env
): Effect.Effect<string, never, Credentials> =>
  Effect.map(answer(op, input, env), ({ stdout }) => stdout);

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
