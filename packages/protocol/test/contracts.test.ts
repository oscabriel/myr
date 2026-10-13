import { describe, expect, it } from "@effect/vitest";
import { Context, Option, Redacted, Schema, SchemaAST } from "effect";
import { RpcSchema } from "effect/rpc";
import { expectTypeOf } from "vitest";

import {
  Audience,
  Cli,
  Description,
  Destructive,
  Idempotent,
  NeedsApproval,
  ReadOnly,
  SurfaceName,
  Surfaces,
  Visibility,
} from "../src/annotations.ts";
import {
  Contracts,
  partsOf,
  ProposeAsk,
  SetEnv,
  surfaced,
  Watch,
} from "../src/contracts.ts";
import type { Contract, TagOn } from "../src/contracts.ts";
import { ProjectEvent } from "../src/domain/event.ts";
import { toJsonSchema } from "../src/mcp.ts";
import { examples } from "./contract-examples.ts";
import type { Example } from "./contract-examples.ts";

/**
 * The contracts table, row by row and in its order. CLI: the command's name,
 * then the fields it takes in order; `none` for a contract with no command.
 * Flags: R reads only, I idempotent, D destructive, A needs a person's
 * approval. Surfaces: R rpc, M mcp, C cli, W web.
 */
const table = [
  {
    audience: "public",
    cli: "projects",
    errors: [],
    flags: "RI",
    on: "RMCW",
    tag: "listProjects",
  },
  {
    audience: "public",
    cli: "none",
    errors: [],
    flags: "RI",
    on: "RMW",
    tag: "recentLandings",
  },
  {
    audience: "public",
    cli: "front",
    errors: [],
    flags: "RI",
    on: "RMCW",
    tag: "frontPage",
  },
  {
    audience: "public",
    cli: "asks",
    errors: ["UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "listAsks",
  },
  {
    audience: "public",
    cli: "ask <ask>",
    errors: ["UnknownProject", "UnknownAsk"],
    flags: "RI",
    on: "RMCW",
    tag: "showAsk",
  },
  {
    audience: "signedIn",
    cli: "status",
    errors: ["UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "status",
  },
  {
    audience: "public",
    cli: "verdict <ask>",
    errors: ["UnknownProject", "UnknownAsk"],
    flags: "RI",
    on: "RMCW",
    tag: "verdict",
  },
  {
    audience: "public",
    cli: "landing",
    errors: ["UnknownProject", "UnknownCommit"],
    flags: "RI",
    on: "RMCW",
    tag: "landing",
  },
  {
    audience: "public",
    cli: "credits",
    errors: [],
    flags: "RI",
    on: "RMCW",
    tag: "credits",
  },
  {
    audience: "decider",
    cli: "today",
    errors: ["NotDecider", "UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "today",
  },
  {
    audience: "public",
    cli: "ledger",
    errors: ["UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "ledger",
  },
  {
    audience: "public",
    cli: "env shape",
    errors: ["UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "envShape",
  },
  {
    audience: "public",
    cli: "none",
    errors: ["UnknownProject"],
    flags: "R",
    on: "RW",
    tag: "watch",
  },
  {
    audience: "public",
    cli: "none",
    errors: ["UnknownProject"],
    flags: "RI",
    on: "RMW",
    tag: "listRefs",
  },
  {
    audience: "public",
    cli: "none",
    errors: ["UnknownProject", "UnknownRevision", "UnknownPath"],
    flags: "RI",
    on: "RMW",
    tag: "readTree",
  },
  {
    audience: "public",
    cli: "none",
    errors: ["UnknownProject", "UnknownRevision"],
    flags: "RI",
    on: "RW",
    tag: "listPaths",
  },
  {
    audience: "public",
    cli: "none",
    errors: ["UnknownProject", "UnknownRevision", "UnknownPath"],
    flags: "RI",
    on: "RMW",
    tag: "readFile",
  },
  {
    audience: "public",
    cli: "none",
    errors: ["UnknownProject", "UnknownRevision"],
    flags: "RI",
    on: "RMW",
    tag: "log",
  },
  {
    audience: "public",
    cli: "none",
    errors: ["UnknownProject", "UnknownCommit"],
    flags: "RI",
    on: "RW",
    tag: "showCommit",
  },
  {
    audience: "public",
    cli: "none",
    errors: ["UnknownProject", "UnknownRevision", "UnknownPath"],
    flags: "RI",
    on: "RMW",
    tag: "why",
  },
  {
    audience: "public",
    cli: "policy",
    errors: ["UnknownProject"],
    flags: "RI",
    on: "RMCW",
    tag: "projectPolicy",
  },
  {
    audience: "public",
    cli: "proposal <proposal>",
    errors: ["UnknownProject", "UnknownProposal"],
    flags: "RI",
    on: "RMCW",
    tag: "showProposal",
  },
  {
    audience: "signedIn",
    cli: "init",
    errors: ["ProjectExists", "NotYourNamespace", "ImportFailed"],
    flags: "A",
    on: "RMCW",
    tag: "initProject",
  },
  {
    audience: "decider",
    cli: "ask open <ask>",
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
    cli: "propose",
    errors: ["UnknownProject", "Denounced", "CapReached", "NotVouched"],
    flags: "",
    on: "RMCW",
    tag: "proposeAsk",
  },
  {
    audience: "signedIn",
    cli: "ask draft <proposal>",
    errors: [
      "UnknownProject",
      "UnknownProposal",
      "ProposalClosed",
      "NotDecider",
      "DraftInProgress",
      "CapReached",
    ],
    flags: "",
    on: "RMCW",
    tag: "draftAsk",
  },
  {
    audience: "signedIn",
    cli: "ask flag <ask>",
    errors: ["UnknownProject", "UnknownAsk", "Denounced", "CapReached"],
    flags: "",
    on: "RMC",
    tag: "flagAsk",
  },
  {
    audience: "decider",
    cli: "decide",
    errors: [
      "UnknownProject",
      "UnknownDecision",
      "DecisionClosed",
      "NotDecider",
      "VerifierBlocked",
      "StaleBase",
    ],
    flags: "A",
    on: "RMCW",
    tag: "decide",
  },
  {
    audience: "signedIn",
    cli: "claim <ask>",
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
    cli: "release <ask>",
    errors: ["UnknownProject", "NotClaimed"],
    flags: "I",
    on: "RMC",
    tag: "release",
  },
  {
    audience: "signedIn",
    cli: "submit <ask>",
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
    cli: "finish <ask>",
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
    cli: "land",
    errors: ["UnknownProject", "NotDecider", "StaleBase", "RepoBusy"],
    flags: "IA",
    on: "RMC",
    tag: "land",
  },
  {
    audience: "signedIn",
    cli: "fork",
    errors: ["UnknownProject", "NotVouched", "Denounced"],
    flags: "I",
    on: "RMC",
    tag: "fork",
  },
  {
    audience: "decider",
    cli: "vouch",
    errors: ["UnknownProject", "NotDecider", "StaleBase"],
    flags: "A",
    on: "RMC",
    tag: "vouch",
  },
  {
    audience: "signedIn",
    cli: "evidence <ref>",
    errors: ["UnknownProject", "NotDecider"],
    flags: "RI",
    on: "RC",
    tag: "evidence",
  },
  {
    audience: "decider",
    cli: "env set",
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

const decodes = (payload: typeof Schema.Json.Type) =>
  Schema.decodeUnknownOption(ProposeAsk.payloadSchema)(payload)._tag;

type CodeRead =
  | "listPaths"
  | "listRefs"
  | "log"
  | "readFile"
  | "readTree"
  | "showCommit"
  | "why";

type UncappedRead = "listPaths" | "showCommit";

const letterOf = {
  cli: "C",
  mcp: "M",
  rpc: "R",
  web: "W",
} as const satisfies Record<SurfaceName, string>;

const surfacesOf = (letters: string): readonly SurfaceName[] =>
  SurfaceName.literals.filter((surface) => letters.includes(letterOf[surface]));

const contracts = [...Contracts.requests.values()];

const commandOf = (rpc: Contract) => {
  const cli = Context.getOrUndefined(rpc.annotations, Cli);

  if (cli?.name === undefined) {
    return "none";
  }

  return [
    cli.name,
    ...(cli.positional ?? []).map((field) => `<${field}>`),
  ].join(" ");
};

const refusalsOf = (error: Schema.Top) => {
  const { ast } = error;

  if (SchemaAST.isNever(ast)) {
    return [];
  }

  return (SchemaAST.isUnion(ast) ? ast.types : [ast]).map(
    SchemaAST.resolveIdentifier
  );
};

const roundTrip = (rpc: Contract, example: Example) => {
  const { success } = partsOf(rpc);

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

  it("names each contract's command, and the fields it takes in order", () => {
    expect(
      contracts.map((rpc) => ({ cli: commandOf(rpc), tag: rpc._tag }))
    ).toStrictEqual(table.map(({ cli, tag }) => ({ cli, tag })));
  });

  it("sets each contract's visibility explicitly, keeping only a maintainer's Today and decisions, and a lane's log, to maintainers", () => {
    expect(
      contracts.flatMap((rpc) => {
        const visibility = Context.getOrUndefined(rpc.annotations, Visibility);

        return visibility === "public" ? [] : [{ tag: rpc._tag, visibility }];
      })
    ).toStrictEqual([
      { tag: "today", visibility: "maintainers" },
      { tag: "decide", visibility: "maintainers" },
      { tag: "evidence", visibility: "maintainers" },
    ]);
  });

  it("lets each contract refuse only with its own subset of refusals", () => {
    expect(
      contracts.map((rpc) => ({
        errors: refusalsOf(partsOf(rpc).error),
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

  // A bare number admits "Infinity" and "NaN", and `Schema.optional` admits
  // null; MCP tool schemas would carry both.
  it("gives every payload and success a JSON Schema with no non-finite number and no null", () => {
    const leaky = contracts.flatMap((rpc) => {
      const { success } = partsOf(rpc);

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
    expect(encoded.value).toBe("not-a-real-value-0123456789abcdef");
    expect(JSON.stringify(decoded)).toContain('"value":"<redacted>"');
    expect(JSON.stringify(decoded)).not.toContain(encoded.value);
  });

  it("takes a drafted proposal with no files and no sealed answer", () => {
    const want = { project: "datekit", want: "Parse ISO weeks." };

    const files = [{ content: "x", path: "config/asks/a.ask.ts" }];

    const sealed = { head: "3".repeat(40) };

    expect([
      decodes({ ...want, draft: true }),
      decodes({ ...want, draft: true, files }),
      decodes({ ...want, draft: true, sealed }),
      decodes({ ...want, files }),
      decodes({ ...want, draft: false }),
    ]).toStrictEqual(["Some", "None", "None", "Some", "None"]);
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
      Exclude<Contract["_tag"], UncappedRead | "evidence" | "setEnv" | "watch">
    >();
    expectTypeOf<TagOn<"cli">>().toEqualTypeOf<
      Exclude<Contract["_tag"], CodeRead | "recentLandings" | "watch">
    >();
  });

  it("never gives MCP a stream, a contract that carries a write-only value, or a lane's log", () => {
    const mcp = [...surfaced("mcp").requests.values()];

    expect(mcp.map(({ _tag }) => _tag)).not.toContain("setEnv");
    expect(mcp.map(({ _tag }) => _tag)).not.toContain("evidence");
    expect(
      mcp.flatMap((rpc) =>
        RpcSchema.isStreamSchema(rpc.successSchema) ? [rpc._tag] : []
      )
    ).toStrictEqual([]);
  });
});
