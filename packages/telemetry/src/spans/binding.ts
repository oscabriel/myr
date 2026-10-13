// Effect's spans onto a Worker's trace, through its `tracing`. Each span opens
// with `startSpan`, which the runtime never makes active, and workerd has no
// way to make a span active once it is open: every span opened here is a
// child of the invocation's root span, a sibling of the others and of the
// runtime's own (fetch, RPC, D1, storage) opened while it runs. Effect keeps
// the nesting; the trace shows each span's name, timing, ids and failures.
import { Cause, Exit, Layer, Predicate, Tracer } from "effect";

import type { Scrub } from "../logger.ts";
import { INVOCATION_KEYS, InvocationSpan, SPAN_KEYS } from "../spans.ts";
import type {
  InvocationIds,
  SpanValue,
  WorkerSpan,
  WorkerTracing,
} from "../spans.ts";

const isSpanValue = (value: unknown): value is SpanValue =>
  Predicate.isString(value) ||
  Predicate.isNumber(value) ||
  Predicate.isBoolean(value);

// A typed failure is a refusal or a port's error: its tag says what it was.
// Only a defect brings its message and stack, scrubbed.
const recordFailures = <A, E>(
  span: WorkerSpan,
  exit: Exit.Exit<A, E>,
  scrub: Scrub
) => {
  if (Exit.isSuccess(exit)) {
    return;
  }

  for (const reason of exit.cause.reasons) {
    if (Cause.isFailReason(reason)) {
      const failure = reason.error;

      span.recordException({
        name:
          Predicate.hasProperty(failure, "_tag") &&
          Predicate.isString(failure._tag)
            ? failure._tag
            : "Failure",
      });
    }

    if (Cause.isDieReason(reason)) {
      for (const error of Cause.prettyErrors(Cause.fromReasons([reason]))) {
        span.recordException({
          message: scrub(error.message),
          name: error.name,
          stack: scrub(error.stack ?? ""),
        });
      }
    }
  }
};

const mirrored = (
  span: Tracer.NativeSpan,
  mirror: WorkerSpan | undefined,
  scrub: Scrub
): Tracer.Span => {
  const traced = mirror?.isTraced === true ? mirror : undefined;

  return {
    _tag: span._tag,
    addLinks: (links) => {
      span.addLinks(links);
    },
    annotations: span.annotations,
    attribute: (key, value) => {
      span.attribute(key, value);

      if (traced !== undefined && SPAN_KEYS.has(key) && isSpanValue(value)) {
        traced.setAttribute(key, value);
      }
    },
    get attributes() {
      return span.attributes;
    },
    end: (endTime, exit) => {
      span.end(endTime, exit);

      if (traced !== undefined) {
        recordFailures(traced, exit, scrub);
      }

      mirror?.end();
    },
    event: (name, startTime, attributes) => {
      span.event(name, startTime, attributes);
    },
    kind: span.kind,
    links: span.links,
    name: span.name,
    parent: span.parent,
    sampled: span.sampled,
    get spanId() {
      return span.spanId;
    },
    get status() {
      return span.status;
    },
    get traceId() {
      return span.traceId;
    },
  };
};

/**
 * A `client` span (fetch, RPC, D1, storage) is the runtime's own to trace,
 * with what it carries, and SQL's run once per statement: none is opened twice.
 */
export const tracerOver = (
  tracing: WorkerTracing,
  scrub: Scrub
): Tracer.Tracer =>
  Tracer.make({
    span: (options) =>
      mirrored(
        new Tracer.NativeSpan(options),
        options.sampled && options.kind !== "client"
          ? tracing.startSpan(options.name)
          : undefined,
        scrub
      ),
  });

const annotateRoot = (tracing: WorkerTracing) => (ids: InvocationIds) => {
  const root = tracing.getActiveSpan();

  if (root?.isTraced !== true) {
    return;
  }

  for (const key of INVOCATION_KEYS) {
    const value = ids[key];

    if (value !== undefined) {
      root.setAttribute(key, value);
    }
  }
};

export const SpansBinding = (
  tracing: WorkerTracing,
  scrub: Scrub
): Layer.Layer<never> =>
  Layer.mergeAll(
    Layer.succeed(Tracer.Tracer, tracerOver(tracing, scrub)),
    Layer.succeed(InvocationSpan, { annotate: annotateRoot(tracing) })
  );
