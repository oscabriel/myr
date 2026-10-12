// Module text for the Worker Loader: nothing here runs in the platform's own
// isolate except to write it.
import { Functions } from "@repo/sdk/functions";

/**
 * The clock and seed config code sees, injected by the caller: an
 * evaluation's are the landed commit's time and a hash of its SHA; a rule
 * call's are the Unix epoch and 0, so a rule gets time only through its
 * facts (as `/bun` does).
 */
export interface FrozenFacts {
  readonly now: number;
  readonly seed: number;
}

export interface DateClass {
  new (...args: readonly (Date | number | string)[]): Date;
  now: () => number;
  readonly prototype: Date;
}

export interface FreezableScope {
  Date: DateClass;
  readonly Math: { random: () => number };
  readonly crypto: {
    getRandomValues: <T extends ArrayBufferView>(array: T) => T;
    randomUUID: () => string;
  };
  readonly performance: { now: () => number };
}

export interface Frozen {
  /**
   * Puts the randomness back where it stood the first time this was called:
   * the main calls it once its modules are loaded, before each job's own
   * code, so a warm worker gives every job the numbers a fresh one would.
   */
  readonly settle: () => void;
}

/**
 * Serialised into the prelude module with `Function#toString`, so its body
 * names nothing outside itself and defines no function or class a bundler
 * would name (only methods, and functions assigned to a member; an arrow
 * bound to a name or written as an object literal's property value is
 * named): a `keepNames` build, wrangler's default, would otherwise call a
 * naming helper the prelude module doesn't have.
 */
export const installFrozenGlobals = (
  scope: FreezableScope,
  facts: FrozenFacts
): Frozen => {
  const RealDate = scope.Date;
  const frozenAt = facts.now;

  // mulberry32, Tommy Ettinger's seeded 32-bit generator (public domain),
  // the same as `/bun`'s, so both adapters give one seed the same numbers.
  /* oxlint-disable no-bitwise -- mulberry32 is 32-bit integer arithmetic, and it must match /bun's prelude number for number */
  const generator = {
    next(): number {
      generator.state = (generator.state + 0x6d_2b_79_f5) >>> 0;

      let mixed = generator.state;

      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    },
    settled: -1,
    state: facts.seed >>> 0,
  };
  /* oxlint-enable no-bitwise */

  // The frozen `Date` is the scope's own behind a proxy: `new Date()` with
  // no time gets the frozen one, and `Date()` without `new` tells it, as
  // the real one tells the real time. Everything else (`prototype`,
  // `parse`, `UTC`, what sits above it) is the scope's own, so no path
  // leads past it to another clock.
  const frozenDate = new Proxy(RealDate, {
    apply(): string {
      return new RealDate(frozenAt).toString();
    },
    // `newTarget` is the frozen `Date`, or a class config code derived
    // from it, whose prototype the new date takes.
    construct(
      target,
      args: readonly (Date | number | string)[],
      newTarget: DateClass
    ): Date {
      return Reflect.construct(
        target,
        args.length === 0 ? [frozenAt] : args,
        newTarget
      );
    },
  });

  // The scope's own `Date` tells the frozen time too, and every date's
  // constructor (one the runtime makes itself included) is the frozen one.
  RealDate.now = () => frozenAt;

  Object.defineProperty(RealDate.prototype, "constructor", {
    configurable: true,
    value: frozenDate,
    writable: true,
  });

  scope.Date = frozenDate;
  scope.performance.now = () => 0;
  scope.Math.random = () => generator.next();

  scope.crypto.getRandomValues = (array) => {
    const bytes = new Uint8Array(
      array.buffer,
      array.byteOffset,
      array.byteLength
    );

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(generator.next() * 256);
    }

    return array;
  };

  scope.crypto.randomUUID = () => {
    const bytes = scope.crypto.getRandomValues(new Uint8Array(16));

    // A random UUID's version nibble is 4 and its variant bits are 10.
    bytes[6] = ((bytes[6] ?? 0) % 16) + 0x40;
    bytes[8] = ((bytes[8] ?? 0) % 64) + 0x80;

    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  };

  return {
    settle(): void {
      if (generator.settled < 0) {
        generator.settled = generator.state;
      }

      generator.state = generator.settled;
    },
  };
};

