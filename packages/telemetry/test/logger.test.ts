import { describe, expect, it } from "@effect/vitest";
import { Cause, Console, Effect, Logger, Redacted } from "effect";

import { jsonLogger, scrubberOf } from "../src/logger.ts";
import { capturing } from "./console.ts";

const logged = <A, E>(
  body: Effect.Effect<A, E>,
  secrets: readonly Redacted.Redacted[] = []
) =>
  Effect.gen(function* () {
    const { console, written } = capturing();

    yield* body.pipe(
      Effect.provide(Logger.layer([jsonLogger(scrubberOf(secrets))])),
      Effect.provideService(Console.Console, console),
      Effect.exit
    );

    return written;
  });

describe(jsonLogger, () => {
  it.effect(
    "writes one object a line, each annotation a field of its own",
    () =>
      Effect.gen(function* () {
        const written = yield* logged(
          Effect.logInfo("a push reached custody").pipe(
            Effect.annotateLogs({
              project: "alice/datekit",
              requestId: "push-1",
            })
          )
        );

        expect(written).toStrictEqual([
          {
            line: {
              level: "INFO",
              message: "a push reached custody",
              project: "alice/datekit",
              requestId: "push-1",
            },
            method: "info",
          },
        ]);
      })
  );

  it.effect(
    "writes each level through its own console method, so Issues hears what is logged at Error",
    () =>
      Effect.gen(function* () {
        const written = yield* logged(
          Effect.all([
            Effect.logWarning("held"),
            Effect.logError("broke", Cause.die(new Error("the store is gone"))),
          ])
        );

        expect(written.map(({ method }) => method)).toStrictEqual([
          "warn",
          "error",
        ]);
        expect(written[1]?.line).toMatchObject({
          level: "ERROR",
          message: "broke",
        });
        expect(written[1]?.line).toHaveProperty(
          "cause",
          expect.stringMatching(/^Error: the store is gone\n\s+at /u)
        );
      })
  );

  it.effect(
    "lets no field a level, a message or a cause names give way to an annotation",
    () =>
      Effect.gen(function* () {
        const written = yield* logged(
          Effect.logInfo("kept").pipe(
            Effect.annotateLogs({ level: "ERROR", message: "forged" })
          )
        );

        expect(written[0]?.line).toStrictEqual({
          level: "INFO",
          message: "kept",
        });
      })
  );

  it.effect(
    "takes every secret out of a message, an annotation and a cause, longest first",
    () =>
      Effect.gen(function* () {
        const short = "s3cret-0123456789abcdef0123456789";
        const long = `${short}-and-more`;

        const written = yield* logged(
          Effect.logError(
            `sent ${long} and ${short}`,
            Cause.die(new Error(`token ${short} refused`))
          ).pipe(Effect.annotateLogs({ reason: `bearer ${short}` })),
          [Redacted.make(short), Redacted.make(long), Redacted.make("")]
        );

        const text = JSON.stringify(written);

        expect(text).not.toContain(short);
        expect(written[0]?.line).toMatchObject({
          message: "sent <redacted> and <redacted>",
          reason: "bearer <redacted>",
        });
        expect(written[0]?.line).toHaveProperty(
          "cause",
          expect.stringContaining("token <redacted> refused")
        );
      })
  );
});
