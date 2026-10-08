import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Result, Schema } from "effect";

import { AnswerReceipt, AnswerView, Verdict } from "../src/domain/answer.ts";
import { Ask, AskListing, Brief } from "../src/domain/ask.ts";
import { CheckSpec, RatchetSpec } from "../src/domain/check.ts";
import { ClaimView } from "../src/domain/claim.ts";
import { Evidence } from "../src/domain/common.ts";
import { AgentTrailer, Credit } from "../src/domain/credit.ts";
import { Decision, Today } from "../src/domain/decision.ts";
import { EnvSchemaView } from "../src/domain/env.ts";
import { ProjectEvent } from "../src/domain/event.ts";
import { FrontPageEntry, ProjectListing } from "../src/domain/front-page.ts";
import { AskKind } from "../src/domain/kind.ts";
import { LandingView } from "../src/domain/landing.ts";
import { Outcome } from "../src/domain/outcome.ts";
import { AskInput, Policy, PolicyInput } from "../src/domain/policy.ts";
import { Proposal } from "../src/domain/proposal.ts";
import { CreditSummary } from "../src/domain/record.ts";
import { RunBlock } from "../src/domain/run.ts";
import { Territory } from "../src/domain/territory.ts";
import {
  LayerManifest,
  Ledger,
  VisibilityPolicy,
} from "../src/domain/visibility.ts";
import { Envelope } from "../src/envelope.ts";
import {
  AreaName,
  AskId,
  BlobSha,
  CheckVersion,
  DecisionId,
  EnvKey,
  Handle,
  KindName,
  LandedSha,
  LandingId,
  LaneName,
  LayerName,
  PatchId,
  ProjectName,
  ProposalId,
  RatchetName,
  RepoName,
  RequestId,
  SuiteRoot,
  TreeSha,
  sameHandle,
} from "../src/ids.ts";
import { Anonymous, Person, Principal } from "../src/principal.ts";
import wire from "./fixtures/domain.json" with { type: "json" };

/** The fixture file: hand-written encoded values, as JSON carries them. */
const Fixture = Schema.Struct({
  refused: Schema.Record(
    Schema.String,
    Schema.Struct({ schema: Schema.NonEmptyString, value: Schema.Json })
  ),
  roundTrip: Schema.Record(Schema.String, Schema.NonEmptyArray(Schema.Json)),
  withoutDefaults: Schema.Json,
});

const fixture = Schema.decodeUnknownSync(Fixture)(wire);

/** A `--json` envelope around `listAsks`'s result. */
const Listed = Envelope(Schema.Struct({ asks: Schema.Array(AskListing) }));

/** Every schema the fixture has examples for, by its key there. */
const schemas = {
  AgentTrailer,
  AnswerReceipt,
  AnswerView,
  Ask,
  AskInput,
  AskKind,
  AskListing,
  Brief,
  CheckSpec,
  ClaimView,
  Credit,
  CreditSummary,
  Decision,
  EnvSchemaView,
  Envelope: Listed,
  Evidence,
  FrontPageEntry,
  LandingView,
  LayerManifest,
  Ledger,
  Outcome,
  Policy,
  PolicyInput,
  Principal,
  ProjectEvent,
  ProjectListing,
  Proposal,
  RatchetSpec,
  RunBlock,
  Territory,
  Today,
  Verdict,
  VisibilityPolicy,
} as const;

const schemaNamed = new Map<string, Schema.Codec<unknown, unknown>>(
  Object.entries(schemas)
);

const examples = Object.entries(schemas).flatMap(([name, schema]) =>
  (fixture.roundTrip[name] ?? []).map((example, index) => ({
    example,
    name: `${name} #${index + 1}`,
    schema,
  }))
);

const refusals = Object.entries(fixture.refused).map(
  ([description, { schema, value }]) => ({
    description,
    schema: schemaNamed.get(schema),
    value,
  })
);

const refuses = (schema: Schema.Codec<unknown, unknown>, input: Schema.Json) =>
  Result.isFailure(Schema.decodeResult(schema)(input));

