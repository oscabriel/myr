// The spans port. Effect's own `Tracer` is the port's face: code opens a span
// with `Effect.withSpan` or `Effect.fn("Name")` and never learns where it
// goes. Behind it sits a Worker's `tracing` (`cloudflare:workers`), described
// here by what the bridge uses of it, so no package imports the Workers
// runtime: a Worker hands its own `tracing` to `spans/binding.ts`, and a test
// hands `spans/memory.ts`'s recording one.
import { Context, Effect } from "effect";
import { constVoid } from "effect/Function";

export type SpanValue = string | number | boolean;

/** The part of a workerd span the bridge uses; `cloudflare:workers`' `Span` fits it. */
export interface WorkerSpan {
  /** False when the invocation was not sampled: every call is then a no-op. */
  readonly isTraced: boolean;
  readonly setAttribute: (key: string, value: SpanValue) => void;
  readonly recordException: (exception: {
    readonly name: string;
    readonly message?: string;
    readonly stack?: string;
  }) => void;
  readonly end: () => void;
}

/** The part of `cloudflare:workers`' `tracing` the bridge uses. */
export interface WorkerTracing {
  /** Never made active: a span opened while it is open is its sibling, not its child. */
  readonly startSpan: (name: string) => WorkerSpan;
  /** The invocation's root span while nothing else is active; none outside an invocation. */
  readonly getActiveSpan: () => WorkerSpan | undefined;
}

/**
 * What Issues shows beside each occurrence: ids alone (AGENTS.md principle 7),
 * never a repo, a layer, a path, a check's name or a value.
 */
export interface InvocationIds {
  readonly project?: string;
  readonly ask?: string;
  readonly sha?: string;
  readonly requestId?: string;
  readonly lane?: string;
  /** Refusal tags, comma-joined. */
  readonly refusal?: string;
}

export const INVOCATION_KEYS = [
  "project",
  "ask",
  "sha",
  "requestId",
  "lane",
  "refusal",
] as const satisfies readonly (keyof InvocationIds)[];

/**
 * The span attributes a span may carry onto a Worker's trace; any other key
 * stays in Effect. A library's span (an HTTP client's `url.full`, SQL's
 * `db.query.text`) or a later one of ours cannot put a repo, a path, a query
 * or a value onto a trace by mistake.
 */
export const SPAN_KEYS: ReadonlySet<string> = new Set([
  "ask",
  "attempt",
  "lane",
  "method",
  "phase",
  "project",
  "refusal",
  "requestId",
  "sha",
  "stage",
  "step",
  "target",
]);

export const InvocationSpan = Context.Reference<{
  readonly annotate: (ids: InvocationIds) => void;
}>("telemetry/InvocationSpan", {
  defaultValue: () => ({ annotate: constVoid }),
});

/** Sets ids on the invocation's root span, where Issues reads them; a no-op off a Worker. */
export const annotateInvocation = (ids: InvocationIds): Effect.Effect<void> =>
  InvocationSpan.use(({ annotate }) =>
    Effect.sync(() => {
      annotate(ids);
    })
  );
