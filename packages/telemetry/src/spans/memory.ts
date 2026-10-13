// A Worker's `tracing` in memory, kept as workerd keeps it: the invocation's
// root span is active throughout, and `startSpan` opens a span under whatever
// is active without making it active, so its parent is always the root.
import { Context, Effect, Layer } from "effect";
import { constUndefined, constVoid, identity } from "effect/Function";

import type { Scrub } from "../logger.ts";
import type { SpanValue, WorkerSpan, WorkerTracing } from "../spans.ts";
import { SpansBinding } from "./binding.ts";

export interface RecordedException {
  readonly name: string;
  readonly message?: string;
  readonly stack?: string;
}

export interface RecordedSpan {
  readonly name: string;
  /** The span that was active when this one opened; none for the root. */
  readonly parent: string | undefined;
  readonly attributes: ReadonlyMap<string, SpanValue>;
  readonly exceptions: readonly RecordedException[];
  readonly ended: boolean;
}

export const ROOT = "invocation";

export interface RecordingTracing {
  readonly tracing: WorkerTracing;
  /** Every span opened, the root first, in the order each opened. */
  readonly spans: () => readonly RecordedSpan[];
}

interface OpenSpan {
  readonly name: string;
  readonly parent: string | undefined;
  readonly attributes: Map<string, SpanValue>;
  readonly exceptions: RecordedException[];
  ended: boolean;
}

/** `traced: false` is an invocation the head sampling left out. */
export const recordingTracing = (traced = true): RecordingTracing => {
  const opened: OpenSpan[] = [];

  const open = (name: string, parent?: string): WorkerSpan => {
    const span: OpenSpan = {
      attributes: new Map(),
      ended: false,
      exceptions: [],
      name,
      parent,
    };

    opened.push(span);

    return {
      end: () => {
        span.ended = true;
      },
      isTraced: traced,
      recordException: (exception) => {
        if (traced) {
          span.exceptions.push(exception);
        }
      },
      setAttribute: (key, value) => {
        if (traced) {
          span.attributes.set(key, value);
        }
      },
    };
  };

  const root = open(ROOT);

  return {
    spans: () =>
      opened.map((span) => ({
        attributes: new Map(span.attributes),
        ended: span.ended,
        exceptions: [...span.exceptions],
        name: span.name,
        parent: span.parent,
      })),
    tracing: {
      getActiveSpan: () => root,
      startSpan: (name) => open(name, ROOT),
    },
  };
};

const untracedSpan: WorkerSpan = {
  end: constVoid,
  isTraced: false,
  recordException: constVoid,
  setAttribute: constVoid,
};

/** A runtime outside workerd, where no invocation is traced: every span is a no-op. */
export const untracedTracing: WorkerTracing = {
  getActiveSpan: constUndefined,
  startSpan: () => untracedSpan,
};

export class SpansRecorded extends Context.Service<
  SpansRecorded,
  { readonly spans: Effect.Effect<readonly RecordedSpan[]> }
>()("telemetry/SpansRecorded") {}

export const SpansMemory = (
  scrub: Scrub = identity,
  traced = true
): Layer.Layer<SpansRecorded> =>
  Layer.unwrap(
    Effect.sync(() => {
      const recording = recordingTracing(traced);

      return Layer.merge(
        SpansBinding(recording.tracing, scrub),
        Layer.succeed(
          SpansRecorded,
          SpansRecorded.of({ spans: Effect.sync(recording.spans) })
        )
      );
    })
  );
