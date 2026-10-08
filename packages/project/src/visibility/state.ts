/**
 * The visibility cartridge's project state (W6 612; OSR §2.6, §4.1, §5.4,
 * §5.5, §7.1): the `ProjectVisibility` port, over the private namespace's
 * repos (`LayerRepos`), a source of secret salts, and what starts an
 * admission.
 *
 * - A landing that declares layers provisions each one's repo,
 *   `<project>--<layer>` in the private namespace, once (an outbox effect,
 *   retried until done; a repo that exists already counts as made), and
 *   appends `LayerDeclared`. A change that narrows the posture opens a
 *   `PostureChange` decision for a second decider (`./ledger.ts`).
 * - A push to a layer proposes its head. With admission off it lands at
 *   once: the layer's sealed checks (its manifest, `<config folder>/
 *   layer.json` in the layer repo, filtered to the policy's areas) are
 *   committed to under a fresh salt, which the DO's store alone keeps, and
 *   each area's root, check count and author count are published
 *   (`CommitmentPublished`). With admission on, the head waits for
 *   `./admission.ts`'s judgement.
 * - A claim opened while a sealed suite is in effect is pinned to its root
 *   and layer commit; its answers are judged by that suite, read back at
 *   that commit, and their failures counted per claim and per person, area
 *   and week (`./claims.ts`), never against their record.
 *
 * Nothing it returns for the public names a layer's path, a check, or a
 * salt: roots, counts and area bits only (spec D17).
 */
import { ObjectId, Revision } from "@repo/artifacts/repo-host";
import type { RepoExists } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { commandFor } from "@repo/checks/kinds";
import { CheckSpec } from "@repo/protocol/domain/check";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { Policy } from "@repo/protocol/domain/policy";
import { LayerManifest, LedgerEntry } from "@repo/protocol/domain/visibility";
import type {
  Layer as LayerDeclaration,
  Members,
  SealedChecks,
  VisibilityPolicy,
} from "@repo/protocol/domain/visibility";
import {
  AreaName,
  BlobSha,
  CommitSha,
  LayerName,
  ProjectName,
  RepoName,
  RepoPath,
  sameHandle,
} from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { Person, Principal } from "@repo/protocol/principal";
import { areaRoots, suiteRoot } from "@repo/visibility/commitment";
import type { SuiteFile } from "@repo/visibility/commitment";
import { LayerRepos } from "@repo/visibility/layer-repos";
import { entriesForPolicy } from "@repo/visibility/ledger";
import { narrows } from "@repo/visibility/posture";
import {
  Array as Arr,
  Cause,
  Clock,
  Context,
  DateTime,
  Effect,
  Equal,
  Layer,
  Option,
  Order,
  Result,
  Schema,
  Struct,
} from "effect";

import { decidersFor, openDecision } from "../attention/decisions.ts";
import { platformHandle } from "../attention/effects.ts";
import { decidersOn, nextDecisionId } from "../deciders.ts";
import type { ProjectSnapshot, ProjectWrites } from "../project-store.ts";
import type { LayerRow } from "../project-store/rows.ts";
import { noPlan, policyIn, ProjectVisibility } from "../visibility-port.ts";
import type {
  HeldBackJob,
  LayerAccess,
  VisibilityEffect,
  VisibilityPlan,
  VisibilityPort,
} from "../visibility-port.ts";
import { judgeAdmission, planAdmission } from "./admission.ts";
import { judgeAttempts } from "./claims.ts";
import {
  appended,
  declaredBy,
  ledgerFor,
  nextSeq,
  postureCaughtUp,
  sealedInEffect,
  standing,
  visibilityIn,
} from "./ledger.ts";

/** Where a commitment's secret salt comes from: 32 random bytes each time. */
export class SaltSource extends Context.Service<
  SaltSource,
  { readonly next: Effect.Effect<Uint8Array> }
>()("project/SaltSource") {}

