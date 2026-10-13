import { fakeEnv } from "./fake-env.ts";

export class DurableObject<E = Env> {
  readonly ctx: DurableObjectState;

  readonly env: E;

  constructor(ctx: DurableObjectState, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint<E = Env> {
  readonly ctx: ExecutionContext;

  readonly env: E;

  constructor(ctx: ExecutionContext, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

export const env = fakeEnv();

// Outside workerd no invocation is traced: every span is a no-op.
export { untracedTracing as tracing } from "@repo/telemetry/spans/memory";
