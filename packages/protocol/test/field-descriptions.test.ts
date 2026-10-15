import { describe, expect, it } from "@effect/vitest";
import { Context, Predicate, SchemaAST } from "effect";

import { Cli, Contracts } from "../src/contracts.ts";

// A field named for what it holds needs no more words: its name is the help.
const selfNamed = new Set([
  "acknowledgeShort",
  "ask",
  "import",
  "key",
  "project",
  "sha",
  "value",
]);

const undescribed = [...Contracts.requests.values()].flatMap((rpc) => {
  const { name } = Context.get(rpc.annotations, Cli);
  const { ast } = rpc.payloadSchema;

  if (name === undefined || !SchemaAST.isObjects(ast)) {
    return [];
  }

  return ast.propertySignatures.flatMap((field) =>
    Predicate.isString(field.name) &&
    !selfNamed.has(field.name) &&
    SchemaAST.resolveDescription(field.type) === undefined
      ? [`${name} --${field.name}`]
      : []
  );
});

describe("a command's flags", () => {
  it("each say what they take, in --help and in the MCP tool's input schema", () => {
    expect(undescribed).toStrictEqual([]);
  });
});