/**
 * What starts the admission of a layer push's sealed checks: the `Answer`
 * Workflow's admission run (609 #8). Starting one twice runs it once.
 */
export class AdmissionStarts extends Context.Service<
  AdmissionStarts,
  {
    readonly start: (input: {
      readonly head: CommitSha;
      readonly layer: LayerName;
      readonly project: ProjectName;
    }) => Effect.Effect<void>;
  }
>()("project/AdmissionStarts") {}

/**
 * Where a layer repo keeps its manifest: the JSON form of `layer.ts`,
 * committed beside it, which the DO reads without evaluating code.
 */
export const manifestPath = RepoPath.make(`${Brand.configDir}/layer.json`);

/** The effects this port's plans ask for, settled after their commit. */
const Planned = Schema.Union([
  Schema.TaggedStruct("Provision", { repo: RepoName }),
  Schema.TaggedStruct("Admit", {
    head: CommitSha,
    layer: LayerName,
    project: ProjectName,
  }),
]).pipe(Schema.toTaggedUnion("_tag"));

type Planned = typeof Planned.Type;

const PlannedJson = Schema.toCodecJson(Planned);

const encodePlanned = Schema.encodeEffect(PlannedJson);

const decodePlanned = Schema.decodeUnknownEffect(PlannedJson);

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(LayerManifest)
);

/** The repo a declared layer keeps in the private namespace. */
const repoFor = (project: ProjectName, layer: LayerName) =>
  RepoName.make(`${project}--${layer}`);

/**
 * Whether a layer gets a repo of its own. A personal layer is each
 * person's own, and an embargo is config only (spec D14, 604 #3): neither
 * has one, so neither is provisioned or reachable.
 */
const ownsRepo = (layer: LayerDeclaration) =>
  layer.audience !== "personal" && layer.audience !== "security";

/** The people a rule names: the project's deciders, for any path, or those listed. */
const membersOf = (policy: Policy, members: Members): readonly Handle[] =>
  members === "deciders"
    ? policy.deciders.flatMap(({ handles }) => handles)
    : members;

const names = (handles: readonly Handle[], who: Principal) =>
  Principal.guards.Person(who) &&
  handles.some((handle) => sameHandle(handle, who.handle));

const hexOf = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const byPath = Order.mapInput(
  Order.String,
  (file: { readonly path: RepoPath }) => file.path
);

/** The areas a suite reports, sorted by name. */
const areasOf = (checks: SealedChecks) =>
  Arr.sort(Object.keys(checks.areas), Order.String).map((area) =>
    AreaName.make(area)
  );

/** One sealed check as a layer commit holds it: its file, its area, its blob and its author. */
interface Sealed extends SuiteFile {
  readonly author: Handle;
}

/** The project's name, from its row. */
const projectOf = (snapshot: ProjectSnapshot) =>
  Option.map(snapshot.project, ({ project }) => project);

/** A declared layer that keeps a repo, by name. */
const declaredLayer = (
  visibility: Option.Option<VisibilityPolicy>,
  layer: LayerName
) =>
  Option.flatMap(visibility, ({ layers }) =>
    Arr.findFirst(layers, (each) => each.name === layer && ownsRepo(each))
  );

/** The sealed checks a layer holds, when the policy keeps them in it. */
const checksIn = (
  visibility: Option.Option<VisibilityPolicy>,
  layer: LayerName
) =>
  Option.filter(
    Option.flatMap(visibility, ({ checks }) => Option.fromUndefinedOr(checks)),
    (checks) => checks.layer === layer
  );

/** The project's row for a layer, or a new one for its repo. */
const rowFor = (
  snapshot: ProjectSnapshot,
  project: ProjectName,
  layer: LayerName
): LayerRow =>
  Option.getOrElse(
    Arr.findFirst(snapshot.layers, ({ name }) => name === layer),
    () => ({ name: layer, repo: repoFor(project, layer) })
  );

