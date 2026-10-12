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
import { SignedOut } from "./signed-out.ts";

export type Handlers = Layer.Layer<
  Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>
>;

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

const lines = (output: Effect.Effect<readonly unknown[]>) =>
  Effect.map(output, (all) =>
    all.flatMap((chunk) => String(chunk).split("\n"))
  );

export interface Invocation {
  readonly handlers: Handlers;
  readonly client?: Layer.Layer<Client>;
  readonly env?: Readonly<Record<string, string>>;
  readonly isTTY?: boolean;
  readonly cwd?: string;
}

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
      promptless(prompts),
      SignedOut
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

export const knownToken = "token-of-tester";

const verify = (token: string) =>
  Effect.succeed(
    token === knownToken
      ? Option.some(Person.make({ handle: Handle.make("tester") }))
      : Option.none()
  );

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

// Any other bearer token is a 401 before the contracts see it, as at the platform's gate.
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

export const failingPlatform = (status: number) =>
  serving(Effect.succeed(HttpServerResponse.empty({ status })));
