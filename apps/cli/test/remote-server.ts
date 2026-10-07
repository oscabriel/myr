/**
 * The platform as the CLI's tests meet it: in process, through a test
 * client, for `program` runs; or over HTTP, as an `RpcServer` for the
 * contracts on an ephemeral port, for the remote client.
 */
import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { authenticated, bearerToken } from "@repo/protocol/authenticate";
import { Client, Contracts } from "@repo/protocol/contracts";
import { Handle } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { asTester } from "@repo/protocol/testing";
import type { Scope } from "effect";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Runtime,
  Terminal,
} from "effect";
import { CliOutput } from "effect/cli";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { Rpc, RpcGroup } from "effect/rpc";
import { RpcSerialization, RpcServer, RpcTest } from "effect/rpc";
import { TestConsole } from "effect/testing";

import { program } from "../src/main.ts";
import { OutputLive } from "../src/output.ts";
import { policyFor } from "../src/policy.ts";
import { WorkingDirectory } from "../src/surfaces.ts";

/** Handlers for every contract, as a test sets them up. */
export type Handlers = Layer.Layer<
  Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>
>;

/** A Terminal that counts every prompt it is asked for, and answers none. */
const promptless = (prompts: Ref.Ref<number>) => {
  const prompted = Ref.update(prompts, (count) => count + 1).pipe(
    Effect.andThen(Effect.die("the CLI prompted"))
  );

  return Layer.succeed(Terminal.Terminal)(
    Terminal.make({
      columns: Effect.succeed(80),
      display: () => prompted,
      readInput: prompted,
      readLine: prompted,
      rows: Effect.succeed(24),
    })
  );
};

/** What was printed to a stream, one entry per line however it was written. */
const lines = (output: Effect.Effect<readonly unknown[]>) =>
  Effect.map(output, (all) =>
    all.flatMap((chunk) => String(chunk).split("\n"))
  );

export interface Invocation {
  /** The calls' handlers: the platform in process, as `tester`. */
  readonly handlers: Handlers;
  /** How the CLI reaches the platform instead, such as over HTTP. */
  readonly client?: Layer.Layer<Client>;
  /** The env the CLI reads its mode from. */
  readonly env?: Readonly<Record<string, string>>;
  /** Whether stdout is a terminal; it is, unless said otherwise. */
  readonly isTTY?: boolean;
  /** Where the CLI stands; the test process's own folder unless given. */
  readonly cwd?: string;
}

/**
 * Runs `program` on `args` as the process would: the mode from `env` and the
 * TTY, the platform from `handlers`, and a terminal that fails any prompt.
 * Returns what it printed, its exit code as the runtime would set it, and
 * how many prompts it asked for.
 */
export const runProgram = (
  args: readonly string[],
  { client, cwd, env = {}, handlers, isTTY = true }: Invocation
) =>
  Effect.gen(function* () {
    const prompts = yield* Ref.make(0);

    const policy = policyFor({ env, isTTY });

    const services = Layer.mergeAll(
      NodeServices.layer,
      TestConsole.layer,
      CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
      client ??
        Layer.effect(Client)(RpcTest.makeClient(Contracts)).pipe(
          Layer.provide([handlers, asTester])
        ),
      policy,
      OutputLive.pipe(Layer.provide(policy)),
      promptless(prompts)
    );

    const run = Effect.gen(function* () {
      const exit = yield* Effect.exit(program(args));

      return {
        err: yield* lines(TestConsole.errorLines),
        exit,
        out: yield* lines(TestConsole.logLines),
      };
    }).pipe(
      cwd === undefined
        ? (effect) => effect
        : Effect.provideService(WorkingDirectory, cwd),
      Effect.provide(services)
    );

    const { err, exit, out } = yield* run;

    let code = -1;

    Runtime.defaultTeardown(exit, (set) => {
      code = set;
    });

    return {
      code,
      err,
      failure: Exit.findErrorOption(exit),
      out,
      prompts: yield* Ref.get(prompts),
    };
  });

/** A person the HTTP platform knows by their token. */
export const knownToken = "token-of-tester";

/** The person a token names: `tester` for `knownToken`, nobody for any other. */
const verify = (token: string) =>
  Effect.succeed(
    token === knownToken
      ? Option.some(Person.make({ handle: Handle.make("tester") }))
      : Option.none()
  );

/** `app` served on an ephemeral port for the test's scope: returns its origin. */
const serving = <E>(
  app: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    HttpServerRequest.HttpServerRequest | Scope.Scope
  >
) =>
  Effect.gen(function* () {
    const server = yield* Layer.build(
      HttpServer.serve(app).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
    ).pipe(Effect.orDie);

    const { address } = Context.get(server, HttpServer.HttpServer);

    return "port" in address
      ? `http://127.0.0.1:${address.port}`
      : yield* Effect.die("the test platform listens on a socket, not a port");
  });

/**
 * The contracts over HTTP at `/rpc`, on an ephemeral port: `handlers` answer
 * as the person `knownToken` names, or as anyone for a public contract when
 * a request carries no credential. Any other bearer token is a 401 before
 * the contracts see it, as at the platform's gate. Returns the origin, and
 * every `authorization` header the server saw, in order.
 */
export const httpPlatform = (handlers: Handlers) =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<readonly (string | undefined)[]>([]);

    const rpc = yield* RpcServer.toHttpEffect(Contracts).pipe(
      Effect.provide([
        handlers,
        authenticated(verify),
        RpcSerialization.layerJson,
      ])
    );

    const gate = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const { authorization } = request.headers;

      yield* Ref.update(seen, (all) => [...all, authorization]);

      const unknown = Option.exists(
        bearerToken(authorization),
        (token) => token !== knownToken
      );

      return unknown ? HttpServerResponse.empty({ status: 401 }) : yield* rpc;
    });

    return { origin: yield* serving(gate), seen: Ref.get(seen) };
  });

/**
 * A platform that answers every request with `status` and an empty body, as
 * a platform that is down does: returns its origin.
 */
export const failingPlatform = (status: number) =>
  serving(Effect.succeed(HttpServerResponse.empty({ status })));