describe("the domain schemas", () => {
  it("have examples for every schema, and a schema for every example", () => {
    expect(Object.keys(fixture.roundTrip).toSorted()).toStrictEqual(
      Object.keys(schemas).toSorted()
    );
    expect(
      refusals.flatMap(({ description, schema }) =>
        schema === undefined ? [description] : []
      )
    ).toStrictEqual([]);
  });

  it.each(examples)(
    "$name decodes its example and encodes it back unchanged",
    ({ example, schema }) => {
      expect(
        Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(example))
      ).toStrictEqual(example);
    }
  );

  it.each(refusals)("refuse $description", ({ schema, value }) => {
    expect(schema !== undefined && refuses(schema, value)).toBeTruthy();
  });

  // MCP tool schemas and the reference docs come from these documents. A bare
  // `Schema.Number` admits "Infinity" and "NaN"; a bare `Schema.optional`
  // admits `null`.
  it.each([
    ["Policy", Policy],
    ["Verdict", Verdict],
    ["Outcome", Outcome],
    ["ProjectEvent", ProjectEvent],
    ["VisibilityPolicy", VisibilityPolicy],
    ["LayerManifest", LayerManifest],
  ] as const)(
    "%s has a JSON Schema with no non-finite numbers and no nulls",
    (_name, schema) => {
      const document = JSON.stringify(Schema.toJsonSchemaDocument(schema));

      expect(document).not.toMatch(/Infinity|NaN|"null"/u);
    }
  );

  it("fill the defaults for every key the config folder may leave out", () => {
    expect(
      Schema.decodeUnknownSync(PolicyInput)(fixture.withoutDefaults)
    ).toMatchObject({
      agents: "trailer",
      budget: { decisionsPerDay: 5, expireDays: 14 },
      caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
      claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
      record: { countsAfterDays: 30, windowDays: 365 },
      vouch: { file: `${Brand.configDir}/vouched.td`, mode: "forCode" },
    });
  });

  // A span the config folder writes as `"-1 days"` is a valid string to the
  // sdk; the policy is where a count or a span that can't hold is refused.
  const [kind] = wire.withoutDefaults.kinds;

  it.each([
    ["budget", { budget: { decisionsPerDay: 0, expireDays: 14 } }],
    ["budget", { budget: { decisionsPerDay: 5, expireDays: -1 } }],
    ["caps", { caps: { claimsPerPerson: 0, proposalsPerPerson: 2 } }],
    ["caps", { caps: { claimsPerPerson: 3, proposalsPerPerson: -1 } }],
    ["claims", { claims: { lapseAfterMs: 0, warnAfterMs: 7_200_000 } }],
    ["claims", { claims: { lapseAfterMs: 86_400_000, warnAfterMs: -1 } }],
    ["record", { record: { countsAfterDays: -1, windowDays: 365 } }],
    ["record", { record: { countsAfterDays: 30, windowDays: 0 } }],
    ["a kind's race", { kinds: [{ ...kind, race: 0 }] }],
    [
      "a kind's record rule",
      {
        kinds: [{ ...kind, claimers: { record: { area: "x", atLeast: -1 } } }],
      },
    ],
  ] as const)("refuse %s below what can hold", (_name, change) => {
    expect(
      refuses(PolicyInput, { ...wire.withoutDefaults, ...change })
    ).toBeTruthy();
  });

  it("let a project turn proposals off and count a landing at once", () => {
    expect(
      refuses(PolicyInput, {
        ...wire.withoutDefaults,
        caps: { claimsPerPerson: 1, proposalsPerPerson: 0 },
        record: { countsAfterDays: 0, windowDays: 1 },
      })
    ).toBeFalsy();
  });
});

describe("a project's visibility", () => {
  // OSR §4.1's `visibility.ts`, as the data the sdk writes for it.
  const [stated] = wire.roundTrip.VisibilityPolicy;

  const [policy] = wire.roundTrip.Policy;

  it("rides on the policy at a landed commit", () => {
    const withVisibility = { ...policy, visibility: stated };

    expect(
      Schema.encodeSync(Policy)(
        Schema.decodeUnknownSync(Policy)(withVisibility)
      )
    ).toStrictEqual(withVisibility);
  });

  // No `visibility.ts` means no layers and the posture Open (OSR §4.1).
  it("is absent from a policy whose config folder declares none", () => {
    expect(Schema.decodeUnknownSync(Policy)(policy)).not.toHaveProperty(
      "visibility"
    );
  });
});

