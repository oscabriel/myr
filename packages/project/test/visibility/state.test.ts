/**
 * The visibility cartridge's project state, through the project
 * service over memory adapters with the live `ProjectVisibility`: a landing
 * that adds datekit's `visibility.ts` provisions the maintainers layer's
 * repo once and declares it in the ledger, and its narrowing waits for a
 * second decider and the notice period; a layer push lands the layer's
 * head and publishes each area's salted commitment; a claim is pinned to
 * the suite sealed when it opened.
 */
import { describe, expect, it } from "@effect/vitest";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  AreaName,
  AskId,
  BlobSha,
  LayerName,
  RepoPath,
} from "@repo/protocol/ids";
import { Anonymous } from "@repo/protocol/principal";
import { NotDecider } from "@repo/protocol/refusal";
import { advanceTo, at } from "@repo/testkit/clock";
import { areaRoots, suiteRoot } from "@repo/visibility/commitment";
import { Array, Effect, Option, Order } from "effect";

import { drive } from "../../src/answer-runs/steps.ts";
import { ProjectStore } from "../../src/project-store.ts";
import { AdmissionRun, ProjectVisibility } from "../../src/visibility-port.ts";
import {
  bob,
  countersigned,
  datekitVisibility,
  firstSuite,
  inesV,
  landOwn,
  layerFiles,
  LayerPusher,
  layerRepo,
  mainFiles,
  maintainers,
  manifestFile,
  okonkwo,
  postureDecisions,
  project,
  pushLayer,
  sealedByInes,
  Seen,
  visibilityFile,
  visibilityWorld,
} from "./world.ts";
import type { SealedFile } from "./world.ts";

const anyone = Anonymous.make({});

/** The project's rows as its store keeps them. */
const stored = ProjectStore.use((store) => store.load());

const exportArea = AreaName.make("export");

const parserArea = AreaName.make("parser");

/** The suite once the `parser` check is rewritten. */
const secondSuite: readonly SealedFile[] = firstSuite.map((check) =>
  check.area === "parser"
    ? { ...check, content: 'it("reads ordinal dates", () => {});\n' }
    : check
);

