import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { RepoPath } from "../src/ids.ts";
import { groups, Refusal, StaleBase } from "../src/refusal.ts";
import { base, examples, main } from "./examples.ts";

// What Effect's MCP server sends for a declared tool failure that has no
// message: the failure schema's encoding, through JSON.stringify
// (`effect/src/ai/McpServer.ts` l.1864-1867 in 4.0.1).
const overTheWire = (refusal: Refusal) =>
  JSON.stringify(Schema.encodeSync(Refusal)(refusal));

describe("the refusal union", () => {
  it("reaches MCP as JSON with its tag, fields, retryable and next", () => {
    const refusal = new StaleBase({
      base,
      conflicts: [RepoPath.make("src/a.ts")],
      main,
    });

    expect(refusal.message).toBe("");
    expect(JSON.parse(overTheWire(refusal))).toStrictEqual({
      _tag: refusal._tag,
      base,
      conflicts: ["src/a.ts"],
      main,
      next: "git pull --rebase",
      retryable: true,
    });
  });

  it.each(examples)("$_tag comes back from the wire as it left", (refusal) => {
    const decoded = Schema.decodeUnknownSync(Refusal)(
      JSON.parse(overTheWire(refusal))
    );

    expect(decoded.message).toBe("");
    expect(decoded).toStrictEqual(refusal);
  });

  // MCP tool schemas come from this document. A bare `Schema.Number` admits
  // the strings "Infinity" and "NaN"; a bare `Schema.optional` admits `null`.
  it("has a JSON Schema with no non-finite numbers and no nulls", () => {
    const document = JSON.stringify(Schema.toJsonSchemaDocument(Refusal));

    expect(document).not.toMatch(/Infinity|NaN|"null"/u);
  });

  it("files every member under exactly one group, in union order", () => {
    expect(
      groups.flatMap((group) =>
        group.members.map((member) => member.identifier)
      )
    ).toStrictEqual(Refusal.members.map((member) => member.identifier));
  });

  // A failure here means a tag was added, removed or renamed, or a refusal
  // changed whether retrying helps. Both are public contract: rename a tag only
  // with an alias, and update the reference docs.
  it("is closed: exactly these tags, each saying whether retrying can help", () => {
    expect(Refusal.members.map((member) => member.identifier)).toStrictEqual(
      examples.map((refusal) => refusal._tag)
    );
    expect(
      Object.fromEntries(
        examples.map((refusal) => [refusal._tag, refusal.retryable])
      )
    ).toStrictEqual({
      AskFull: true,
      AttemptsExhausted: true,
      CapReached: true,
      ChecksFailed: false,
      ClaimLapsed: true,
      Flake: true,
      HeldBackFailed: false,
      IncompleteBrief: false,
      LayerContentInPublicTree: false,
      NoAsk: false,
      NotClaimed: true,
      NotRedFirst: false,
      NotVouched: false,
      OutOfScope: false,
      PostureChange: false,
      PrivatePathInPublicTree: false,
      RepoBusy: true,
      SecretInOutput: false,
      StaleBase: true,
      TouchedJudge: false,
      VerifierBlocked: true,
      WeakCheck: false,
      Weakened: false,
    });
  });
});
