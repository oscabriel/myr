import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Schema } from "effect";

import { AskId, Handle, LandedSha, RepoPath } from "../src/ids.ts";
import { CapReached, groups, Refusal, StaleBase } from "../src/refusal.ts";
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
      next: `git push ${Brand.slug} HEAD:main`,
      retryable: true,
    });
  });

  it("sends who moved each conflicting path as JSON, and decodes it back", () => {
    const landing = LandedSha.make("3333333333333333333333333333333333333333");

    const moved = new StaleBase({
      base,
      conflicts: [RepoPath.make("src/a.ts")],
      main,
      movedBy: [
        {
          ask: AskId.make("fix-parser"),
          author: Handle.make("alice"),
          landing,
          path: RepoPath.make("src/a.ts"),
        },
      ],
    });

    expect(JSON.parse(overTheWire(moved))).toStrictEqual({
      _tag: moved._tag,
      base,
      conflicts: ["src/a.ts"],
      main,
      movedBy: [
        { ask: "fix-parser", author: "alice", landing, path: "src/a.ts" },
      ],
      next: `git push ${Brand.slug} HEAD:main`,
      retryable: true,
    });
    expect(
      Schema.decodeUnknownSync(Refusal)(JSON.parse(overTheWire(moved)))
    ).toStrictEqual(moved);
  });

  it.each(examples)("$_tag comes back from the wire as it left", (refusal) => {
    const decoded = Schema.decodeUnknownSync(Refusal)(
      JSON.parse(overTheWire(refusal))
    );

    expect(decoded.message).toBe("");
    expect(decoded).toStrictEqual(refusal);
  });

  it("sends a cap's limit and wait as JSON keys, and decodes one without them as before", () => {
    const rate = new CapReached({ cap: 2, limit: "drafts", retryAfter: 60 });
    const held = new CapReached({ cap: 3 });

    expect(JSON.parse(overTheWire(rate))).toStrictEqual({
      _tag: rate._tag,
      cap: 2,
      limit: "drafts",
      next: `${Brand.cli} status`,
      retryAfter: 60,
      retryable: true,
    });
    expect(JSON.parse(overTheWire(held))).toStrictEqual({
      _tag: held._tag,
      cap: 3,
      next: `${Brand.cli} status`,
      retryable: true,
    });
    expect(
      [rate, held].map((refusal) =>
        Schema.decodeUnknownSync(Refusal)(JSON.parse(overTheWire(refusal)))
      )
    ).toStrictEqual([rate, held]);
  });

  it("refuses a cap's wait below one second", () => {
    const zero = {
      ...Schema.encodeSync(CapReached)(
        new CapReached({ cap: 3, retryAfter: 60 })
      ),
      retryAfter: 0,
    };

    expect(() => Schema.decodeUnknownSync(Refusal)(zero)).toThrow(
      /retryAfter/u
    );
  });

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

  it("lists all forty-five tags in union order, group by group", () => {
    expect(Refusal.members.map((member) => member.identifier)).toStrictEqual([
      "NotClaimed",
      "ClaimLapsed",
      "NotVouched",
      "CapReached",
      "AskFull",
      "NoAsk",
      "RepoBusy",
      "DirectPush",
      "AskBlocked",
      "Denounced",
      "OutOfScope",
      "TouchedJudge",
      "Weakened",
      "PrivatePathInPublicTree",
      "ReachedInternals",
      "StaleBase",
      "StaleLayer",
      "ChecksFailed",
      "HeldBackFailed",
      "AttemptsExhausted",
      "Flake",
      "VerifierBlocked",
      "NotRedFirst",
      "WeakCheck",
      "IncompleteBrief",
      "LayerContentInPublicTree",
      "SecretInOutput",
      "UnstatedRequirement",
      "PostureChange",
      "NotDecider",
      "DecisionClosed",
      "ProposalClosed",
      "DraftInProgress",
      "UnknownProject",
      "UnknownAsk",
      "UnknownCommit",
      "UnknownDecision",
      "UnknownPath",
      "UnknownRevision",
      "UnknownProposal",
      "ProjectExists",
      "NotYourNamespace",
      "ImportFailed",
      "UnknownEnvItem",
      "NotSensitive",
      "ValueTooShort",
    ]);
    expect(groups.map((group) => group.name)).toStrictEqual([
      "Push and claim",
      "Shape",
      "Merge",
      "Checks",
      "Never counted against the answerer",
      "At ask open",
      "Maintainers only",
      "Decision",
      "Lookup",
      "Setup",
      "Env",
    ]);
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
      AskBlocked: true,
      AskFull: true,
      AttemptsExhausted: true,
      CapReached: true,
      ChecksFailed: false,
      ClaimLapsed: true,
      DecisionClosed: false,
      Denounced: false,
      DirectPush: false,
      DraftInProgress: true,
      Flake: true,
      HeldBackFailed: false,
      ImportFailed: true,
      IncompleteBrief: false,
      LayerContentInPublicTree: false,
      NoAsk: false,
      NotClaimed: true,
      NotDecider: false,
      NotRedFirst: false,
      NotSensitive: false,
      NotVouched: false,
      NotYourNamespace: false,
      OutOfScope: false,
      PostureChange: false,
      PrivatePathInPublicTree: false,
      ProjectExists: false,
      ProposalClosed: false,
      ReachedInternals: false,
      RepoBusy: true,
      SecretInOutput: false,
      StaleBase: true,
      StaleLayer: true,
      TouchedJudge: false,
      UnknownAsk: false,
      UnknownCommit: false,
      UnknownDecision: false,
      UnknownEnvItem: false,
      UnknownPath: false,
      UnknownProject: false,
      UnknownProposal: false,
      UnknownRevision: false,
      UnstatedRequirement: false,
      ValueTooShort: false,
      VerifierBlocked: true,
      WeakCheck: false,
      Weakened: false,
    });
  });
});
