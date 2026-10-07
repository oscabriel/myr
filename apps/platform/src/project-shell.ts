/**
 * One project's Durable Object, without the host: the project service over
 * its own SQLite, behind the encoded call boundary. Host-free, so Node tests
 * run it over sqlite-node and memory ports; `project-do.ts` gives it the
 * DO's storage and the stage's ports.
 *
 * The shell holds no project logic (ADR 0012): `@repo/project`'s service
 * hydrates, transitions, persists and settles. The shell decodes each call
 * (the DO trusts only what the Worker sends), refuses a contract call
 * before `initProject` with `UnknownProject`, runs the method, and answers
 * its `Exit` encoded, so a refusal stays a refusal and never becomes a
 * defect at the boundary.
 */
import { projectService } from "@repo/project/project";
import type { ProjectApi, ProjectPorts } from "@repo/project/project";
import { ProjectStore } from "@repo/project/project-store";
import { ProjectStoreSqlite } from "@repo/project/project-store/sqlite";
import type { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Schema,
  SynchronizedRef,
} from "effect";
import type { Scope } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";

import { CallRequest, ProjectCalls } from "./project-calls.ts";
import type { ArgsOf, ExitEncoded, ProjectMethod } from "./project-calls.ts";

/** One project's DO without its host: what `project-do.ts` runs each call and alarm on. */
export interface ProjectShell {
  /** One call on the project: its `Exit`, encoded by the method's schemas. */
  readonly call: (
    request: typeof CallRequest.Encoded
  ) => Effect.Effect<ExitEncoded>;
  /** The DO's alarm fired: the project's deadlines and retries run. */
  readonly alarm: () => Effect.Effect<void>;
}

/**
 * The service's methods as one table, each over its own arguments: what a
 * call indexed by a method name runs.
 */
type Methods = {
  readonly [M in ProjectMethod]: (
    ...args: Readonly<ArgsOf<M>>
  ) => Effect.Effect<
    Effect.Success<ReturnType<ProjectApi[M]>>,
    Effect.Error<ReturnType<ProjectApi[M]>>
  >;
};

/** The DO has no name, and its storage holds no project to take one from. */
const nameless = Effect.die(
  "the Project DO has no name: the Worker reaches it by `idFromName`"
);

export const projectShell = (input: {
  /** The DO's name, when the Worker made its id with `idFromName`. */
  readonly name: ProjectName | undefined;
  /** SQL over the DO's own storage; sqlite-node in tests. */
  readonly sql: Layer.Layer<SqlClient>;
  /** Every port the service runs on but its store. */
  readonly ports: Layer.Layer<Exclude<ProjectPorts, ProjectStore>>;
}): Effect.Effect<ProjectShell, never, Scope.Scope> =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      Layer.merge(
        // Fresh: one store per shell, never one an enclosing layer made.
        Layer.fresh(ProjectStoreSqlite.pipe(Layer.provide(input.sql))),
        input.ports
      )
    );

    const store = Context.get(context, ProjectStore);
    const made = yield* Ref.make(false);
    const built = yield* SynchronizedRef.make(Option.none<Methods>());

    /** Whether `initProject` has made the project; once it has, it stays made. */
    const isMade = Effect.gen(function* () {
      if (yield* Ref.get(made)) {
        return true;
      }

      const { project } = yield* store.load();

      if (Option.isSome(project)) {
        yield* Ref.set(made, true);
      }

      return Option.isSome(project);
    });

    /** The project's name: the DO's, or the one its storage holds. */
    const nameOf = Effect.gen(function* () {
      if (input.name !== undefined) {
        return Option.some(input.name);
      }

      const { project } = yield* store.load();

      return Option.map(project, (row) => row.project);
    });

    /** The project's one service, built on first use: one lock per project. */
    const service = SynchronizedRef.modifyEffect(built, (current) =>
      Option.match(current, {
        onNone: () =>
          Effect.gen(function* () {
            const name = yield* nameOf;

            if (Option.isNone(name)) {
              return yield* nameless;
            }

            const api: Methods = yield* projectService(name.value).pipe(
              Effect.provideContext(context)
            );

            return [api, Option.some(api)] as const;
          }),
        onSome: (api) => Effect.succeed([api, current] as const),
      })
    );

    /** One call on `method`, its request as the Worker encoded it. */
    const serve = <M extends ProjectMethod>(
      method: M,
      request: typeof CallRequest.Encoded & { readonly method: M }
    ) =>
      Effect.gen(function* () {
        const call = ProjectCalls[method];

        const args = yield* Schema.decodeUnknownEffect(call.payload)(
          call.caller ? [request.caller, ...request.payload] : request.payload
        ).pipe(Effect.orDie);

        if (call.refusesUnmade && !(yield* isMade)) {
          const name = yield* nameOf;

          if (Option.isNone(name)) {
            return yield* nameless;
          }

          return yield* Schema.encodeEffect(call.exit)(
            Exit.fail(new UnknownProject({ project: name.value }))
          ).pipe(Effect.orDie);
        }

        const api = yield* service;
        const outcome = yield* Effect.exit(api[method](...args));

        return yield* Schema.encodeUnknownEffect(call.exit)(outcome).pipe(
          Effect.orDie
        );
      });

    return {
      alarm: () =>
        Effect.gen(function* () {
          // A DO no project was made in has nothing to wake for.
          if (yield* isMade) {
            yield* Effect.flatMap(service, (api) => api.onAlarm());
          }
        }),
      call: (request) =>
        Effect.flatMap(
          Schema.decodeEffect(CallRequest)(request).pipe(Effect.orDie),
          ({ method }) => serve(method, request)
        ),
    };
  });
