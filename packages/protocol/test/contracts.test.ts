import { describe, expect, it } from "@effect/vitest";
import { Context, Option, Redacted, Schema, SchemaAST } from "effect";
import { RpcSchema } from "effect/rpc";
import { expectTypeOf } from "vitest";

import {
  Audience,
  Description,
  Destructive,
  Idempotent,
  NeedsApproval,
  ReadOnly,
  SurfaceName,
  Surfaces,
} from "../src/annotations.ts";
import { Contracts, SetEnv, surfaced, Watch } from "../src/contracts.ts";
import type { Contract, TagOn } from "../src/contracts.ts";
import { ProjectEvent } from "../src/domain/event.ts";
import { toJsonSchema } from "../src/mcp.ts";
import { examples } from "./contract-examples.ts";
import type { Example } from "./contract-examples.ts";

/**
 * Spec §3.2, row by row and in its order. Flags: R reads only, I idempotent,
 * D destructive, A needs a person's approval. Surfaces: R rpc, M mcp, C cli,
 * W web.
 */
const table = [
  {
    audience: "public",
    errors: [],
    flags: "RI",
    on: "RMCW",
    tag: "listProjects",
  },
  { audience: "public", errors: [], flags: "RI", on: "RMCW", tag: "frontPage" },
  {
    audience: "public",
    errors: ["UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "listAsks",
  },
  {
    audience: "public",
    errors: ["UnknownProject", "UnknownAsk"],
    flags: "RI",
    on: "RMCW",
    tag: "showAsk",
  },
  {
    audience: "signedIn",
    errors: ["UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "status",
  },
  {
    audience: "public",
    errors: ["UnknownProject", "UnknownAsk"],
    flags: "RI",
    on: "RMCW",
    tag: "verdict",
  },
  {
    audience: "public",
    errors: ["UnknownProject", "UnknownCommit"],
    flags: "RI",
    on: "RMCW",
    tag: "landing",
  },
  { audience: "public", errors: [], flags: "RI", on: "RMCW", tag: "credits" },
  {
    audience: "decider",
    errors: ["NotDecider", "UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "today",
  },
  {
    audience: "public",
    errors: ["UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "ledger",
  },
  {
    audience: "public",
    errors: ["UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "envShape",
  },
  {
    audience: "public",
    errors: ["UnknownProject"],
    flags: "R",
    on: "RW",
    tag: "watch",
  },
  {
    audience: "signedIn",
    errors: ["ProjectExists", "ImportFailed"],
    flags: "A",
    on: "RMC",
    tag: "initProject",
  },
  {
    audience: "decider",
    errors: [
      "UnknownProject",
      "NotDecider",
      "NotRedFirst",
      "WeakCheck",
      "IncompleteBrief",
      "TouchedJudge",
      "VerifierBlocked",
      "StaleBase",
    ],
    flags: "A",
    on: "RMC",
    tag: "openAsk",
  },
  {
    audience: "signedIn",
    errors: ["UnknownProject", "Denounced", "CapReached"],
    flags: "",
    on: "RMCW",
    tag: "proposeAsk",
  },
  {
    audience: "signedIn",
    errors: ["UnknownProject", "UnknownAsk", "Denounced", "CapReached"],
    flags: "",
    on: "RMC",
    tag: "flagAsk",
  },
  {
    audience: "decider",
    errors: [
      "UnknownProject",
      "UnknownDecision",
      "DecisionClosed",
      "NotDecider",
    ],
    flags: "A",
    on: "RMCW",
    tag: "decide",
  },
  {
    audience: "signedIn",
    errors: [
      "UnknownProject",
      "UnknownAsk",
      "AskFull",
      "AskBlocked",
      "CapReached",
      "NotVouched",
      "Denounced",
    ],
    flags: "I",
    on: "RMC",
    tag: "claim",
  },
  {
    audience: "signedIn",
    errors: ["UnknownProject", "NotClaimed"],
    flags: "I",
    on: "RMC",
    tag: "release",
  },
  {
    audience: "signedIn",
    errors: [
      "UnknownProject",
      "NotClaimed",
      "ClaimLapsed",
      "StaleBase",
      "RepoBusy",
      "OutOfScope",
      "TouchedJudge",
      "Weakened",
      "ReachedInternals",
      "PrivatePathInPublicTree",
    ],
    flags: "I",
    on: "RMC",
    tag: "submitAnswer",
  },
  {
    audience: "decider",
    errors: [
      "UnknownProject",
      "NotDecider",
      "StaleBase",
      "RepoBusy",
      "TouchedJudge",
    ],
    flags: "IA",
    on: "RMC",
    tag: "finish",
  },
  {
    audience: "decider",
    errors: ["UnknownProject", "NotDecider", "StaleBase", "RepoBusy"],
    flags: "IA",
    on: "RMC",
    tag: "land",
  },
  {
    audience: "signedIn",
    errors: ["UnknownProject", "NotVouched", "Denounced"],
    flags: "I",
    on: "RMC",
    tag: "fork",
  },
  {
    audience: "decider",
    errors: ["UnknownProject", "NotDecider", "StaleBase"],
    flags: "A",
    on: "RMC",
    tag: "vouch",
  },
  {
    audience: "decider",
    errors: [
      "UnknownProject",
      "NotDecider",
      "UnknownEnvItem",
      "NotSensitive",
      "ValueTooShort",
    ],
    flags: "IA",
    on: "RC",
    tag: "setEnv",
  },
] as const;

/** Each surface's letter in the table's Surfaces column. */
const letterOf = {
  cli: "C",
  mcp: "M",
  rpc: "R",
  web: "W",
} as const satisfies Record<SurfaceName, string>;

/** The surfaces a row's letters name, in the annotation's order. */
const surfacesOf = (letters: string): readonly SurfaceName[] =>
  SurfaceName.literals.filter((surface) => letters.includes(letterOf[surface]));

const contracts = [...Contracts.requests.values()];

/** A contract's success and error: a stream's are its element's and its stream error's. */
const schemasOf = (rpc: Contract) =>
  RpcSchema.isStreamSchema(rpc.successSchema)
    ? { error: rpc.successSchema.error, success: rpc.successSchema.success }
    : { error: rpc.errorSchema, success: rpc.successSchema };

/** The refusals an error schema admits, by name: one, a union of several, or none. */
const refusalsOf = (error: Schema.Top) => {
  const { ast } = error;

  if (SchemaAST.isNever(ast)) {
    return [];
  }

  return (SchemaAST.isUnion(ast) ? ast.types : [ast]).map(
    SchemaAST.resolveIdentifier
  );
};

/** A contract's example, decoded with the contract's schemas and encoded back. */
const roundTrip = (rpc: Contract, example: Example) => {
  const { success } = schemasOf(rpc);

  return {
    payload: Schema.encodeSync(rpc.payloadSchema)(
      Schema.decodeUnknownSync(rpc.payloadSchema)(example.payload)
    ),
    success: Schema.encodeSync(success)(
      Schema.decodeUnknownSync(success)(example.success)
    ),
  };
};

describe("the contracts group", () => {
  it("holds every contract of the spec's table, in its order", () => {
    expect([...Contracts.requests.keys()]).toStrictEqual(
      table.map(({ tag }) => tag)
    );
  });

  it("describes every contract", () => {
    const undescribed = contracts.flatMap((rpc) =>
      Context.get(rpc.annotations, Description).trim() === "" ? [rpc._tag] : []
    );

    expect(contracts).toHaveLength(table.length);
    expect(undescribed).toStrictEqual([]);
  });

  // Each is set explicitly: MCP reads a tool with no hints as destructive.
  it("sets each contract's hints and approval explicitly, as the table flags them", () => {
    expect(
      contracts.map((rpc) => ({
        destructive: Context.getOrUndefined(rpc.annotations, Destructive),
        idempotent: Context.getOrUndefined(rpc.annotations, Idempotent),
        needsApproval: Context.getOrUndefined(rpc.annotations, NeedsApproval),
        readOnly: Context.getOrUndefined(rpc.annotations, ReadOnly),
        tag: rpc._tag,
      }))
    ).toStrictEqual(
      table.map(({ flags, tag }) => ({
        destructive: flags.includes("D"),
        idempotent: flags.includes("I"),
        needsApproval: flags.includes("A"),
        readOnly: flags.includes("R"),
        tag,
      }))
    );
  });

  it("says who may call each contract and which surfaces serve it", () => {
    expect(
      contracts.map((rpc) => ({
        audience: Context.getOrUndefined(rpc.annotations, Audience),
        surfaces: Context.getOrUndefined(rpc.annotations, Surfaces),
        tag: rpc._tag,
      }))
    ).toStrictEqual(
      table.map(({ audience, on, tag }) => ({
        audience,
        surfaces: surfacesOf(on),
        tag,
      }))
    );
  });

  it("lets each contract refuse only with its own subset of refusals", () => {
    expect(
      contracts.map((rpc) => ({
        errors: refusalsOf(schemasOf(rpc).error),
        tag: rpc._tag,
      }))
    ).toStrictEqual(table.map(({ errors, tag }) => ({ errors, tag })));
  });

  it.each(table)(
    "$tag decodes its example payload and success, and encodes them back unchanged",
    ({ tag }) => {
      const example = Option.fromUndefinedOr(examples.get(tag));

      const rpc = Option.fromUndefinedOr(Contracts.requests.get(tag));

      expect(Option.isSome(example)).toBeTruthy();
      expect(Option.zipWith(rpc, example, roundTrip)).toStrictEqual(example);
    }
  );

  // AGENTS.md "Effect traps": a bare number admits "Infinity" and "NaN", and
  // `Schema.optional` admits null; MCP tool schemas would carry both.
  it("gives every payload and success a JSON Schema with no non-finite number and no null", () => {
    const leaky = contracts.flatMap((rpc) => {
      const { success } = schemasOf(rpc);

      return [
        [`${rpc._tag}.payload`, rpc.payloadSchema] as const,
        [`${rpc._tag}.success`, success] as const,
      ].flatMap(([name, schema]) => {
        const json = JSON.stringify(toJsonSchema(schema));

        return ['"Infinity"', '"NaN"', '"null"'].flatMap((leak) =>
          json.includes(leak) ? [`${name} admits ${leak}`] : []
        );
      });
    });

    expect(contracts).toHaveLength(table.length);
    expect(leaky).toStrictEqual([]);
  });

  it("takes setEnv's value as the raw string on the wire, and never prints it", () => {
    const sent = examples.get("setEnv")?.payload;

    const decoded = Schema.decodeUnknownSync(SetEnv.payloadSchema)(sent);
    const encoded = Schema.encodeSync(SetEnv.payloadSchema)(decoded);

    expect(Redacted.isRedacted(decoded.value)).toBeTruthy();
    expect(encoded).toStrictEqual(sent);
    expect(encoded.value).toBe("sk_live_0123456789abcdef0123456789");
    expect(JSON.stringify(decoded)).toContain('"value":"<redacted>"');
    expect(JSON.stringify(decoded)).not.toContain(encoded.value);
  });

  it("streams a project's events from watch", () => {
    expect(RpcSchema.isStreamSchema(Watch.successSchema)).toBeTruthy();
    expect(Watch.successSchema.success).toBe(ProjectEvent);
  });
});

describe("the group a surface serves", () => {
  it.each(SurfaceName.literals)(
    "%s carries exactly the contracts the table puts on it",
    (surface) => {
      expect([...surfaced(surface).requests.keys()]).toStrictEqual(
        table.flatMap(({ on, tag }) =>
          on.includes(letterOf[surface]) ? [tag] : []
        )
      );
    }
  );

  // Compile-time: each surface's group is typed by the table its
  // annotations come from, so a tool or command the type names exists.
  it("types each surface's group as the contracts on it", () => {
    expectTypeOf<TagOn<"rpc">>().toEqualTypeOf<Contract["_tag"]>();
    expectTypeOf<TagOn<"mcp">>().toEqualTypeOf<
      Exclude<Contract["_tag"], "setEnv" | "watch">
    >();
    expectTypeOf<TagOn<"cli">>().toEqualTypeOf<
      Exclude<Contract["_tag"], "watch">
    >();
  });

  it("never gives MCP a stream, or a contract that carries a write-only value", () => {
    const mcp = [...surfaced("mcp").requests.values()];

    expect(mcp.map(({ _tag }) => _tag)).not.toContain("setEnv");
    expect(
      mcp.flatMap((rpc) =>
        RpcSchema.isStreamSchema(rpc.successSchema) ? [rpc._tag] : []
      )
    ).toStrictEqual([]);
  });
});