/** A git blob id, computed as git does: SHA-1 of `blob <size>\0<content>`. */
const blobId = (content: string) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(
        `blob ${new TextEncoder().encode(content).length}\0${content}`
      )
    )
  ).pipe(
    Effect.map((digest) =>
      BlobSha.make(
        [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")
      )
    )
  );

/** The suite's files as the commitment takes them. */
const suiteFiles = (checks: readonly SealedFile[]) =>
  Effect.forEach(checks, ({ area, content, path }) =>
    Effect.map(blobId(content), (blob) => ({
      area: AreaName.make(area),
      blob,
      path: RepoPath.make(path),
    }))
  );

/** Rows of `[path, …]`, sorted by path. */
const byPath = (rows: readonly (readonly [string, ...string[]])[]) =>
  Array.sort(
    rows,
    Order.mapInput(
      Order.String,
      ([path]: readonly [string, ...string[]]) => path
    )
  );

const parseIso = AskId.make("parse-iso");

const trimInput = AskId.make("trim-input");

const hexOf = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

describe("a landing that adds the visibility config", () => {
  it.effect(
    "provisions the layer's repo once and declares the layer in the ledger",
    () =>
      Effect.gen(function* () {
        const { api, request } = yield* sealedByInes;

        // The same landing again, and the outbox run again by the alarm.
        yield* api.land(inesV, request);
        yield* drive(api, request.requestId);
        yield* api.onAlarm();

        const { entries, layers } = yield* api.ledger(anyone);

        expect({
          created: yield* Seen.use(({ created }) => created),
          entries,
          layers: layers.map(({ name, repo }) => [name, repo]),
          rows: (yield* stored).layers.map(({ name, repo }) => [name, repo]),
        }).toStrictEqual({
          created: [layerRepo],
          entries: [
            LedgerEntry.cases.LayerDeclared.make({
              at: at("2026-10-07T12:00:00Z"),
              disclose: "sealed",
              kinds: ["checks", "notes"],
              layer: maintainers,
              seq: 1,
            }),
          ],
          layers: [[maintainers, layerRepo]],
          rows: [[maintainers, layerRepo]],
        });
      }).pipe(Effect.provide(visibilityWorld()))
  );

  it.effect(
    "narrows the posture only once a second decider accepts and the notice has run",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;
        const [opened] = yield* postureDecisions(api);
        const decision = Option.getOrThrow(Option.fromUndefinedOr(opened));
        const before = yield* api.ledger(anyone);

        const byInes = yield* api
          .decide(inesV, { choice: "accept", decision: decision.id })
          .pipe(Effect.flip);

        yield* advanceTo("2026-10-08T12:00:00Z");
        yield* api.decide(okonkwo, { choice: "accept", decision: decision.id });

        const accepted = yield* api.ledger(anyone);

        yield* advanceTo("2026-10-14T11:59:59Z");

        const lastSecond = yield* api.ledger(anyone);

        yield* advanceTo("2026-10-14T12:00:00Z");

        const after = yield* api.ledger(anyone);

        expect({
          byInes,
          decision: {
            deciders: decision.deciders,
            default: decision.default,
            subject: decision.subject,
          },
          postures: [before, accepted, lastSecond, after].map(
            ({ posture, postureLabel }) => [posture, postureLabel]
          ),
        }).toStrictEqual({
          byInes: new NotDecider({}),
          decision: {
            deciders: [okonkwo.handle],
            default: "decline",
            subject: DecisionSubject.cases.PostureChange.make({
              from: "open",
              to: "openWithSealedEvidence",
            }),
          },
          postures: [
            ["open", "Open"],
            ["open", "Open"],
            ["open", "Open"],
            [
              "openWithSealedEvidence",
              "Open with sealed evidence · sealed checks in export, parser",
            ],
          ],
        });
      }).pipe(Effect.provide(visibilityWorld()))
  );

  it.effect(
    "keeps the posture when nobody decides: the decision takes its default, decline",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;

        yield* advanceTo("2026-11-07T12:00:00Z");
        yield* api.onAlarm();

        const decisions: readonly Decision[] = (yield* stored).decisions;
        const { posture } = yield* api.ledger(anyone);

        expect({
          choices: decisions.map(({ decided }) => decided?.choice),
          posture,
        }).toStrictEqual({ choices: ["decline"], posture: "open" });
      }).pipe(Effect.provide(visibilityWorld()))
  );
});

/** A `visibility.ts` whose maintainers layer also holds shipped source: Open core. */
const coreSource =
  "export default visibility({ layers: { maintainers: withSource } });\n";

/** What `coreSource` evaluates to: datekit's config, its maintainers layer holding source too. */
const openCore = {
  ...datekitVisibility,
  layers: datekitVisibility.layers.map((layer) => ({
    ...layer,
    holds: Array.append(layer.holds, "source" as const),
  })),
};

/** main's files with `visibility.ts` holding `source`. */
const mainWith = (source: string) =>
  mainFiles.map(
    ([path, content]) =>
      [path, path === visibilityFile ? source : content] as const
  );

