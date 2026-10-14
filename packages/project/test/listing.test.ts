import { describe, expect, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import {
  DateTime,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  Ref,
} from "effect";
import { TestClock } from "effect/testing";

import type { LandedProject } from "../src/description.ts";
import { withProjectFacts } from "../src/listing.ts";
import type { ProjectApi } from "../src/project.ts";
import { Projects } from "../src/projects.ts";

const datekit = ProjectName.make("alice/datekit");

const landedAt = DateTime.makeUnsafe("2026-10-08T12:00:00Z");

describe(withProjectFacts, () => {
  it.effect(
    "reads each project's posture and its description at once: neither read waits on the other's answer",
    () =>
      Effect.gen(function* () {
        const described = yield* Deferred.make<string>();
        const steps = yield* Ref.make<readonly string[]>([]);

        const seen = (step: string) =>
          Ref.update(steps, (before) => [...before, step]);

        // The posture's read ends only once the description's has begun: one
        // read after the other would wait forever.
        const api = untouchable<ProjectApi>("ProjectApi", {
          standing: () =>
            seen("posture").pipe(
              Effect.andThen(Deferred.await(described)),
              Effect.as({ posture: "open" as const, seen: 1 })
            ),
        });

        const projects = Layer.succeed(
          Projects,
          Projects.of({
            create: () => Effect.die("a listing makes no project"),
            get: () => Effect.succeed(api),
          })
        );

        const listed: readonly ProjectListing[] = [
          { landedAt, openAsks: 2, posture: "openCore", project: datekit },
        ];

        const facts = withProjectFacts(
          listed,
          (): Effect.Effect<LandedProject, string> =>
            seen("description").pipe(
              Effect.andThen(Deferred.succeed(described, "described")),
              Effect.andThen(Effect.fail("the repo is not read here"))
            )
        ).pipe(
          Effect.timeout(Duration.seconds(5)),
          Effect.provide(projects),
          Effect.provideService(RepoHost, untouchable("RepoHost")),
          Effect.provide(Logger.layer([]))
        );

        const fiber = yield* Effect.forkChild(facts);

        yield* TestClock.adjust(Duration.seconds(10));

        const result = yield* Fiber.join(fiber);

        expect((yield* Ref.get(steps)).toSorted()).toStrictEqual([
          "description",
          "posture",
        ]);
        expect(result).toStrictEqual([
          { landedAt, openAsks: 2, posture: "open", project: datekit },
        ]);
      })
  );
});