describe("names and ids", () => {
  // GitHub tells logins apart without case, and claim forks lowercase them,
  // so a vouch file's or a policy's `Alice` is the person signed in as `alice`.
  it("tell two handles apart without case, as sign-in does", () => {
    expect(sameHandle(Handle.make("Alice"), Handle.make("alice"))).toBeTruthy();
    expect(sameHandle(Handle.make("alice"), Handle.make("alicia"))).toBeFalsy();
  });

  it.each(["a--b", "-a", "a-", "A", "a_b", ""])(
    "a project or an ask may not be named %j",
    (name) => {
      expect(refuses(ProjectName, name)).toBeTruthy();
      expect(refuses(AskId, name)).toBeTruthy();
    }
  );

  it.each(["a", "a-b", "iso-week-2", "datekit"])(
    "a project or an ask may be named %j",
    (name) => {
      expect(refuses(ProjectName, name)).toBeFalsy();
      expect(refuses(AskId, name)).toBeFalsy();
    }
  );

  // `--` separates a fork's parts, and `me` and `layer` stand where an ask's
  // name would in a working fork's or a layer's repo name. `open` and `flag`
  // are `<cli> ask`'s subcommands, so `<cli> ask open` could never show an
  // ask named `open`.
  it.each(["me", "layer", "open", "flag"])(
    "an ask may not be named %j",
    (name) => {
      expect(refuses(AskId, name)).toBeTruthy();
      expect(refuses(ProjectName, name)).toBeFalsy();
    }
  );

  // The web serves its own pages and files at these first path segments, so
  // a project so named would be unreachable at `<web>/<project>` (503 #8,
  // 505 #6). An ask may still take them: an ask's page is under its project.
  it.each(["assets", "auth", "icons", "people", "releases", "rpc", "today"])(
    "a project may not be named %j, a path the web takes for itself",
    (name) => {
      expect(refuses(ProjectName, name)).toBeTruthy();
      expect(refuses(AskId, name)).toBeFalsy();
    }
  );

  const tree = "5555555555555555555555555555555555555555";

  const patchId = "6".repeat(64);

  const suite = `sha256:${"7".repeat(64)}`;

  it.each([
    ["LandedSha", "4".repeat(40), "4444", LandedSha],
    ["TreeSha", tree, "g".repeat(40), TreeSha],
    ["BlobSha", tree, `${tree}0`, BlobSha],
    ["PatchId", patchId, tree, PatchId],
    ["RequestId", "push-33333333", "short", RequestId],
    ["ProposalId", "prop-000001", "prop-1", ProposalId],
    ["DecisionId", "dec-0a1b2c", "dec_0a1b2c", DecisionId],
    ["LandingId", "land-000001", "-000001", LandingId],
    ["KindName", "lintToZero", "1fix", KindName],
    ["LayerName", "maintainers", "Maintainers", LayerName],
    ["AreaName", "parse", "parse/iso", AreaName],
    ["LaneName", "unit", "unit tests", LaneName],
    ["RatchetName", "anyCount", "any_count", RatchetName],
    ["EnvKey", "PAYMENTS_KEY", "PAYMENTS-KEY", EnvKey],
    ["SuiteRoot", suite, patchId, SuiteRoot],
    ["CheckVersion", "redThenGreen@0.0.0+abc", "", CheckVersion],
    ["RepoName", "datekit--iso-week--alice", "datekit/iso", RepoName],
  ] as const)("%s takes %j and refuses %j", (_name, good, bad, schema) => {
    expect(refuses(schema, good)).toBeFalsy();
    expect(refuses(schema, bad)).toBeTruthy();
  });

  // A layer's repo is `<project>--<layer>`; a layer named `a--b` would make
  // `<project>--a--b`, which reads as a claim fork (`<project>--<ask>--<handle>`).
  it("names a layer in an ask's words, so its repo never reads as a claim fork", () => {
    expect(
      ["security-review", "maintainers2"].map((name) =>
        refuses(LayerName, name)
      )
    ).toStrictEqual([false, false]);
    expect(
      ["a--b", "triageTeam", "fix-", "x".repeat(0)].map((name) =>
        refuses(LayerName, name)
      )
    ).toStrictEqual([true, true, true, true]);
  });
});

describe("the caller", () => {
  it("is a person named by their handle, or anyone at all", () => {
    expect(
      (fixture.roundTrip.Principal ?? []).map((principal) =>
        Schema.decodeUnknownSync(Principal)(principal)
      )
    ).toStrictEqual([
      Person.make({ handle: Handle.make("alice") }),
      Anonymous.make({}),
    ]);
  });
});
