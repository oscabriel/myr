/**
 * The evaluator's side inside the sandbox (a `bun` subprocess here, a Dynamic
 * Worker in W3): it hands what the config folder's modules exported back as
 * data, which the sandbox's main sends as JSON, so functions and
 * non-enumerable properties drop out and the host decodes the rest; and it
 * finds a function-valued rule to call. It imports only `effect`, which the
 * sdk brings anyway, so a bundler can inline it beside the sdk.
 */
import { Predicate } from "effect";
import type { Schema } from "effect";

/**
 * What a config module's default export is: the sdk's definition, plain
 * data shaped as `PolicyInput` or `AskInput` once encoded. A function-valued
 * rule rides on the project's definition as an own property named after the
 * rule (`opensAlone`, `admit`) that JSON leaves out: the sdk makes it
 * non-enumerable, and `functions` in the data says it exists.
 */
export type Definition = Schema.Json;

/** A function-valued rule: called with the facts its caller passes. */
export type Rule = (facts: Schema.Json) => boolean | Promise<boolean>;

/** One module's default export, by the module's path in the bundle. */
export interface Exported {
  readonly definition: Definition | undefined;
  readonly path: string;
}

/** The modules' data, as the host reads it back (`Collected` there). */
export interface CollectedData {
  readonly asks: readonly {
    readonly ask: Schema.Json;
    readonly path: string;
  }[];
  readonly project?: Schema.Json;
}

/** A module with no default export gives `null`, which the host refuses. */
const dataOf = (definition: Definition | undefined): Schema.Json =>
  definition ?? null;

/** Collects the project module's data (when the folder has one) and every ask's. */
export const collect = (
  project: Exported | undefined,
  asks: readonly Exported[]
): CollectedData => {
  const collected = asks.map(({ definition, path }) => ({
    ask: dataOf(definition),
    path,
  }));

  return project === undefined
    ? { asks: collected }
    : { asks: collected, project: dataOf(project.definition) };
};

const isRule = (value: unknown): value is Rule => Predicate.isFunction(value);

/** The project definition's function-valued rule, when it has one. */
export const ruleOf = (
  definition: Definition | undefined,
  rule: string
): Rule | undefined => {
  if (definition === undefined || definition === null) {
    return undefined;
  }

  const found: unknown = Object.getOwnPropertyDescriptor(
    definition,
    rule
  )?.value;

  return isRule(found) ? found : undefined;
};
