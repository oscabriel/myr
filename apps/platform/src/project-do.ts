// The class name is frozen: a Durable Object class is renamed only by a migration.
import { SqliteClient } from "@effect/sql-sqlite-do";
import { AnswerRuns } from "@repo/project/answer-runs";
import { nameOfKey, ProjectKey } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { DurableObject } from "cloudflare:workers";
import { Context, Effect, Layer, ManagedRuntime, Option, Schema } from "effect";

import { DoAlarms } from "./adapters/alarms.ts";
import type { AlarmStorage } from "./adapters/alarms.ts";
import { AnswerRunsWorkflow } from "./adapters/answer-runs-workflow.ts";
import { DoBackground } from "./adapters/background.ts";
import type { BackgroundHost } from "./adapters/background.ts";
import { decodeEnv } from "./platform.ts";
import type { InvalidEnv, PlatformConfig } from "./platform.ts";
import { telemetryOf, workerPorts } from "./ports.ts";
import type { CallRequest, ExitEncoded } from "./project-calls.ts";
import { projectShell } from "./project-shell.ts";
import type { ProjectShell } from "./project-shell.ts";
import { closeEnd, watchRequest, watchRoom } from "./watch.ts";
import { ProjectSkillGenerator } from "./workflows/generated.ts";

class Shell extends Context.Service<Shell, ProjectShell>()(
  "platform/ProjectShell"
) {}

const Nameless = Layer.succeed(
  AnswerRuns,
  AnswerRuns.of({
    start: () => Effect.die("a Project DO with no name started an answer run"),
  })
);

export const doPorts = (input: {
  readonly config: PlatformConfig;
  readonly host: BackgroundHost;
  readonly storage: AlarmStorage;
  readonly name: Option.Option<ProjectName>;
}) =>
  Layer.mergeAll(
    workerPorts(input.config),
    DoAlarms(input.storage),
    DoBackground(input.host),
    Option.match(input.name, {
      onNone: () => Nameless,
      onSome: (project) => AnswerRunsWorkflow(input.config.ANSWER, project),
    }),
    ProjectSkillGenerator
  );

// Every call and alarm runs with the Worker's telemetry, migrations included.
const shellOf = (ctx: DurableObjectState, env: Env) =>
  Layer.unwrap(
    Effect.map(decodeEnv(env), (config) => {
      const name = Option.flatMap(
        Schema.decodeUnknownOption(ProjectKey)(ctx.id.name),
        nameOfKey
      );

      return Layer.effect(
        Shell,
        projectShell({
          name: Option.getOrUndefined(name),
          ports: doPorts({
            config,
            host: {
              waitUntil: (promise) => {
                ctx.waitUntil(promise);
              },
            },
            name,
            storage: ctx.storage,
          }),
          // The storage itself, not `storage.sql`: transactions run through it.
          sql: SqliteClient.layer({ storage: ctx.storage }),
        })
      ).pipe(Layer.provideMerge(telemetryOf(config)));
    })
  );

export class Project extends DurableObject<Env> {
  readonly #runtime: ManagedRuntime.ManagedRuntime<Shell, InvalidEnv>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#runtime = ManagedRuntime.make(shellOf(ctx, env));
    // Migrations run before the first call or alarm is let in.
    void ctx.blockConcurrencyWhile(() => this.#runtime.context());
  }

  #watched<A>(
    use: (room: ReturnType<typeof watchRoom>) => Effect.Effect<A>
  ): Promise<A> {
    return this.#runtime.runPromise(
      Shell.use((shell) => use(watchRoom(this.ctx, shell)))
    );
  }

  call(request: typeof CallRequest.Encoded): Promise<ExitEncoded> {
    return this.#watched((room) => room.call(request));
  }

  override alarm(): Promise<void> {
    return this.#watched((room) => room.alarm());
  }

  override fetch(request: Request): Promise<Response> {
    return Option.match(watchRequest(request), {
      onNone: () =>
        Promise.resolve(
          new Response("Open a watch socket: /watch?since=n, upgraded.", {
            headers: { upgrade: "websocket" },
            status: 426,
          })
        ),
      onSome: (since) => {
        const { 0: client, 1: server } = new WebSocketPair();

        return this.#watched((room) =>
          Effect.map(
            room.admit(server, since),
            () => new Response(null, { status: 101, webSocket: client })
          )
        );
      },
    });
  }

  override webSocketMessage(socket: WebSocket): Promise<void> {
    return this.#watched((room) => room.heard(socket));
  }

  // A close needs neither the env nor the storage, so it never waits on the
  // runtime: a socket that goes while the object wakes, or while its storage
  // fails, is let go without failing the close.
  // oxlint-disable-next-line eslint/class-methods-use-this -- workerd calls a hibernation handler on the instance, and a close needs nothing the instance holds.
  override webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): void {
    Effect.runSync(closeEnd(socket, { code, reason, wasClean }));
  }
}
