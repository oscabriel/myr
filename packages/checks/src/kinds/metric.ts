/**
 * A ratchet's metric: one integer a project's own command prints in its JSON,
 * found by a small JSONPath (`$`, `.key`, `[index]`, nothing more). Pure: the
 * command runs elsewhere, and this reads what it printed.
 */
import type { JsonPath } from "@repo/protocol/domain/common";
import { Option, Predicate, Result, Schema } from "effect";

import { CountUnreadable } from "./lint-count.ts";

/** One step down a JSON value: an object's key, or an array's index. */
type Step = string | number;

// One step at the start of what is left of a path: `.key` or `[index]`.
const STEP = /^(?:\.(?<key>[\w$-]+)|\[(?<index>\d+)\])/u;

/** A path's steps, or `None` when it leaves the supported subset. */
const stepsOf = (path: string): Option.Option<readonly Step[]> => {
  if (!path.startsWith("$")) {
    return Option.none();
  }

  const steps: Step[] = [];
  let rest = path.slice(1);

  while (rest.length > 0) {
    const found = STEP.exec(rest);
    const key = found?.groups?.key;
    const index = found?.groups?.index;

    if (found === null) {
      return Option.none();
    }

    steps.push(key ?? Number(index));
    rest = rest.slice(found[0].length);
  }

  return Option.some(steps);
};

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value);

/** The value one step down, if the value has it: a key on an object, an index on an array. */
const down = (value: Schema.Json, step: Step): Option.Option<Schema.Json> => {
  if (Predicate.isNumber(step)) {
    return isJsonArray(value)
      ? Option.fromNullishOr(value[step])
      : Option.none();
  }

  return isJsonObject(value) && Object.hasOwn(value, step)
    ? Option.fromNullishOr(value[step])
    : Option.none();
};

/** The value at the end of a path's steps, if the value has every one. */
const walk = (
  value: Schema.Json,
  steps: readonly Step[]
): Option.Option<Schema.Json> => {
  const [step, ...rest] = steps;

  return step === undefined
    ? Option.some(value)
    : Option.flatMap(down(value, step), (next) => walk(next, rest));
};

const decodeJson = Schema.decodeOption(Schema.fromJsonString(Schema.Json));

const isCount = (value: Schema.Json): value is number =>
  Predicate.isNumber(value) && Number.isSafeInteger(value);

/**
 * The integer at `path` in a command's JSON output. Output that isn't JSON,
 * a path outside the subset, a path the output lacks, or anything there but
 * an integer is a `CountUnreadable` holding the output's head.
 */
export const readMetric = (
  output: string,
  path: JsonPath
): Result.Result<number, CountUnreadable> =>
  Result.fromOption(
    Option.flatMap(stepsOf(path), (steps) =>
      Option.flatMap(decodeJson(output), (json) =>
        Option.filter(walk(json, steps), isCount)
      )
    ),
    () => CountUnreadable.of(output)
  );
