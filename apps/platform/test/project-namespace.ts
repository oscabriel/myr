/**
 * The `PROJECT` namespace in process, for tests that reach Project DOs
 * through `DoProjects` without a Worker: a name is one DO, whose shell
 * `shellFor` makes on the first call that names it and every later call
 * reuses, and its stub's `call` runs on the context the namespace was made
 * in, so each shell lives in that scope.
 */
import { ProjectName } from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Option, SynchronizedRef } from "effect";

import type { ProjectNamespace } from "../src/adapters/do-projects.ts";
import type { ProjectShell } from "../src/project-shell.ts";

/** The namespace over `shellFor`'s shells, and the names of the DOs made so far, in order. */
export const inProcessNamespace = <R>(
  shellFor: (name: ProjectName) => Effect.Effect<ProjectShell, never, R>
) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();

    const shells = yield* SynchronizedRef.make<
      ReadonlyMap<string, ProjectShell>
    >(new Map());

    /** The DO named `name`: made on its first call, the same one after. */
    const shellOf = (name: string) =>
      SynchronizedRef.modifyEffect(shells, (all) =>
        Option.match(Option.fromUndefinedOr(all.get(name)), {
          onNone: () =>
            Effect.map(
              shellFor(ProjectName.make(name)),
              (shell) => [shell, new Map(all).set(name, shell)] as const
            ),
          onSome: (shell) => Effect.succeed([shell, all] as const),
        })
      );

    const namespace: ProjectNamespace = {
      get: (id) => ({
        call: (request) =>
          Effect.runPromiseWith(context)(
            Effect.flatMap(shellOf(id.toString()), (shell) =>
              shell.call(request)
            )
          ),
      }),
      idFromName: (name) =>
        untouchable<DurableObjectId>("DurableObjectId", {
          equals: (other) => other.toString() === name,
          name,
          toString: () => name,
        }),
    };

    return {
      names: Effect.map(SynchronizedRef.get(shells), (all) => [...all.keys()]),
      namespace,
    };
  });