/**
 * The decision a narrowing landing opens (OSR §2.6): for the project's own
 * deciders but those who landed it, so a second decider countersigns; when
 * nobody else decides for the whole project, its deciders as they are.
 * Its default is decline, and it stays open through the notice period and
 * the policy's usual expiry after it.
 */
const narrowingDecision = (input: {
  readonly after: Policy;
  readonly from: Posture;
  readonly landedBy: readonly Handle[];
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly snapshot: ProjectSnapshot;
  readonly to: { readonly label: string; readonly posture: Posture };
}): Decision => {
  const noticeDays = input.after.visibility?.notice.narrowingDays ?? 0;

  const others = decidersFor(input.after, []).filter(
    (decider) => !input.landedBy.some((by) => sameHandle(by, decider))
  );

  const deciders = Arr.isReadonlyArrayNonEmpty(others)
    ? others
    : decidersOn(
        input.after,
        [],
        Option.match(input.snapshot.project, {
          onNone: () => platformHandle,
          onSome: ({ initializer }) => initializer,
        })
      );

  return openDecision({
    deciders,
    evidence: [
      { label: "narrows to", value: input.to.label },
      {
        label: "notice",
        value: `${noticeDays} days: it stands no earlier than ${DateTime.formatIso(
          DateTime.add(input.now, { days: noticeDays })
        )}, once accepted`,
      },
      ...(input.landedBy.length === 0
        ? []
        : [
            {
              label: "landed by",
              value: Arr.dedupeWith(input.landedBy, sameHandle).join(", "),
            },
          ]),
    ],
    expireDays: input.after.budget.expireDays + noticeDays,
    id: nextDecisionId(input.snapshot.decisions, new Map()),
    now: input.now,
    project: input.project,
    subject: DecisionSubject.cases.PostureChange.make({
      from: input.from,
      to: input.to.posture,
    }),
  });
};

/** A plan of rows and the effects to settle after them. */
const planOf = (
  writes: ProjectWrites,
  effects: readonly VisibilityEffect[] = []
): VisibilityPlan => ({ effects, writes });

/** A planned effect, as a plan carries it. */
const effectOf = (id: string, planned: Planned) =>
  Effect.map(
    Effect.orDie(encodePlanned(planned)),
    (body): VisibilityEffect => ({ body, id })
  );

/** The `PostureChanged` row a narrowing that took effect still owes the ledger, numbered from `seq`. */
const caughtUp = (
  snapshot: ProjectSnapshot,
  visibility: Option.Option<VisibilityPolicy>,
  now: DateTime.Utc
) =>
  postureCaughtUp(
    snapshot,
    standing({ decisions: snapshot.decisions, now, visibility }),
    nextSeq(snapshot.ledger)
  );

/** How far `who` reaches into a layer of the project's policy. */
const reach = (
  policy: Policy,
  layer: LayerDeclaration,
  who: Principal
): LayerAccess => {
  if (names(membersOf(policy, layer.writers), who)) {
    return "write";
  }

  return names(membersOf(policy, layer.readers), who) ? "read" : "none";
};

/** One held-back run of a claim's answer, judged against its attempts (`./claims.ts`). */
const judgeHeldBack: VisibilityPort["judgeHeldBack"] = (input, snapshot) => {
  const checks = Option.flatMap(visibilityIn(snapshot), ({ checks: sealed }) =>
    Option.fromUndefinedOr(sealed)
  );

  if (Option.isNone(checks)) {
    return { refusals: [], trailer: Option.none(), writes: {} };
  }

  const judged = judgeAttempts({
    ask: input.ask,
    attempts: snapshot.attempts,
    checks: checks.value,
    claimant: input.claimant,
    now: input.now,
    results: input.results,
    suite: input.pinned.suite,
  });

  return {
    refusals: judged.refusals,
    trailer: judged.trailer,
    writes: judged.attempts.length === 0 ? {} : { attempts: judged.attempts },
  };
};

