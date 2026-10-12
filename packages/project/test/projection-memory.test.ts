/**
 * Every project's outbox names its rows by event number alone
 * (`projected:<seq>`), so the projection must key events by project too.
 */
import { describe, expect, it } from "@effect/vitest";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { AskId, ProjectName } from "@repo/protocol/ids";
import { DateTime, Effect } from "effect";

import { projectedRows } from "../src/outbox.ts";
import { Projection } from "../src/projection.ts";
import { ProjectedRows, ProjectionMemory } from "../src/projection/memory.ts";

const now = DateTime.makeUnsafe("2026-10-07T09:00:00Z");

const datekit = ProjectName.make("alice/datekit");

const burrow = ProjectName.make("alice/burrow");

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
