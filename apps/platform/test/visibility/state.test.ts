/**
 * The cartridge's project state as the platform provides it (W6 612): salts
 * from WebCrypto's randomness, 32 fresh bytes each, and admissions started
 * as runs of the `Answer` Workflow, one instance per project, layer and
 * head, so a start the outbox runs again finds the first run.
 */
import { describe, expect, it } from "@effect/vitest";
import { AdmissionStarts, SaltSource } from "@repo/project/visibility/state";
import { CommitSha, LayerName, ProjectName } from "@repo/protocol/ids";
import { Cause, Effect, Exit, Schema } from "effect";

import { AdmissionParams } from "../../src/answer-runs.ts";
import { admissionStarts, WebCryptoSalts } from "../../src/visibility/state.ts";
import type { AdmissionWorkflow } from "../../src/visibility/state.ts";

const hexOf = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

describe("salts from WebCrypto", () => {
  it.effect("are 32 bytes, fresh each time", () =>
    Effect.gen(function* () {
      const salts = yield* SaltSource.use(({ next }) =>
        Effect.all([next, next, next])
      );

      expect({
        distinct: new Set(salts.map(hexOf)).size,
        lengths: salts.map(({ length }) => length),
      }).toStrictEqual({ distinct: 3, lengths: [32, 32, 32] });
    }).pipe(Effect.provide(WebCryptoSalts))
  );
});

const datekit = ProjectName.make("datekit");

const maintainers = LayerName.make("maintainers");

const head = CommitSha.make("a".repeat(40));

const later = CommitSha.make("b".repeat(40));

/**
 * The `Answer` Workflow's binding, in memory: `create` refuses an id it
 * holds, as Workflows do, and `get` finds only the ids it holds. With
 * `down`, both refuse everything.
 */
const workflowOf = (down = false) => {
  const created: { readonly id: string; readonly params: unknown }[] = [];

  const workflow: AdmissionWorkflow = {
    create: ({ id, params }) => {
      if (down || created.some((each) => each.id === id)) {
        return Promise.reject(new Error(`instance ${id} was not created`));
      }

      created.push({ id, params });

      return Promise.resolve({ id });
    },
    get: (id) =>
      !down && created.some((each) => each.id === id)
        ? Promise.resolve({ id })
        : Promise.reject(new Error(`no instance ${id}`)),
  };

  return { created, workflow };
};

const decodeParams = Schema.decodeUnknownSync(AdmissionParams);

/** The admission of `at` to datekit's maintainers layer. */
const admissionOf = (at: CommitSha) =>
  AdmissionParams.make({ head: at, layer: maintainers, project: datekit });

const start = (input: { readonly head: CommitSha }) =>
  AdmissionStarts.use((admissions) =>
    admissions.start({ head: input.head, layer: maintainers, project: datekit })
  );

describe("an admission's start", () => {
  it.effect(
    "runs one Answer Workflow instance per project, layer and head, found again when started twice",
    () => {
      const { created, workflow } = workflowOf();

      return Effect.gen(function* () {
        yield* start({ head });
        yield* start({ head });
        yield* start({ head: later });

        // What each instance was created with, read back as the Workflow reads it.
        expect(
          created.map(({ id, params: given }) => ({
            id,
            params: decodeParams(given),
          }))
        ).toStrictEqual([
          {
            id: `admit-datekit-maintainers-${head}`,
            params: admissionOf(head),
          },
          {
            id: `admit-datekit-maintainers-${later}`,
            params: admissionOf(later),
          },
        ]);
      }).pipe(Effect.provide(admissionStarts(workflow)));
    }
  );

  it.effect(
    "is a defect when the instance can be neither made nor found, so the outbox runs it again",
    () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(start({ head }));

        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBeTruthy();
      }).pipe(Effect.provide(admissionStarts(workflowOf(true).workflow)))
  );
});
