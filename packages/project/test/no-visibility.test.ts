/**
 * The project service without the visibility cartridge: over
 * memory adapters with the neutral ports `NoVisibility` and `NoEnv`, a
 * project is Open, declares no layer, keeps an empty ledger and an empty
 * env shape (its committed `.env.schema` notwithstanding), takes no
 * write-only value, pins no held-back suite on a claim, and holds no layer
 * paths. What the cartridge changes, it changes through those two ports.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CheckSpec } from "@repo/protocol/domain/check";
import {
  CommitSha,
  EnvKey,
  LaneName,
  LayerName,
  RepoName,
  keyOf,
  RepoPath,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { NotDecider, UnknownEnvItem } from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, Effect, Layer, Option, Redacted } from "effect";

import { NoEnv } from "../src/env-port.ts";
import { projectService } from "../src/project.ts";
import { NoVisibility } from "../src/visibility-port.ts";
import { CheckScript, composedAt, Pusher, worldOf } from "./world.ts";

const scenario = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const { project } = scenario;

const repo = RepoName.make(keyOf(project));

const alice = Person.make({ handle: scenario.initializer });

const bob = Person.make({
  handle: scenario.people.get("bob") ?? scenario.initializer,
});

const anyone = Anonymous.make({});

/** The first push: a package, and an env schema whose header says nothing. */
const start: Files = [
  [
    "package.json",
    '{ "name": "alice/datekit", "workspaces": ["packages/*"] }\n',
  ],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
  [
    ".env.schema",
    ["# @sensitive", "SENTRY_AUTH_TOKEN=", "", "APP_ENV=dev", ""].join("\n"),
  ],
];

const parseIso = Option.getOrThrow(
  Array.findFirst(scenario.policy.asks, (ask) => ask.id === "parse-iso")
);

/** The ask's own files: its file in the config folder, and its check. */
const askFiles = Array.make(
  { content: 'export default "parse-iso";\n', path: parseIso.file },
  {
    content: [
      'import { expect, it } from "vitest";',
      'import { parser } from "../src/parser.ts";',
      "",
      'it("parse-iso", () => {',
      '  expect(parser(" 2026 ")).toStrictEqual("2026");',
      "});",
      "",
    ].join("\n"),
    path: CheckSpec.guards.RedThenGreen(parseIso.check)
      ? parseIso.check.path
      : RepoPath.make(`${Brand.configDir}/checks/parse-iso.test.ts`),
  }
);

/** Everything a caller can learn of the project's visibility, with nothing plugged in. */
const seen = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);

  yield* api.initProject(alice, {});

  const first = yield* Pusher.use((pusher) =>
    pusher.push(repo, Option.none(), start, "Start")
  );

  const { landed } = yield* api.recordFirstPush(alice, first);
  const composed = yield* composedAt(repo, landed, askFiles);

  yield* CheckScript.use((checker) =>
    checker.script(composed, LaneName.make("redThenGreen"), [
      "failed",
      "failed",
    ])
  );

  yield* api.openAsk(alice, { ask: parseIso.id, files: askFiles });

  const value = Redacted.make("a-value-long-enough-0123");
  const key = EnvKey.make("SENTRY_AUTH_TOKEN");
  const maintainers = LayerName.make("maintainers");
  const head = CommitSha.make("a".repeat(40));

  return {
    access: yield* api.layerAccess(alice, maintainers),
    admission: yield* api.admissionPlan({ head, layer: maintainers }),
    claim: (yield* api.claim(bob, parseIso.id)).claim,
    env: yield* api.envShape(anyone),
    facts: yield* api.layerFacts(bob),
    ledger: yield* api.ledger(anyone),
    scanned: yield* api.scanForValues({ text: Redacted.value(value) }),
    setByBob: yield* Effect.flip(api.setEnv(bob, { key, value })),
    setByDecider: yield* Effect.flip(api.setEnv(alice, { key, value })),
  };
});

/** The project's world over memory adapters, with the neutral ports said out loud. */
const world = Layer.mergeAll(worldOf(scenario, "memory"), NoVisibility, NoEnv);

describe("the project service with no visibility plugged in", () => {
  it.effect(
    "is Open with no layers, an empty ledger and env shape, no values and no pinned suite",
    () =>
      Effect.map(seen.pipe(Effect.provide(world)), (got) => {
        expect({
          access: got.access,
          admission: got.admission,
          env: got.env.items,
          facts: got.facts,
          ledger: got.ledger,
          scanned: got.scanned,
          setByBob: got.setByBob,
          setByDecider: got.setByDecider,
          suite: got.claim.suite,
        }).toStrictEqual({
          access: Option.none(),
          admission: Option.none(),
          env: [],
          facts: { canRead: false, layerPaths: [] },
          ledger: {
            entries: [],
            layers: [],
            posture: "open",
            postureLabel: "Open",
            project,
          },
          scanned: Option.none(),
          setByBob: new NotDecider({}),
          setByDecider: new UnknownEnvItem({
            key: EnvKey.make("SENTRY_AUTH_TOKEN"),
          }),
          suite: undefined,
        });
      })
  );
});
