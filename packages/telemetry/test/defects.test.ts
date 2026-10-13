import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject, VerifierBlocked } from "@repo/protocol/refusal";
import { Cause, Console, Effect, Redacted } from "effect";

import { reportedElsewhere } from "../src/defects.ts";
import { recordingTracing } from "../src/spans/memory.ts";
import { Telemetry } from "../src/telemetry.ts";
import { capturing } from "./console.ts";

// A boundary that hands every failure to the reporters, as effect's HTTP and
// RPC servers do with a request's: telling a defect from a refusal is the
// reporter's job.
const boundary = Effect.withErrorReporting;

const reported = <A, E>(
  body: Effect.Effect<A, E>,
  secrets: readonly Redacted.Redacted[] = []
) =>
  Effect.gen(function* () {
    const { console, written } = capturing();
    const recording = recordingTracing();

    yield* body.pipe(
      Effect.withSpan("Project.claim"),
      Effect.provide(Telemetry({ secrets, tracing: recording.tracing })),
      Effect.provideService(Console.Console, console),
      Effect.exit
    );

    return {
      errors: written.flatMap(({ line, method }) =>
        method === "error" ? [line] : []
      ),
      spans: recording.spans(),
      written,
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