describe("a landing that widens the posture", () => {
  it.effect(
    "stands at once, though an older narrowing to the same posture was declined",
    () =>
      Effect.gen(function* () {
        // Sealed evidence is asked for and declined by default: Open stands.
        const { api } = yield* sealedByInes;

        yield* advanceTo("2026-11-07T12:00:00Z");
        yield* api.onAlarm();

        // Open core is asked for and accepted, and its notice runs out.
        yield* landOwn(api, inesV, {
          files: mainWith(coreSource),
          message: "Keep the core's source in the maintainers layer",
          requestId: "land-core",
        });

        const [core] = yield* postureDecisions(api);
        const asked = Option.getOrThrow(Option.fromUndefinedOr(core));

        yield* api.decide(okonkwo, { choice: "accept", decision: asked.id });
        yield* advanceTo("2026-11-14T12:00:00Z");

        const closed = yield* api.ledger(anyone);

        // Back to sealed evidence: wider than Open core, so no decision.
        yield* landOwn(api, inesV, {
          files: mainFiles,
          message: "Release the core's source again",
          requestId: "land-sealed-again",
        });

        const widened = yield* api.ledger(anyone);

        expect({
          asked: asked.subject,
          open: (yield* postureDecisions(api)).length,
          postures: [closed, widened].map(({ posture }) => posture),
        }).toStrictEqual({
          asked: DecisionSubject.cases.PostureChange.make({
            from: "open",
            to: "openCore",
          }),
          open: 0,
          postures: ["openCore", "openWithSealedEvidence"],
        });
      }).pipe(
        Effect.provide(
          visibilityWorld(datekitVisibility, new Map([[coreSource, openCore]]))
        )
      )
  );
});

describe("a push to the maintainers layer, with admission off", () => {
  it.effect(
    "lands the layer's head and publishes each area's salted commitment, rooted in the stored salt",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;
        const accepted = yield* countersigned(api);
        const head = yield* pushLayer(api, Option.none(), firstSuite);
        const rows = yield* stored;
        const row = Option.getOrThrow(Array.head(rows.layers));

        const salt = Option.getOrThrow(
          Array.head(yield* Seen.use((seen) => seen.salts))
        );

        const files = yield* suiteFiles(firstSuite);
        const roots = yield* areaRoots(salt, files);

        expect({
          landed: row.landedSha,
          proposed: row.proposed,
          salt: row.saltRef,
          suite: row.suiteRoot,
        }).toStrictEqual({
          landed: head,
          proposed: undefined,
          salt: hexOf(salt),
          suite: yield* suiteRoot(salt, files),
        });
        expect(rows.ledger.slice(1)).toStrictEqual([
          LedgerEntry.cases.PostureChanged.make({
            at: at("2026-10-14T12:00:00Z"),
            decision: accepted.id,
            from: "open",
            seq: 2,
            to: "openWithSealedEvidence",
          }),
          LedgerEntry.cases.CommitmentPublished.make({
            area: exportArea,
            at: at("2026-10-14T12:00:00Z"),
            authors: 2,
            checks: 2,
            seq: 3,
            suite: Option.getOrThrow(
              Option.fromUndefinedOr(roots.get(exportArea))
            ),
          }),
          LedgerEntry.cases.CommitmentPublished.make({
            area: parserArea,
            at: at("2026-10-14T12:00:00Z"),
            authors: 1,
            checks: 1,
            seq: 4,
            suite: Option.getOrThrow(
              Option.fromUndefinedOr(roots.get(parserArea))
            ),
          }),
        ]);
      }).pipe(Effect.provide(visibilityWorld()))
  );
});

