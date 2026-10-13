import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject, VerifierBlocked } from "@repo/protocol/refusal";
import { Cause, Effect, Layer, Redacted } from "effect";

import { reportDefects, reportedElsewhere } from "../src/defects.ts";
import type { DefectKeeping } from "../src/defects.ts";
import { recordingConsole } from "../src/logger/memory.ts";
import { recordingTracing } from "../src/spans/memory.ts";
import { Telemetry } from "../src/telemetry.ts";

// A boundary that hands every failure to the reporters, as effect's HTTP and
// RPC servers do with a request's: telling a defect from a refusal is the
// reporter's job.
const boundary = Effect.withErrorReporting;

const reported = <A, E>(
  body: Effect.Effect<A, E>,
  secrets: readonly Redacted.Redacted[] = [],
  defects: DefectKeeping = "whole"
) =>
  Effect.gen(function* () {
    const console = recordingConsole();
    const recording = recordingTracing();

    yield* body.pipe(
      Effect.withSpan("Project.claim"),
      Effect.provide(
        Layer.merge(
          Telemetry({ defects, secrets, tracing: recording.tracing }),
          console.layer
        )
      ),
      Effect.exit
    );

    return {
      errors: console.errors(),
      spans: recording.spans(),
      written: console.written(),
    };
  });

const datekit = ProjectName.make("alice/datekit");

describe("a defect", () => {
  it.effect(
    "is reported once, at Error, with its cause, its stack and the invocation's ids, however many boundaries it crosses",
    () =>
      Effect.gen(function* () {
        const { errors } = yield* reported(
          Effect.die(new Error("the store is gone")).pipe(
            boundary,
            boundary,
            Effect.annotateLogs({ project: datekit, requestId: "push-1" })
          )
        );

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
          level: "ERROR",
          message: "Error: the store is gone",
          project: datekit,
          requestId: "push-1",
        });
        expect(errors[0]).toHaveProperty(
          "cause",
          expect.stringMatching(/^Error: the store is gone\n\s+at /u)
        );
      })
  );

  it.effect("is reported without the refusal beside it", () =>
    Effect.gen(function* () {
      const { errors } = yield* reported(
        Effect.failCause(
          Cause.fromReasons([
            Cause.makeFailReason(new VerifierBlocked({})),
            Cause.makeDieReason(new Error("the store is gone")),
          ])
        ).pipe(boundary)
      );

      expect(errors).toHaveLength(1);
      expect(JSON.stringify(errors)).not.toContain("VerifierBlocked");
    })
  );

  it.effect(
    "is reported at the innermost boundary, with the ids its lines carry there, and passes every boundary further out",
    () =>
      Effect.gen(function* () {
        const { errors } = yield* reported(
          Effect.forEach(
            [new Error("the store is gone"), "the Project DO has no name"],
            (defect) =>
              Effect.die(defect).pipe(
                reportDefects,
                Effect.annotateLogs({ requestId: "push-1" }),
                reportDefects,
                boundary,
                Effect.exit
              )
          )
        );

        expect(errors).toHaveLength(2);
        expect(errors).toMatchObject([
          { message: "Error: the store is gone", requestId: "push-1" },
          { message: "Error: the Project DO has no name", requestId: "push-1" },
        ]);
      })
  );

  it.effect(
    "is not reported again once the side that held its stack reported it",
    () =>
      Effect.gen(function* () {
        const { errors } = yield* reported(
          Effect.failCause(
            reportedElsewhere(
              Cause.fromReasons<never>([
                Cause.makeDieReason(new Error("the store is gone")),
                Cause.makeDieReason("the Project DO has no name"),
              ])
            )
          ).pipe(boundary)
        );

        expect(errors).toStrictEqual([]);
      })
  );

  it.effect(
    "is reported by its name and frames alone where its text may quote what no log may hold",
    () =>
      Effect.gen(function* () {
        const repo = "alice--datekit--private";

        const { errors } = yield* reported(
          Effect.forEach(
            [
              new TypeError(`the layer repo ${repo} has no commit`, {
                cause: new Error(`no tree in ${repo}`),
              }),
              `the layer repo ${repo} lost a blob its tree names`,
            ],
            (defect) => Effect.die(defect).pipe(boundary, Effect.exit)
          ),
          [],
          "name"
        );

        expect(errors).toMatchObject([
          { level: "ERROR", message: "TypeError: <withheld>" },
          { level: "ERROR", message: "Error: <withheld>" },
        ]);
        expect(errors[0]).toHaveProperty(
          "cause",
          expect.stringMatching(/^TypeError: <withheld>\n\s+at /u)
        );
        expect(errors[1]).toHaveProperty(
          "cause",
          expect.stringMatching(/^Error: <withheld>\n\s+at /u)
        );
        expect(JSON.stringify(errors)).not.toContain(repo);
      })
  );
});

describe("a refusal", () => {
  it.effect("is never reported as an error", () =>
    Effect.gen(function* () {
      const { errors, written } = yield* reported(
        Effect.all([
          Effect.fail(new VerifierBlocked({})).pipe(boundary, Effect.exit),
          Effect.fail(new UnknownProject({ project: datekit })).pipe(
            boundary,
            Effect.exit
          ),
        ])
      );

      expect([errors, written]).toStrictEqual([[], []]);
    })
  );
});

describe("what is reported", () => {
  it.effect("carries no sealed and no plain env value", () =>
    Effect.gen(function* () {
      const sealed = "0f".repeat(32);
      const plain = "sk_live_0123456789abcdef";

      const { errors, spans } = yield* reported(
        Effect.forEach(
          [
            new Error(`could not unwrap with ${sealed}`),
            { key: "STRIPE_KEY", value: Redacted.make(plain) },
          ],
          (defect) => Effect.die(defect).pipe(boundary, Effect.exit)
        ),
        [Redacted.make(sealed)]
      );

      const text = JSON.stringify({
        errors,
        exceptions: spans.flatMap(({ exceptions }) => exceptions),
      });

      expect(errors).toHaveLength(2);
      expect(text).toContain("could not unwrap with <redacted>");
      expect(text).not.toContain(sealed);
      expect(text).not.toContain(plain);
    })
  );
});
