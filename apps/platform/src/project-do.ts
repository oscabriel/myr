/**
 * One project's Durable Object: its state, its serial landing queue and its
 * alarm, behind a typed call boundary. A thin host over `project-shell.ts`:
 * it gives the shell the DO's own SQLite, its name and the stage's ports,
 * builds it once while the DO blocks other events, and runs every call and
 * every alarm on that one runtime, which lives on the instance.
 *
 * Its only methods are `call` and `alarm`; everything else goes through
 * `call`. It has no public route: only the Worker reaches it, through the
 * `PROJECT` namespace (`adapters/do-projects.ts`). The class name is
 * frozen: a Durable Object class is renamed only by a migration.
 */
import { SqliteClient } from "@effect/sql-sqlite-do";
import { AnswerRuns } from "@repo/project/answer-runs";
import { ProjectName } from "@repo/protocol/ids";
import { DurableObject } from "cloudflare:workers";
import { Context, Effect, Layer, ManagedRuntime, Option, Schema } from "effect";

import { DoAlarms } from "./adapters/alarms.ts";
import { AnswerRunsWorkflow } from "./adapters/answer-runs-workflow.ts";
import { decodeEnv } from "./platform.ts";
import type { InvalidEnv } from "./platform.ts";
import { workerPorts } from "./ports.ts";
import type { CallRequest, ExitEncoded } from "./project-calls.ts";
import { projectShell } from "./project-shell.ts";
import type { ProjectShell } from "./project-shell.ts";

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

/** The shell over the DO's storage, its name, and the stage's ports. */
const shellOf = (ctx: DurableObjectState, env: Env) =>
  Layer.effect(
    Shell,
    Effect.gen(function* () {
      const config = yield* decodeEnv(env);
      const name = Schema.decodeUnknownOption(ProjectName)(ctx.id.name);

      return yield* projectShell({
        name: Option.getOrUndefined(name),
        ports: Layer.mergeAll(
          workerPorts(config),
          DoAlarms(ctx.storage),
          Option.match(name, {
            onNone: () => Nameless,
            onSome: (project) => AnswerRunsWorkflow(config.ANSWER, project),
          })
        ),
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

  /** One call on the project: its `Exit`, encoded by the method's schemas. */
  call(request: typeof CallRequest.Encoded): Promise<ExitEncoded> {
    return this.#runtime.runPromise(Shell.use((shell) => shell.call(request)));
  }

  /** The project's deadlines and retries, when the alarm the service set fires. */
  override alarm(): Promise<void> {
    return this.#runtime.runPromise(Shell.use((shell) => shell.alarm()));
  }
}