export const preludeModule = (facts: FrozenFacts): string =>
  `export const frozen = (${String(installFrozenGlobals)})(globalThis, ${JSON.stringify({ now: facts.now, seed: facts.seed })});\n`;

export const preludeName = "prelude.js";

export const mainName = "main.js";

export interface MainModules {
  readonly asks: readonly string[];
  readonly project?: string | undefined;
  readonly visibility?: string | undefined;
}

const importer = (path: string) =>
  `{ load: () => import(${JSON.stringify(`./${path}`)}), path: ${JSON.stringify(path)} }`;

/**
 * It imports the prelude first, so the clock is frozen before any config code
 * exists, and answers each request with one JSON document:
 *
 * - `{}` → `Collected {asks: [{ask, path}], project?, visibility?}`;
 * - `{rule, facts}` → `Called {result}` (`false` when there is no rule);
 * - either → `Failed {reason: "load" | "threw", detail}`.
 */
export const mainModule = (modules: MainModules): string => `
import { frozen } from "./${preludeName}";

const project = ${modules.project === undefined ? "undefined" : importer(modules.project)};

const asks = [${modules.asks.map(importer).join(", ")}];

const visibility = ${modules.visibility === undefined ? "undefined" : importer(modules.visibility)};

const functions = Symbol.for(${JSON.stringify(Symbol.keyFor(Functions) ?? "")});

// What a module that would not load throws: a syntax error, an import that
// resolves to nothing (workerd), or Bun's build and resolve messages.
const loadErrors = new Set(["BuildMessage", "ResolveMessage", "SyntaxError"]);

const isLoadError = (error) =>
  error instanceof AggregateError
    ? error.errors.length > 0 && error.errors.every(isLoadError)
    : loadErrors.has(error?.constructor?.name) || /^No such module/u.test(String(error?.message));

const describe = (error) =>
  error instanceof AggregateError
    ? error.errors.map(describe).join("; ")
    : error instanceof Error
      ? error.name + ": " + error.message
      : String(error);

const failed = (where, error, reason) => ({
  _tag: "Failed",
  detail: where + ": " + describe(error),
  reason: reason ?? (isLoadError(error) ? "load" : "threw"),
});

const imported = async ({ load, path }) => {
  try {
    const module = await load();
    return { exported: { definition: module.default, path } };
  } catch (error) {
    return { failure: failed(path, error) };
  }
};

// A module with no default export gives null, which the host refuses.
const dataOf = (definition) => definition ?? null;

const ruleOf = (definition, rule) => {
  const carries = (value, key) =>
    ((typeof value === "object" && value !== null) || typeof value === "function") && key in value;
  const found = carries(definition, functions) && carries(definition[functions], rule)
    ? definition[functions][rule]
    : undefined;
  return typeof found === "function" ? found : undefined;
};

const run = async (job) => {
  const loaded = project === undefined ? undefined : await imported(project);

  if (loaded?.failure !== undefined) {
    return loaded.failure;
  }

  if (job.rule !== undefined) {
    frozen.settle();
    try {
      const rule = ruleOf(loaded?.exported.definition, job.rule);
      return { _tag: "Called", result: rule === undefined ? false : await rule(job.facts) };
    } catch (error) {
      return failed(job.rule, error, "threw");
    }
  }

  const exported = [];

  for (const ask of asks) {
    const each = await imported(ask);

    if (each.failure !== undefined) {
      return each.failure;
    }

    exported.push(each.exported);
  }

  const stated = visibility === undefined ? undefined : await imported(visibility);

  if (stated?.failure !== undefined) {
    return stated.failure;
  }

  frozen.settle();

  const collected = exported.map(({ definition, path }) => ({ ask: dataOf(definition), path }));

  return {
    _tag: "Collected",
    asks: collected,
    ...(loaded === undefined ? {} : { project: dataOf(loaded.exported.definition) }),
    ...(stated === undefined ? {} : { visibility: dataOf(stated.exported.definition) }),
  };
};

const encoded = (result) => {
  try {
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify(failed("the config folder's exports", error, "threw"));
  }
};

export default {
  async fetch(request) {
    let result;

    try {
      result = await run(await request.json());
    } catch (error) {
      result = failed("the evaluator", error, "load");
    }

    return new Response(encoded(result), { headers: { "content-type": "application/json" } });
  },
};
`;
