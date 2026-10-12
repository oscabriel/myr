// Imports only `effect` and the sdk's `Functions` key, which config code
// brings anyway, so a bundler can inline it beside the sdk.
import { Functions } from "@repo/sdk/functions";
import { Predicate } from "effect";
import type { Schema } from "effect";

/** Function-valued rules ride under the sdk's `Functions` symbol, which JSON never meets. */
export type Definition = Schema.Json;

export type Rule = (facts: Schema.Json) => boolean | Promise<boolean>;

export interface Exported {
  readonly definition: Definition | undefined;
  readonly path: string;
}

export interface CollectedData {
  readonly asks: readonly {
    readonly ask: Schema.Json;
    readonly path: string;
  }[];
  readonly project?: Schema.Json;
  readonly visibility?: Schema.Json;
}

const dataOf = (definition: Definition | undefined): Schema.Json =>
  definition ?? null;

export const collect = (
  project: Exported | undefined,
  asks: readonly Exported[],
  visibility?: Exported
): CollectedData => {
  const collected = asks.map(({ definition, path }) => ({
    ask: dataOf(definition),
    path,
  }));

  const withProject: CollectedData =
    project === undefined
      ? { asks: collected }
      : { asks: collected, project: dataOf(project.definition) };

  return visibility === undefined
    ? withProject
    : { ...withProject, visibility: dataOf(visibility.definition) };
};

const isRule = (value: unknown): value is Rule => Predicate.isFunction(value);

export const ruleOf = (
  definition: Definition | undefined,
  rule: string
): Rule | undefined => {
  if (!Predicate.hasProperty(definition, Functions)) {
    return undefined;
  }

  const carried = definition[Functions];

  const found = Predicate.hasProperty(carried, rule)
    ? carried[rule]
    : undefined;

  return isRule(found) ? found : undefined;
};