/** A read of a layer through the gateway, for its readers' log. */
const recordRead: VisibilityPort["recordRead"] = (input) => ({
  layerReads: [
    {
      at: input.at,
      handle: input.handle,
      layer: input.layer,
      ...Option.match(input.sha, {
        onNone: () => ({}),
        onSome: (sha) => ({ sha }),
      }),
    },
  ],
});

/** How far `who` reaches into a declared layer that keeps a repo. */
const access: VisibilityPort["access"] = (who, layer, snapshot) =>
  Option.flatMap(policyIn(snapshot), (policy) =>
    Option.map(
      declaredLayer(Option.fromUndefinedOr(policy.visibility), layer),
      (declared) => reach(policy, declared, who)
    )
  );

/** The layers `who` reads: the write-down guard runs only for these. */
const readableLayers: VisibilityPort["readableLayers"] = (who, snapshot) =>
  new Set(
    Option.match(policyIn(snapshot), {
      onNone: () => [],
      onSome: (policy) =>
        (policy.visibility?.layers ?? []).flatMap((layer) =>
          ownsRepo(layer) && reach(policy, layer, who) !== "none"
            ? [layer.name]
            : []
        ),
    })
  );

/**
 * A landing that moved the config: `LayerDeclared` for each layer it adds
 * or changes, a row and a provisioning effect for each layer that has no
 * repo yet, and, for a narrowing, a `PostureChange` decision; first the
 * `PostureChanged` row a narrowing that took effect before still owes.
 */
const onPolicy: VisibilityPort["onPolicy"] = (input, snapshot) =>
  Effect.gen(function* () {
    const project = projectOf(snapshot);
    const after = Option.fromUndefinedOr(input.after.visibility);

    const before = Option.flatMap(input.before, (policy) =>
      Option.fromUndefinedOr(policy.visibility)
    );

    if (
      Option.isNone(project) ||
      (Option.isNone(before) && Option.isNone(after))
    ) {
      return noPlan;
    }

    // What stood before this landing, under the config as it was.
    const was = standing({
      decisions: snapshot.decisions,
      now: input.now,
      visibility: before,
    });

    const owed = postureCaughtUp(snapshot, was, nextSeq(snapshot.ledger));

    const declared = entriesForPolicy(
      before,
      after,
      nextSeq([...snapshot.ledger, ...owed]),
      input.now
    );

    const fresh = Option.match(after, {
      onNone: (): readonly LayerRow[] => [],
      onSome: ({ layers }) =>
        layers.flatMap((layer) =>
          ownsRepo(layer) &&
          !snapshot.layers.some(({ name }) => name === layer.name)
            ? [{ name: layer.name, repo: repoFor(project.value, layer.name) }]
            : []
        ),
    });

    const provisions = yield* Effect.forEach(fresh, ({ repo }) =>
      effectOf(`provision:${repo}`, Planned.cases.Provision.make({ repo }))
    );

    // A project's first config stands at once, and an unchanged one
    // decides nothing again (a declined narrowing stays declined).
    const changed = Option.isSome(input.before) && !Equal.equals(before, after);

    const to = declaredBy(after);

    const decisions =
      changed && narrows(was.posture, to.posture)
        ? [
            narrowingDecision({
              after: input.after,
              from: was.posture,
              landedBy: input.landings.map(({ author }) => author),
              now: input.now,
              project: project.value,
              snapshot,
              to,
            }),
          ]
        : [];

    return planOf(
      {
        ...appended([...owed, ...declared]),
        decisions,
        layers: fresh,
      },
      provisions
    );
  });

/**
 * An admission's results, judged by `./admission.ts`: the proposed head
 * lands under the root its runs were given, and the admitted areas are
 * appended, when every area that ran was admitted. The port is
 * synchronous, so no fresh salt is drawn and no commitment published
 * here (612 Comments, for 615).
 */
