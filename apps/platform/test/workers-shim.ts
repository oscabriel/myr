/**
 * `cloudflare:workers` for tests in Node. `vitest.config.ts` aliases the
 * module here, so the Worker's modules load outside workerd: config
 * aliasing, not module mocking. Each class keeps what its constructor is
 * given and does nothing else; `env` is a fake whose bindings throw when
 * touched (`fake-env.ts`).
 */
import { fakeEnv } from "./fake-env.ts";

export class DurableObject<E = Env> {
  readonly ctx: DurableObjectState;

  readonly env: E;

  constructor(ctx: DurableObjectState, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkflowEntrypoint<E = Env> {
  readonly ctx: ExecutionContext;

  readonly env: E;

  constructor(ctx: ExecutionContext, env: E) {
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
