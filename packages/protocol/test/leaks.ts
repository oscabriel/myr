// Effect's JSON Schema leaks non-JSON values two ways: a number admitting
// "Infinity", "-Infinity" and "NaN", and an optional key admitting `null`.
import type { Schema } from "effect";
import { Predicate } from "effect";

const NON_FINITE = new Set(["Infinity", "-Infinity", "NaN"]);

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value);

const children = (value: Schema.Json): readonly Schema.Json[] => {
  if (isJsonArray(value)) {
    return value;
  }

  return isJsonObject(value) ? Object.values(value) : [];
};

export const nested = (value: Schema.Json): readonly Schema.Json[] => [
  value,
  ...children(value).flatMap(nested),
];

const admitsNull = (schema: Schema.Json): boolean => {
  if (!isJsonObject(schema)) {
    return false;
  }

  const { anyOf = [], oneOf = [], type = [] } = schema;

  const members = [anyOf, oneOf].flatMap((list) =>
    isJsonArray(list) ? list : []
  );

  return (
    type === "null" ||
    (isJsonArray(type) && type.includes("null")) ||
    members.some(admitsNull)
  );
};

export const leaks = (schema: Schema.Json): readonly string[] =>
  nested(schema).flatMap((value) => {
    if (Predicate.isString(value) && NON_FINITE.has(value)) {
      return [`non-finite string ${value}`];
    }

    if (!isJsonObject(value)) {
      return [];
    }

    const { properties = {}, required = [] } = value;

    if (!isJsonObject(properties)) {
      return [];
    }

    const needed = new Set(isJsonArray(required) ? required : []);

    return Object.entries(properties).flatMap(([key, property]) =>
      !needed.has(key) && admitsNull(property)
        ? [`null under optional key ${key}`]
        : []
    );
  });
