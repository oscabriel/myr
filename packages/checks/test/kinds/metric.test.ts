import { describe, expect, it } from "@effect/vitest";
import { JsonPath } from "@repo/protocol/domain/common";
import { Option, Result } from "effect";

import type { CountUnreadable } from "../../src/kinds/lint-count.ts";
import { readMetric } from "../../src/kinds/metric.ts";

const report = '{"total": 412, "parts": [{"kb": 3}, {"kb": 9}]}';

const read = (output: string, path: string) =>
  readMetric(output, JsonPath.make(path));

const unreadHead = (result: Result.Result<number, CountUnreadable>) =>
  Result.match(result, {
    onFailure: ({ head }) => Option.some(head),
    onSuccess: () => Option.none(),
  });

describe(readMetric, () => {
  it.each([
    ["$.total", 412],
    ["$.parts[0].kb", 3],
    ["$.parts[1].kb", 9],
  ])("reads %s from a command's JSON", (path, expected) => {
    expect(read(report, path)).toStrictEqual(Result.succeed(expected));
  });

  it("reads `$` as the whole output when the command prints one number", () => {
    expect(read("17\n", "$")).toStrictEqual(Result.succeed(17));
  });

  it.each([
    ["a key the output lacks", "$.missing"],
    ["an index past the array's end", "$.parts[2].kb"],
    ["a key on an array", "$.parts.kb"],
    ["an index on an object", "$[0]"],
  ])("finds no count at %s", (_label, path) => {
    expect(unreadHead(read(report, path))).toStrictEqual(Option.some(report));
  });

  it.each([
    ["a fraction", '{"total": 4.5}'],
    ["a string", '{"total": "412"}'],
    ["null", '{"total": null}'],
    ["an object", '{"total": {"lines": 3}}'],
  ])("refuses %s as a count", (_label, output) => {
    expect(unreadHead(read(output, "$.total"))).toStrictEqual(
      Option.some(output)
    );
  });

  it.each([
    ["no leading $", "total"],
    ["recursive descent", "$..total"],
    ["a wildcard", "$.parts[*].kb"],
    ["a bracketed key", "$['total']"],
    ["a filter", "$.parts[?(@.kb > 1)].kb"],
    ["a negative index", "$.parts[-1].kb"],
    ["a trailing dot", "$.total."],
  ])("reads no path beyond `$`, `.key` and `[index]`: %s", (_label, path) => {
    expect(unreadHead(read(report, path))).toStrictEqual(Option.some(report));
  });

  it("keeps the first 200 characters of output that isn't JSON", () => {
    const output = `Error: counter crashed\n${"at frame\n".repeat(40)}`;

    expect(unreadHead(read(output, "$.total"))).toStrictEqual(
      Option.some(output.slice(0, 200))
    );
  });
});
