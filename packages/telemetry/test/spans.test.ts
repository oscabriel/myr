import { describe, expect, it } from "@effect/vitest";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { Effect, Layer, Logger, Option, Redacted } from "effect";

import { scrubberOf } from "../src/logger.ts";
import { annotateInvocation, withInvocation } from "../src/spans.ts";
import { tracerOver } from "../src/spans/binding.ts";
import {
  recordingTracing,
  ROOT,
  SpansMemory,
  SpansRecorded,
} from "../src/spans/memory.ts";
import type { RecordedSpan } from "../src/spans/memory.ts";

const recorded = <A, E>(body: Effect.Effect<A, E>, traced = true) =>
  Effect.gen(function* () {
    const { spans } = yield* SpansRecorded;

    yield* Effect.exit(body);

    return yield* spans;
  }).pipe(Effect.provide(SpansMemory(scrubberOf([]), traced)));

const lineageOf = ({ name, parent }: RecordedSpan) => ({ name, parent });

describe("the spans bridge", () => {
  it.effect(
    "opens every span under the invocation's root: siblings of each other and of the runtime's own, while Effect keeps their nesting",
    () =>
      Effect.gen(function* () {
        const recording = recordingTracing();

        const [land, git] = yield* Effect.currentSpan.pipe(
          // A span the runtime opens itself, as fetch or a Durable Object call does.
          Effect.tap(() =>
            Effect.sync(() => {
              recording.tracing.startSpan("fetch").end();
            })
          ),
          Effect.withSpan("Lander.git"),
          Effect.flatMap((inner) =>
            Effect.map(Effect.currentSpan, (outer) => [outer, inner] as const)
          ),
          Effect.withSpan("Lander.land"),
          Effect.withTracer(tracerOver(recording.tracing, scrubberOf([])))
        );

        expect(recording.spans().map(lineageOf)).toStrictEqual([
          { name: ROOT, parent: undefined },
          { name: "Lander.land", parent: ROOT },
          { name: "Lander.git", parent: ROOT },
          { name: "fetch", parent: ROOT },
        ]);
        expect(Option.map(git.parent, ({ spanId }) => spanId)).toStrictEqual(
          Option.some(land.spanId)
        );
        expect(
          recording.spans().flatMap(({ ended, name }) => (ended ? [] : [name]))
        ).toStrictEqual([ROOT]);
      })
  );

  it.effect(
    "carries a listed id that is a string, a number or a boolean, and drops any other",
    () =>
      Effect.gen(function* () {
        const spans = yield* recorded(
          Effect.void.pipe(
            Effect.withSpan("Workflow.step", {
              attributes: {
                attempt: 2,
                path: "secret/plan.md",
                repo: "alice__datekit",
                sha: "7".repeat(40),
                stage: { name: "shape" },
                step: "cheap#2",
                "url.full": "https://example.com/?code=abc",
              },
            })
          )
        );

        expect(Object.fromEntries(spans[1]?.attributes ?? [])).toStrictEqual({
          attempt: 2,
          sha: "7".repeat(40),
          step: "cheap#2",
        });
      })
  );

  it.effect(
    "records a typed failure by its tag alone, and a defect by its name, message and stack, scrubbed",
    () =>
      Effect.gen(function* () {
        const secret = "tok_0123456789abcdef0123456789abcdef";

        const spans = yield* Effect.gen(function* () {
          const recording = recordingTracing();

          yield* Effect.exit(
            Effect.all([
              Effect.exit(
                Effect.fail(new VerifierBlocked({})).pipe(
                  Effect.withSpan("Checker.Setup")
                )
              ),
              Effect.exit(
                Effect.die(new TypeError(`no fetch with ${secret}`)).pipe(
                  Effect.withSpan("Checker.Run")
                )
              ),
            ]).pipe(
              Effect.withTracer(
                tracerOver(
                  recording.tracing,
                  scrubberOf([Redacted.make(secret)])
                )
              )
            )
          );

          return recording.spans();
        });

        const [, refused, died] = spans;

        expect(refused?.exceptions).toStrictEqual([
          { name: "VerifierBlocked" },
        ]);
        expect(
          died?.exceptions.map(({ message, name }) => ({ message, name }))
        ).toStrictEqual([
          { message: "no fetch with <redacted>", name: "TypeError" },
        ]);
        expect(died?.exceptions[0]?.stack).toMatch(
          /^TypeError: no fetch with <redacted>\n\s+at /u
        );
      })
  );

  it.effect(
    "opens no span Effect did not sample, nor a client's, which the runtime traces itself",
    () =>
      Effect.gen(function* () {
        const spans = yield* recorded(
          Effect.all([
            Effect.void.pipe(Effect.withSpan("unsampled", { sampled: false })),
            Effect.void.pipe(
              Effect.withSpan("sql.execute", { kind: "client" })
            ),
            Effect.void.pipe(Effect.withSpan("Project.claim")),
          ])
        );

        expect(spans.map(({ name }) => name)).toStrictEqual([
          ROOT,
          "Project.claim",
        ]);
      })
  );

  it.effect(
    "sets nothing on an invocation the head sampling left out, and still ends each span",
    () =>
      Effect.gen(function* () {
        const spans = yield* recorded(
          Effect.fail(new VerifierBlocked({})).pipe(
            Effect.withSpan("Project.claim", { attributes: { sha: "7" } }),
            Effect.tap(() => annotateInvocation({ project: "alice/datekit" }))
          ),
          false
        );

        expect(
          spans.map(({ attributes, ended, exceptions, name }) => ({
            attributes: attributes.size,
            ended,
            exceptions: exceptions.length,
            name,
          }))
        ).toStrictEqual([
          { attributes: 0, ended: false, exceptions: 0, name: ROOT },
          { attributes: 0, ended: true, exceptions: 0, name: "Project.claim" },
        ]);
      })
  );
});

describe(annotateInvocation, () => {
  it.effect(
    "sets the ids on the invocation's root span, where Issues reads them",
    () =>
      Effect.gen(function* () {
        const spans = yield* recorded(
          annotateInvocation({
            project: "alice/datekit",
            refusal: "OutOfScope,Weakened",
            requestId: "push-1",
          })
        );

        expect(Object.fromEntries(spans[0]?.attributes ?? [])).toStrictEqual({
          project: "alice/datekit",
          refusal: "OutOfScope,Weakened",
          requestId: "push-1",
        });
      })
  );

  it.effect(
    "goes, by withInvocation, onto the root span and onto each line logged under it",
    () =>
      Effect.gen(function* () {
        const lines: unknown[] = [];

        const spans = yield* recorded(
          Effect.logInfo("a run started").pipe(
            withInvocation({ project: "alice/datekit", requestId: "push-1" }),
            Effect.provide(
              Logger.layer([
                Logger.map(Logger.formatStructured, ({ annotations }) => {
                  lines.push(annotations);
                }),
              ])
            )
          )
        );

        expect([
          Object.fromEntries(spans[0]?.attributes ?? []),
          lines,
        ]).toStrictEqual([
          { project: "alice/datekit", requestId: "push-1" },
          [{ project: "alice/datekit", requestId: "push-1" }],
        ]);
      })
  );

  it.effect("is a no-op where no Worker's spans are installed", () =>
    annotateInvocation({ project: "alice/datekit" }).pipe(
      Effect.provide(Layer.empty)
    )
  );
});
