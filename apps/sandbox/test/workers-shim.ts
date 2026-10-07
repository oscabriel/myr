/**
 * `cloudflare:workers` for tests in Node. `vitest.config.ts` aliases the
 * module here, for this Worker's modules and the Sandbox SDK's: config
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

export class WorkerEntrypoint<E = Env> {
  readonly ctx: ExecutionContext;

  readonly env: E;

  constructor(ctx: ExecutionContext, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

export const env = fakeEnv();