const onAdmission: VisibilityPort["onAdmission"] = (input, snapshot) => {
  const project = projectOf(snapshot);

  const main = Option.flatMap(snapshot.project, ({ landed }) =>
    Option.fromUndefinedOr(landed)
  );

  const row = Arr.findFirst(
    snapshot.layers,
    ({ name, proposed }) => name === input.layer && proposed === input.head
  );

  if (Option.isNone(project) || Option.isNone(main) || Option.isNone(row)) {
    return noPlan;
  }

  const runs = input.results.map(({ run }) => run);

  const judged = judgeAdmission(
    { head: input.head, layer: input.layer, main: main.value, runs },
    input.results
  );

  // Every run of one plan carries the root of the suite it would admit.
  const suites = Arr.dedupe(runs.map(({ job }) => job.suite));

  if (
    judged.refused.length > 0 ||
    judged.admitted.length === 0 ||
    !Arr.isReadonlyArrayNonEmpty(suites) ||
    suites.length > 1
  ) {
    return noPlan;
  }

  const owed = caughtUp(snapshot, visibilityIn(snapshot), input.now);
  const seq = nextSeq(snapshot.ledger) + owed.length;

  const admitted = judged.admitted.map((entry, index) => ({
    ...entry,
    seq: seq + index,
  }));

  return planOf({
    ...appended([...owed, ...admitted]),
    layers: [
      {
        ...Struct.omit(row.value, ["proposed", "saltRef"]),
        admittedAt: input.now,
        landedSha: input.head,
        suiteRoot: suites[0],
      },
    ],
  });
};

