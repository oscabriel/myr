/**
 * `ProjectionMemory`, the read models' feed in tests and in the platform's
 * local composition: it keeps each project's events once by
 * `(project, event.seq)`, as the `Projection` port asks, even though every
 * project's outbox names its rows by the event's number alone
 * (`projected:<seq>`). Found by the web's dev world: burrow's events vanished
 * from a projection datekit's had reached first.
 */
import { describe, expect, it } from "@effect/vitest";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { AskId, ProjectName } from "@repo/protocol/ids";
import { DateTime, Effect } from "effect";

import { projectedRows } from "../src/outbox.ts";
import { Projection } from "../src/projection.ts";
import { ProjectedRows, ProjectionMemory } from "../src/projection/memory.ts";

const now = DateTime.makeUnsafe("2026-10-07T09:00:00Z");

const datekit = ProjectName.make("datekit");

const burrow = ProjectName.make("burrow");

const released = (ask: string, seq: number) =>
  ProjectEvent.cases.Released.make({ ask: AskId.make(ask), at: now, seq });

describe("the memory projection", () => {
  it.effect("keeps two projects' events that share a number, each once", () =>
    Effect.gen(function* () {
      const projection = yield* Projection;

      const datekitRows = yield* projectedRows(
        datekit,
        [released("parse-iso-week", 1)],
        now
      );

      const burrowRows = yield* projectedRows(
        burrow,
        [released("migrate-legacy-fetch", 1)],
        now
      );

      yield* projection.apply(datekitRows);
      yield* projection.apply(burrowRows);
      yield* projection.apply([...datekitRows, ...burrowRows]);

      const kept = yield* (yield* ProjectedRows).events;

      expect(
        kept.map(({ event, project }) => [project, event.seq])
      ).toStrictEqual([
        [datekit, 1],
        [burrow, 1],
      ]);
    }).pipe(Effect.provide(ProjectionMemory))
  );
});
