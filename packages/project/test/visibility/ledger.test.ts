/**
 * The public ledger through the project service (W6 612; OSR §6.1, §7.1):
 * the `ledger` method is 602's `ledgerOf` over the project's rows and its
 * config, every row is also an event for watchers and the projection, and
 * neither the layer read log nor a salt ever reaches it.
 */
import { describe, expect, it } from "@effect/vitest";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Ledger } from "@repo/protocol/domain/visibility";
import { Anonymous } from "@repo/protocol/principal";
import { ledgerOf } from "@repo/visibility/ledger";
import { Array, Effect, Option, Schema } from "effect";

import { ProjectStore } from "../../src/project-store.ts";
import {
  countersigned,
  datekitVisibility,
  firstSuite,
  inesV,
  layerRepo,
  maintainers,
  project,
  pushLayer,
  sealedByInes,
  visibilityWorld,
} from "./world.ts";

const anyone = Anonymous.make({});

const encodeLedger = Schema.encodeSync(Ledger);

const encodeEvents = Schema.encodeSync(Schema.Array(ProjectEvent));

describe("the public ledger", () => {
  it.effect(
    "is ledgerOf over the project's rows, each row also an event, with no read and no salt in it",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;

        yield* countersigned(api);

        const head = yield* pushLayer(api, Option.none(), firstSuite);

        yield* api.recordLayerRead(inesV, { layer: maintainers, sha: head });

        const ledger = yield* api.ledger(anyone);
        const store = yield* ProjectStore;
        const rows = yield* store.load();
        const reads = yield* store.layerReadsSince(0, 10);
        const events = (yield* api.events(0, 100)).map(({ event }) => event);

        const salt = Option.getOrThrow(
          Option.fromUndefinedOr(
            Array.head(rows.layers).pipe(Option.getOrThrow).saltRef
          )
        );

        const told = events.flatMap((event) =>
          ProjectEvent.guards.LedgerAppended(event) ? [event.entry] : []
        );

        const published = JSON.stringify([
          encodeLedger(ledger),
          encodeEvents(events),
        ]);

        expect(ledger).toStrictEqual(
          ledgerOf({
            licence: Option.none(),
            project,
            rows: rows.ledger,
            visibility: Option.some({
              ...datekitVisibility,
              layers: datekitVisibility.layers.map((layer) => ({
                ...layer,
                repo: layerRepo,
              })),
            }),
          })
        );
        expect({
          entries: ledger.entries.map(({ _tag, seq }) => `${seq} ${_tag}`),
          reads: reads.length,
          saltShown: published.includes(salt),
          told,
        }).toStrictEqual({
          entries: [
            "1 LayerDeclared",
            "2 PostureChanged",
            "3 CommitmentPublished",
            "4 CommitmentPublished",
          ],
          reads: 1,
          saltShown: false,
          told: ledger.entries,
        });
      }).pipe(Effect.provide(visibilityWorld()))
  );
});