describe("a claim", () => {
  it.effect(
    "is pinned to the suite sealed when it opened, which a later layer push does not move",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;

        yield* countersigned(api);

        const first = yield* pushLayer(api, Option.none(), firstSuite);

        const sealedFirst = Option.getOrThrow(
          Array.head((yield* stored).layers)
        );

        const { claim } = yield* api.claim(bob, parseIso);

        yield* pushLayer(api, Option.some(first), secondSuite);

        const sealedSecond = Option.getOrThrow(
          Array.head((yield* stored).layers)
        );

        const later = yield* api.claim(bob, trimInput);
        const status = yield* api.status(bob);

        expect({
          first: claim.suite,
          later: later.claim.suite,
          moved: sealedSecond.suiteRoot !== sealedFirst.suiteRoot,
          salts: (yield* Seen.use((seen) => seen.salts)).length,
          status: status.claims.map(({ ask, suite }) => [ask, suite]),
        }).toStrictEqual({
          first: sealedFirst.suiteRoot,
          later: sealedSecond.suiteRoot,
          moved: true,
          salts: 2,
          status: [
            ["parse-iso", sealedFirst.suiteRoot],
            ["trim-input", sealedSecond.suiteRoot],
          ],
        });
      }).pipe(Effect.provide(visibilityWorld()))
  );

  it.effect("pins nothing while the narrowing waits on its decision", () =>
    Effect.gen(function* () {
      const { api } = yield* sealedByInes;

      yield* pushLayer(api, Option.none(), firstSuite);

      const { claim } = yield* api.claim(bob, parseIso);

      expect(claim.suite).toBeUndefined();
    }).pipe(Effect.provide(visibilityWorld()))
  );

  it.effect(
    "gets a held-back job of the layer's files at its pinned commit, one run per sealed check",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;

        yield* countersigned(api);

        const first = yield* pushLayer(api, Option.none(), firstSuite);

        yield* api.claim(bob, parseIso);
        yield* pushLayer(api, Option.some(first), secondSuite);

        const snapshot = yield* stored;
        const row = Option.getOrThrow(Array.head(snapshot.claims));
        const pinned = Option.getOrThrow(Option.fromUndefinedOr(row.pinned));
        const visibility = yield* ProjectVisibility;

        const job = Option.getOrThrow(
          yield* visibility.heldBackJob(
            { ask: row.ask, claimant: row.claimant, pinned },
            snapshot
          )
        );

        const decoder = new TextDecoder();

        expect({
          areas: job.areas,
          at: job.at,
          files: job.files.map(({ area, content, path }) => [
            path,
            area,
            decoder.decode(content),
          ]),
          runs: job.runs.map(({ area, command, path }) => [
            path,
            area,
            command,
          ]),
          suite: job.suite,
        }).toStrictEqual({
          areas: [exportArea, parserArea],
          at: first,
          files: byPath(
            firstSuite.map(({ area, content, path }) => [path, area, content])
          ),
          runs: byPath(
            firstSuite.map(({ area, path }) => [path, area, `bun test ${path}`])
          ),
          suite: pinned.suite,
        });
      }).pipe(Effect.provide(visibilityWorld()))
  );
});

/** datekit's config with a second layer that only okonkwo reads and writes. */
const withTriage = {
  ...datekitVisibility,
  layers: [
    ...datekitVisibility.layers,
    {
      audience: "maintainers" as const,
      disclose: "counted" as const,
      holds: Array.make("notes" as const),
      name: LayerName.make("triage"),
      readers: Array.make(okonkwo.handle),
      reason: "Security triage notes",
      writers: Array.make(okonkwo.handle),
    },
  ],
};

describe("two layers", () => {
  it.effect(
    "tell stage 1 its pusher reads the layers only when the pusher reads every one of them",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;

        yield* pushLayer(api, Option.none(), firstSuite);

        expect({
          bob: (yield* api.layerFacts(bob)).canRead,
          ines: (yield* api.layerFacts(inesV)).canRead,
          okonkwo: (yield* api.layerFacts(okonkwo)).canRead,
        }).toStrictEqual({ bob: false, ines: false, okonkwo: true });
      }).pipe(Effect.provide(visibilityWorld(withTriage)))
  );
});

/** datekit's config with each person's own layer too: config only. */
const withPersonal = {
  ...datekitVisibility,
  layers: [
    ...datekitVisibility.layers,
    {
      audience: "personal" as const,
      disclose: "hidden" as const,
      holds: Array.make("personal" as const),
      name: LayerName.make("personal"),
      readers: "deciders" as const,
      reason: "Each person's own agent configuration",
      writers: "deciders" as const,
    },
  ],
};