const live = Effect.gen(function* () {
  const repos = yield* LayerRepos;
  const salts = yield* SaltSource;
  const admissions = yield* AdmissionStarts;
  // `pinSuite` and `ledger` are read without a `now`: the posture's notice
  // runs on this clock (the TestClock in tests).
  const clock = yield* Clock.Clock;

  const nowOf = () => DateTime.makeUnsafe(clock.currentTimeMillisUnsafe());

  // ------------------------------------------------------- layer commits

  /** A layer commit, which must exist: a pinned or landed SHA the store recorded. */
  const commitAt = (repo: RepoName, at: CommitSha) =>
    Effect.flatMap(Effect.orDie(repos.readCommit(repo, at)), (found) =>
      Option.match(found, {
        onNone: () => Effect.die(`the layer repo ${repo} has no commit ${at}`),
        onSome: Effect.succeed,
      })
    );

  /** Every blob a layer commit's tree holds, by path. */
  const blobsAt = (repo: RepoName, at: CommitSha) =>
    Effect.gen(function* () {
      const commit = yield* commitAt(repo, at);
      const blobs = new Map<string, ObjectId>();

      const walk = (tree: ObjectId, prefix: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const entries = yield* Effect.flatMap(
            Effect.orDie(repos.readTree(repo, tree)),
            (found) =>
              Option.match(found, {
                onNone: () =>
                  Effect.die(`the layer repo ${repo} has no tree ${tree}`),
                onSome: Effect.succeed,
              })
          );

          for (const entry of entries) {
            if (entry.type === "tree") {
              yield* walk(entry.sha, `${prefix}${entry.name}/`);
            } else if (entry.type === "blob") {
              blobs.set(`${prefix}${entry.name}`, entry.sha);
            }
          }
        });

      yield* walk(commit.tree, "");

      return blobs;
    });

  /** A layer commit's manifest, when it holds one for this layer that decodes. */
  const manifestAt = (repo: RepoName, layer: LayerName, at: CommitSha) =>
    Effect.gen(function* () {
      const bytes = yield* Effect.orDie(
        repos.readFile(repo, Revision.Commit({ sha: at }), manifestPath)
      );

      if (Option.isNone(bytes)) {
        return Option.none<LayerManifest>();
      }

      const manifest = Option.filter(
        yield* Effect.option(
          decodeManifest(new TextDecoder().decode(bytes.value))
        ),
        (decoded) => decoded.layer === layer
      );

      if (Option.isNone(manifest)) {
        yield* Effect.logWarning(
          `the manifest in ${repo} at ${at} is no manifest of ${layer}`
        );
      }

      return manifest;
    });

  /**
   * The sealed checks a layer commit holds: its manifest's checks in the
   * policy's areas (a check in an area the policy does not name runs
   * nowhere, 604 #3) whose files the commit has, sorted by path.
   */
  const sealedAt = (
    repo: RepoName,
    layer: LayerName,
    at: CommitSha,
    checks: SealedChecks
  ) =>
    Effect.gen(function* () {
      const manifest = yield* manifestAt(repo, layer, at);

      if (Option.isNone(manifest)) {
        return [];
      }

      const blobs = yield* blobsAt(repo, at);
      const areas = new Set<string>(Object.keys(checks.areas));

      return Arr.sort(
        manifest.value.checks.flatMap((check): readonly Sealed[] => {
          const blob = blobs.get(check.path);

          return blob === undefined || !areas.has(check.area)
            ? []
            : [
                {
                  area: check.area,
                  author: check.author,
                  blob: BlobSha.make(blob),
                  path: check.path,
                },
              ];
        }),
        byPath
      );
    });

  /**
   * A layer's head, landed: with sealed checks in it, committed to under a
   * fresh salt (kept in the layer's row, nowhere else), and each area's
   * root, check count and author count published.
   */
  const landLayer = (input: {
    readonly checks: Option.Option<SealedChecks>;
    readonly head: CommitSha;
    readonly now: DateTime.Utc;
    readonly row: LayerRow;
    readonly seq: number;
  }): Effect.Effect<ProjectWrites> =>
    Effect.gen(function* () {
      const landed: LayerRow = {
        ...Struct.omit(input.row, ["proposed", "saltRef", "suiteRoot"]),
        admittedAt: input.now,
        landedSha: input.head,
      };

      const files = yield* Option.match(input.checks, {
        onNone: () => Effect.succeed<readonly Sealed[]>([]),
        onSome: (checks) =>
          sealedAt(input.row.repo, input.row.name, input.head, checks),
      });

      if (!Arr.isReadonlyArrayNonEmpty(files)) {
        return { layers: [landed] } satisfies ProjectWrites;
      }

      const salt = yield* salts.next;
      const roots = yield* areaRoots(salt, files);

      const published = [...roots].map(([area, root], index) => {
        const inArea = files.filter((file) => file.area === area);

        return LedgerEntry.cases.CommitmentPublished.make({
          area,
          at: input.now,
          authors: Arr.dedupeWith(
            inArea.map(({ author }) => author),
            sameHandle
          ).length,
          checks: inArea.length,
          seq: input.seq + index,
          suite: root,
        });
      });

      return {
        ...appended(published),
        layers: [
          {
            ...landed,
            saltRef: hexOf(salt),
            suiteRoot: yield* suiteRoot(salt, files),
          },
        ],
      } satisfies ProjectWrites;
    });

  // ------------------------------------------------------------ the port

  /**
   * Every path any layer holds, at its landed head and at a head still
   * proposed: deny by default, so nothing from a layer enters a public
   * tree, admitted yet or not (principle 7).
   */
  const layerPaths: VisibilityPort["layerPaths"] = (snapshot) =>
    Effect.gen(function* () {
      const heads = snapshot.layers.flatMap(({ landedSha, proposed, repo }) =>
        Arr.dedupe(
          [landedSha, proposed].filter(
            (head): head is CommitSha => head !== undefined
          )
        ).map((at) => [repo, at] as const)
      );

      const paths = yield* Effect.forEach(heads, ([repo, at]) =>
        Effect.map(blobsAt(repo, at), (blobs) => [...blobs.keys()])
      );

      return new Set(paths.flat().map((path) => RepoPath.make(path)));
    });

  const pinSuite: VisibilityPort["pinSuite"] = (_claim, snapshot) => {
    const visibility = visibilityIn(snapshot);

    const inEffect = sealedInEffect(
      standing({ decisions: snapshot.decisions, now: nowOf(), visibility })
    );

    return Option.flatMap(
      Option.filter(
        Option.flatMap(
          Option.flatMap(visibility, ({ checks }) =>
            Option.fromUndefinedOr(checks)
          ),
          (checks) =>
            Arr.findFirst(snapshot.layers, ({ name }) => name === checks.layer)
        ),
        () => inEffect
      ),
      ({ landedSha, suiteRoot: suite }) =>
        landedSha === undefined || suite === undefined
          ? Option.none()
          : Option.some({ at: landedSha, suite })
    );
  };

  const heldBackJob: VisibilityPort["heldBackJob"] = (claim, snapshot) =>
    Effect.gen(function* () {
      const policy = policyIn(snapshot);

      const checks = Option.flatMap(policy, ({ visibility }) =>
        Option.fromUndefinedOr(visibility?.checks)
      );

      if (Option.isNone(policy) || Option.isNone(checks)) {
        return Option.none<HeldBackJob>();
      }

      const row = Arr.findFirst(
        snapshot.layers,
        ({ name }) => name === checks.value.layer
      );

      if (Option.isNone(row)) {
        return yield* Effect.die(
          `a claim was pinned to ${checks.value.layer}, which the project keeps no repo for`
        );
      }

      const { at, suite } = claim.pinned;
      const { name, repo } = row.value;
      const sealed = yield* sealedAt(repo, name, at, checks.value);

      const files = yield* Effect.forEach(sealed, ({ area, blob, path }) =>
        Effect.flatMap(
          Effect.orDie(repos.readBlob(repo, ObjectId.make(blob))),
          (content) =>
            Option.match(content, {
              // The blob's id stays out: unsalted, it would test a guess at the check.
              onNone: () =>
                Effect.die(
                  `the layer repo ${repo} lost a sealed check at ${at}`
                ),
              onSome: (bytes) => Effect.succeed({ area, content: bytes, path }),
            })
        )
      );

      const runs = yield* Effect.forEach(sealed, ({ area, path }) =>
        Option.match(
          commandFor(
            CheckSpec.cases.RedThenGreen.make({ path }),
            policy.value.run
          ),
          {
            onNone: () =>
              Effect.die(
                "the run block's `test` names no `{path}` to run a sealed check by"
              ),
            onSome: ({ command }) => Effect.succeed({ area, command, path }),
          }
        )
      );

      return Option.some<HeldBackJob>({
        areas: areasOf(checks.value),
        at,
        files,
        runs,
        suite,
      });
    });

  /** The runs that would admit `head` to `layer`: none without a manifest, or a check that cites no clause. */
  const admissionOf = (
    input: { readonly head: CommitSha; readonly layer: LayerName },
    snapshot: ProjectSnapshot
  ) =>
    Effect.gen(function* () {
      const project = projectOf(snapshot);
      const checks = checksIn(visibilityIn(snapshot), input.layer);

      const main = Option.flatMap(snapshot.project, ({ landed }) =>
        Option.fromUndefinedOr(landed)
      );

      if (
        Option.isNone(project) ||
        Option.isNone(checks) ||
        Option.isNone(main)
      ) {
        return Option.none();
      }

      const row = rowFor(snapshot, project.value, input.layer);
      const manifest = yield* manifestAt(row.repo, row.name, input.head);

      if (Option.isNone(manifest)) {
        return Option.none();
      }

      const previous =
        row.landedSha === undefined
          ? Option.none<LayerManifest>()
          : yield* manifestAt(row.repo, row.name, row.landedSha);

      const plan = planAdmission({
        head: input.head,
        main: main.value,
        manifest: manifest.value,
        policy: checks.value,
        previous,
      });

      if (Result.isFailure(plan)) {
        yield* Effect.logWarning(
          `a check pushed to ${input.layer} cites no clause`,
          plan.failure
        );

        return Option.none();
      }

      return Option.some(plan.success);
    });

  const onLayerPush: VisibilityPort["onLayerPush"] = (input, snapshot) =>
    Effect.gen(function* () {
      const project = projectOf(snapshot);
      const visibility = visibilityIn(snapshot);

      // The gateway lets only the layer's writers push (606); a push heard
      // from anyone else, or to a layer the config no longer declares,
      // moves nothing.
      if (
        Option.isNone(project) ||
        !Option.contains(
          access(Person.make({ handle: input.pusher }), input.layer, snapshot),
          "write"
        )
      ) {
        yield* Effect.logWarning(
          `a push to ${input.layer} by ${input.pusher} moves nothing: not one of its writers`
        );

        return noPlan;
      }

      const row = rowFor(snapshot, project.value, input.layer);

      // The same push heard again changes nothing.
      if (row.landedSha === input.head || row.proposed === input.head) {
        return noPlan;
      }

      const owed = caughtUp(snapshot, visibility, input.now);
      const checks = checksIn(visibility, input.layer);
      const admits = Option.exists(checks, ({ admit }) => admit !== undefined);

      if (!admits) {
        const landed = yield* landLayer({
          checks,
          head: input.head,
          now: input.now,
          row,
          seq: nextSeq(snapshot.ledger) + owed.length,
        });

        return planOf({
          ...landed,
          ...appended([...owed, ...(landed.ledger ?? [])]),
        });
      }

      // Admission decides (615): the head waits, proposed, for its runs.
      const planned = yield* admissionOf(
        { head: input.head, layer: input.layer },
        snapshot
      );

      const start = Option.isSome(planned)
        ? [
            yield* effectOf(
              `admit:${input.layer}:${input.head}`,
              Planned.cases.Admit.make({
                head: input.head,
                layer: input.layer,
                project: project.value,
              })
            ),
          ]
        : [];

      return planOf(
        { ...appended(owed), layers: [{ ...row, proposed: input.head }] },
        start
      );
    });

  const admissionPlan: VisibilityPort["admissionPlan"] = (input, snapshot) =>
    Effect.map(
      admissionOf(input, snapshot),
      Option.filter(() =>
        Arr.some(
          snapshot.layers,
          ({ name, proposed }) =>
            name === input.layer && proposed === input.head
        )
      )
    );

  /** One planned effect, run: a repo made (or found made), an admission started. */
  const run = (planned: Planned) =>
    Planned.match(planned, {
      Admit: ({ head, layer, project }) =>
        Effect.as(admissions.start({ head, layer, project }), true),
      Provision: ({ repo }) =>
        repos.create(repo).pipe(
          Effect.as(true),
          Effect.catchTag("RepoExists", (exists: RepoExists) =>
            Effect.as(Effect.logDebug(`${exists.name} was made before`), true)
          )
        ),
    });

  const settle: VisibilityPort["settle"] = (effect) =>
    decodePlanned(effect.body).pipe(
      Effect.flatMap(run),
      // A failure runs again with the outbox; an interruption stays one.
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.as(
              Effect.logWarning(
                `visibility effect ${effect.id} did not settle`,
                cause
              ),
              false
            )
      )
    );

  const port: VisibilityPort = {
    access,
    admissionPlan,
    heldBackJob,
    judgeHeldBack,
    layerPaths,
    ledger: (project, snapshot) => ledgerFor(project, snapshot, nowOf()),
    onAdmission,
    onLayerPush,
    onPolicy,
    pinSuite,
    readableLayers,
    recordRead,
    settle,
  };

  return port;
});

/**
 * The live `ProjectVisibility`, over the private namespace's repos, a salt
 * source (WebCrypto at the platform's edge) and what starts admissions.
 */
export const ProjectVisibilityLive: Layer.Layer<
  never,
  never,
  AdmissionStarts | LayerRepos | SaltSource
> = Layer.effect(ProjectVisibility, live);
