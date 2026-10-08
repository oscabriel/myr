/**
 * One project's Durable Object: its state, its serial landing queue and its
 * alarm, behind a typed call boundary. A thin host over `project-shell.ts`:
 * it gives the shell the DO's own SQLite, its name and the stage's ports,
 * builds it once while the DO blocks other events, and runs every call and
 * every alarm on that one runtime, which lives on the instance.
 *
 * Every project call goes through `call`, and the project's deadlines
 * through `alarm`. Its watchers (`watch`, issue 510) are hibernating
 * WebSockets: `fetch` accepts one at `/watch?since=n`, and after each call
 * and alarm commits, the watch room sends every socket what it has not
 * been sent (`watch.ts`). It has no public route: only the Worker reaches
 * it, through the `PROJECT` namespace (`adapters/do-projects.ts`,
 * `watch.ts`). The class name is frozen: a Durable Object class is renamed
 * only by a migration.
 */
import { SqliteClient } from "@effect/sql-sqlite-do";
import { AnswerRuns } from "@repo/project/answer-runs";
import { ProjectName } from "@repo/protocol/ids";
import { DurableObject } from "cloudflare:workers";
import { Context, Effect, Layer, ManagedRuntime, Option, Schema } from "effect";

import { DoAlarms } from "./adapters/alarms.ts";
import type { AlarmStorage } from "./adapters/alarms.ts";
import { AnswerRunsWorkflow } from "./adapters/answer-runs-workflow.ts";
import { decodeEnv } from "./platform.ts";
import type { InvalidEnv, PlatformConfig } from "./platform.ts";
import { workerPorts } from "./ports.ts";
import type { CallRequest, ExitEncoded } from "./project-calls.ts";
import { projectShell } from "./project-shell.ts";
import type { ProjectShell } from "./project-shell.ts";
import { closeEnd, watchRequest, watchRoom } from "./watch.ts";
import { ProjectSkillGenerator } from "./workflows/generated.ts";

/** The shell one Project DO runs on. */
class Shell extends Context.Service<Shell, ProjectShell>()(
  "platform/ProjectShell"
) {}

/**
 * An answer run started by a DO with no name: it cannot say which project
 * the run is for. The Worker always names the DO (`idFromName`).
 */
const Nameless = Layer.succeed(
  AnswerRuns,
  AnswerRuns.of({
    start: () => Effect.die("a Project DO with no name started an answer run"),
  })
);

/**
 * Every port one Project DO's service runs on but its store: the stage's,
 * the DO's own alarm, the project's answer runs, and the platform's
 * generator for the project's own agent files, which the service runs after
 * a landing that changes what they say (W4 410).
 */
export const doPorts = (input: {
  readonly config: PlatformConfig;
  readonly storage: AlarmStorage;
  readonly name: Option.Option<ProjectName>;
}) =>
  Layer.mergeAll(
    workerPorts(input.config),
    DoAlarms(input.storage),
    Option.match(input.name, {
      onNone: () => Nameless,
      onSome: (project) => AnswerRunsWorkflow(input.config.ANSWER, project),
    }),
    ProjectSkillGenerator
  );

/** The shell over the DO's storage, its name, and the stage's ports. */
const shellOf = (ctx: DurableObjectState, env: Env) =>
  Layer.effect(
    Shell,
    Effect.gen(function* () {
      const config = yield* decodeEnv(env);
      const name = Schema.decodeUnknownOption(ProjectName)(ctx.id.name);

      return yield* projectShell({
        name: Option.getOrUndefined(name),
        ports: doPorts({ config, name, storage: ctx.storage }),
        // The storage itself, not `storage.sql`: transactions run through it.
        sql: SqliteClient.layer({ storage: ctx.storage }),
      });
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

  /** The shell with its watchers: what every call, alarm and socket runs on. */
  #watched<A>(
    use: (room: ReturnType<typeof watchRoom>) => Effect.Effect<A>
  ): Promise<A> {
    return this.#runtime.runPromise(
      Shell.use((shell) => use(watchRoom(this.ctx, shell)))
    );
  }

  /**
   * One call on the project: its `Exit`, encoded by the method's schemas.
   * Every watcher then hears what it committed.
   */
  call(request: typeof CallRequest.Encoded): Promise<ExitEncoded> {
    return this.#watched((room) => room.call(request));
  }

  /** The project's deadlines and retries, when the alarm the service set fires; then its watchers hear what they committed. */
  override alarm(): Promise<void> {
    return this.#watched((room) => room.alarm());
  }

  /**
   * A watcher's socket, at `/watch?since=n` with the WebSocket upgrade:
   * accepted to hibernate and sent every kept event after `n`. Any other
   * request asks for the upgrade.
   */
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

  /** A watcher spoke: it is sent whatever it has not been sent yet. */
  override webSocketMessage(socket: WebSocket): Promise<void> {
    return this.#watched((room) => room.heard(socket));
  }

  /** A watcher went away: its end closes too. */
  override webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string
  ): Promise<void> {
    return this.#runtime.runPromise(closeEnd(socket, code, reason));
  }
}