describe("the maintainers layer", () => {
  it.effect(
    "is reached by the deciders alone, and every path it holds is kept out of public trees",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;

        yield* pushLayer(api, Option.none(), firstSuite);

        const personal = LayerName.make("personal");

        expect({
          bob: yield* api.layerFacts(bob),
          created: yield* Seen.use(({ created }) => created),
          ines: (yield* api.layerFacts(inesV)).canRead,
          reach: [
            yield* api.layerAccess(inesV, maintainers),
            yield* api.layerAccess(okonkwo, maintainers),
            yield* api.layerAccess(bob, maintainers),
            yield* api.layerAccess(anyone, maintainers),
            yield* api.layerAccess(inesV, personal),
          ],
        }).toStrictEqual({
          bob: {
            canRead: false,
            layerPaths: [
              manifestFile,
              ...byPath(firstSuite.map(({ path }) => [path])).map(
                ([path]) => path
              ),
            ],
          },
          created: [layerRepo],
          ines: true,
          reach: [
            Option.some("write"),
            Option.some("write"),
            Option.some("none"),
            Option.some("none"),
            Option.none(),
          ],
        });
      }).pipe(Effect.provide(visibilityWorld(withPersonal)))
  );
});

/** datekit's config with admission on: a new check passes main 3 times and catches a known-bad tree. */
const admitting = {
  ...datekitVisibility,
  checks: {
    ...Option.getOrThrow(Option.fromUndefinedOr(datekitVisibility.checks)),
    admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },
  },
};

describe("a push to the maintainers layer, with admission on", () => {
  it.effect(
    "stays proposed, starts its admission once, and lands nothing on an admission whose runs are unreported",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;

        yield* countersigned(api);

        const head = yield* pushLayer(api, Option.none(), firstSuite);

        // The same push heard again, and the outbox run again.
        yield* api.recordLayerPush(inesV, { head, layer: maintainers });
        yield* api.onAlarm();

        const plan = yield* api.admissionPlan({ head, layer: maintainers });
        const { claim } = yield* api.claim(bob, parseIso);

        yield* api.recordAdmission({ head, layer: maintainers, results: [] });

        const row = Option.getOrThrow(Array.head((yield* stored).layers));

        expect({
          admissions: yield* Seen.use(({ admissions }) => admissions),
          plan: Option.map(plan, ({ head: planned, layer, runs }) => [
            planned,
            layer,
            runs.map((each) =>
              AdmissionRun.match(each, {
                OnKnownBad: ({ area, tree }) => `${area} on ${tree}`,
                OnMain: ({ area, attempt }) => `${area} on main #${attempt}`,
              })
            ),
          ]),
          row: [row.landedSha, row.proposed, row.suiteRoot],
          suite: claim.suite,
        }).toStrictEqual({
          admissions: [{ head, layer: maintainers, project }],
          // The layer's first push: each area on main three times, and
          // its manifest names no known-bad commit.
          plan: Option.some([
            head,
            maintainers,
            [
              "export on main #1",
              "export on main #2",
              "export on main #3",
              "parser on main #1",
              "parser on main #2",
              "parser on main #3",
            ],
          ]),
          row: [undefined, head, undefined],
          suite: undefined,
        });
      }).pipe(Effect.provide(visibilityWorld(admitting)))
  );
});

describe("a push to the maintainers layer heard from someone who may not write it", () => {
  it.effect("moves nothing", () =>
    Effect.gen(function* () {
      const { api } = yield* sealedByInes;

      yield* countersigned(api);

      const head = yield* LayerPusher.use((pusher) =>
        pusher.push(Option.none(), layerFiles(firstSuite))
      );

      yield* api.recordLayerPush(bob, { head, layer: maintainers });

      const rows = yield* stored;

      expect({
        layers: rows.layers.map(({ landedSha, name, proposed }) => [
          name,
          landedSha,
          proposed,
        ]),
        salts: (yield* Seen.use((seen) => seen.salts)).length,
      }).toStrictEqual({
        layers: [[maintainers, undefined, undefined]],
        salts: 0,
      });
    }).pipe(Effect.provide(visibilityWorld()))
  );
});
