import { ObjectId, Revision } from "@repo/artifacts/repo-host";
import type { RepoExists } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { commandFor } from "@repo/checks/kinds";
import { CheckSpec } from "@repo/protocol/domain/check";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { Policy } from "@repo/protocol/domain/policy";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
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
  keyOf,
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
  AdmissionPlan,
  HeldBackJob,
  LayerAccess,
  VisibilityEffect,
  VisibilityPlan,
  VisibilityPort,
} from "../visibility-port.ts";
import { judgeAdmission, planAdmission, PushedManifest } from "./admission.ts";
import type { LayerFile, OverlayFile } from "./admission.ts";
import { judgeAttempts } from "./claims.ts";
import {
  appended,
  declaredBy,
  ledgerFor,
  nextMove,
  nextSeq,
  postureCaughtUp,
  sealedInEffect,
  standing,
  visibilityIn,
} from "./ledger.ts";

export class SaltSource extends Context.Service<
  SaltSource,
  { readonly next: Effect.Effect<Uint8Array> }
>()("project/SaltSource") {}

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

export const manifestPath = RepoPath.make(`${Brand.configDir}/layer.json`);

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

// A manifest may leave a clause out: admission refuses it (`UnstatedRequirement`) rather than read it as none.
const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PushedManifest)
);

const repoFor = (project: ProjectName, layer: LayerName) =>
  RepoName.make(`${keyOf(project)}--${layer}`);

const ownsRepo = (layer: LayerDeclaration) =>
  layer.audience !== "personal" && layer.audience !== "security";

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

const areasOf = (checks: SealedChecks) =>
  Arr.sort(Object.keys(checks.areas), Order.String).map((area) =>
    AreaName.make(area)
  );

interface Sealed extends SuiteFile {
  readonly author: Handle;
}

const projectOf = (snapshot: ProjectSnapshot) =>
  Option.map(snapshot.project, ({ project }) => project);

const declaredLayer = (
  visibility: Option.Option<VisibilityPolicy>,
  layer: LayerName
) =>
  Option.flatMap(visibility, ({ layers }) =>
    Arr.findFirst(layers, (each) => each.name === layer && ownsRepo(each))
  );

const checksIn = (
  visibility: Option.Option<VisibilityPolicy>,
  layer: LayerName
) =>
  Option.filter(
    Option.flatMap(visibility, ({ checks }) => Option.fromUndefinedOr(checks)),
    (checks) => checks.layer === layer
  );

const rowFor = (
  snapshot: ProjectSnapshot,
  project: ProjectName,
  layer: LayerName
): LayerRow =>
  Option.getOrElse(
    Arr.findFirst(snapshot.layers, ({ name }) => name === layer),
    () => ({ name: layer, repo: repoFor(project, layer) })
  );

/** Excludes those who landed it, so a second maintainer countersigns; when nobody else decides, the maintainers as they are. */
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

const planOf = (
  writes: ProjectWrites,
  effects: readonly VisibilityEffect[] = []
): VisibilityPlan => ({ effects, writes });

const effectOf = (id: string, planned: Planned) =>
  Effect.map(
    Effect.orDie(encodePlanned(planned)),
    (body): VisibilityEffect => ({ body, id })
  );

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

const access: VisibilityPort["access"] = (who, layer, snapshot) =>
  Option.flatMap(policyIn(snapshot), (policy) =>
    Option.map(
      declaredLayer(Option.fromUndefinedOr(policy.visibility), layer),
      (declared) => reach(policy, declared, who)
    )
  );

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

    // A first config stands at once; an unchanged one decides nothing again (a declined narrowing stays declined).
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

const live = Effect.gen(function* () {
  const repos = yield* LayerRepos;
  const salts = yield* SaltSource;
  const admissions = yield* AdmissionStarts;
  // `pinSuite` and `ledger` take no `now`: the posture's notice runs on this clock.
  const clock = yield* Clock.Clock;

  const nowOf = () => DateTime.makeUnsafe(clock.currentTimeMillisUnsafe());

  const commitAt = (repo: RepoName, at: CommitSha) =>
    Effect.flatMap(Effect.orDie(repos.readCommit(repo, at)), (found) =>
      Option.match(found, {
        onNone: () => Effect.die(`the layer repo ${repo} has no commit ${at}`),
        onSome: Effect.succeed,
      })
    );

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

  const manifestAt = (repo: RepoName, layer: LayerName, at: CommitSha) =>
    Effect.gen(function* () {
      const bytes = yield* Effect.orDie(
        repos.readFile(repo, Revision.Commit({ sha: at }), manifestPath)
      );

      if (Option.isNone(bytes)) {
        return Option.none<PushedManifest>();
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

      const uncited = Arr.dedupe(
        manifest.value.checks.flatMap(({ area, clause }) =>
          clause === undefined ? [area] : []
        )
      );

      if (Arr.isReadonlyArrayNonEmpty(uncited)) {
        yield* Effect.logWarning(
          `a check in ${layer} at ${at} cites no clause and is left out of its suite`,
          { areas: uncited }
        );
      }

      return Arr.sort(
        manifest.value.checks.flatMap((check): readonly Sealed[] => {
          const blob = blobs.get(check.path);

          return blob === undefined ||
            !areas.has(check.area) ||
            check.clause === undefined
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

  /** Deny by default: heads still proposed count too, so nothing from a layer enters a public tree, admitted or not. */
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

  const contentOf = (repo: RepoName, blob: ObjectId) =>
    Effect.flatMap(Effect.orDie(repos.readBlob(repo, blob)), (content) =>
      Option.match(content, {
        onNone: () =>
          Effect.die(`the layer repo ${repo} lost a blob its tree names`),
        onSome: Effect.succeed,
      })
    );

  const overlayAt = (
    repo: RepoName,
    at: CommitSha,
    head: ReadonlyMap<string, ObjectId>
  ) =>
    Effect.gen(function* () {
      const found = yield* Effect.orDie(repos.readCommit(repo, at));

      if (Option.isNone(found)) {
        yield* Effect.logWarning(
          `the layer repo ${repo} holds no known-bad commit ${at}`
        );

        return Option.none<readonly OverlayFile[]>();
      }

      const blobs = [...(yield* blobsAt(repo, at))].filter(
        ([path]) => !head.has(path)
      );

      return Option.some(
        yield* Effect.forEach(blobs, ([path, blob]) =>
          Effect.map(contentOf(repo, blob), (content): OverlayFile => ({
            content,
            path: RepoPath.make(path),
          }))
        )
      );
    });

  /** The runs carry a salt drawn here and kept nowhere: the landing draws its own. */
  const admissionOf = (
    input: { readonly head: CommitSha; readonly layer: LayerName },
    snapshot: ProjectSnapshot
  ) =>
    Effect.gen(function* () {
      const project = projectOf(snapshot);
      const policy = policyIn(snapshot);
      const checks = checksIn(visibilityIn(snapshot), input.layer);

      const main = Option.flatMap(snapshot.project, ({ landed }) =>
        Option.fromUndefinedOr(landed)
      );

      if (
        Option.isNone(project) ||
        Option.isNone(policy) ||
        Option.isNone(checks) ||
        Option.isNone(main)
      ) {
        return Option.none<AdmissionPlan>();
      }

      const row = rowFor(snapshot, project.value, input.layer);
      const manifest = yield* manifestAt(row.repo, row.name, input.head);

      if (Option.isNone(manifest)) {
        return Option.none<AdmissionPlan>();
      }

      const head = yield* blobsAt(row.repo, input.head);

      const landed =
        row.landedSha === undefined
          ? new Map<string, ObjectId>()
          : yield* blobsAt(row.repo, row.landedSha);

      const previous =
        row.landedSha === undefined
          ? Option.none<PushedManifest>()
          : yield* manifestAt(row.repo, row.name, row.landedSha);

      const files = new Map(
        yield* Effect.forEach(
          manifest.value.checks.flatMap(({ path }) =>
            Option.match(Option.fromUndefinedOr(head.get(path)), {
              onNone: () => [],
              onSome: (blob) => [[path, blob] as const],
            })
          ),
          ([path, blob]) =>
            Effect.map(
              contentOf(row.repo, blob),
              (content): readonly [string, LayerFile] => [
                path,
                { blob: BlobSha.make(blob), content },
              ]
            )
        )
      );

      const knownBad = new Map(
        Arr.getSomes(
          yield* Effect.forEach(Arr.dedupe(manifest.value.knownBad), (tree) =>
            Effect.map(overlayAt(row.repo, tree, head), (overlay) =>
              Option.map(overlay, (laid) => [tree, laid] as const)
            )
          )
        )
      );

      const sealed = manifest.value.checks.flatMap(({ area, path }) =>
        Option.match(Option.fromUndefinedOr(files.get(path)), {
          onNone: () => [],
          onSome: ({ blob }) =>
            Object.hasOwn(checks.value.areas, area)
              ? [{ area, blob, path }]
              : [],
        })
      );

      const plan = planAdmission({
        files,
        head: input.head,
        knownBad,
        landed: new Map(
          [...landed].map(([path, blob]) => [path, BlobSha.make(blob)])
        ),
        main: main.value,
        manifest: manifest.value,
        policy: checks.value,
        previous,
        run: policy.value.run,
        suite: yield* suiteRoot(yield* salts.next, sealed),
      });

      if (Result.isFailure(plan)) {
        yield* Effect.logWarning(
          `a check pushed to ${input.layer} cites no clause`,
          plan.failure
        );

        return Option.none<AdmissionPlan>();
      }

      return Option.some(plan.success);
    });

  const onLayerPush: VisibilityPort["onLayerPush"] = (input, snapshot) =>
    Effect.gen(function* () {
      const project = projectOf(snapshot);
      const visibility = visibilityIn(snapshot);

      // Only the layer's writers may push; anyone else, or an undeclared layer, moves nothing.
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

      if (row.landedSha === input.head || row.proposed === input.head) {
        return noPlan;
      }

      const owed = caughtUp(snapshot, visibility, input.now);
      const checks = checksIn(visibility, input.layer);
      const admits = Option.exists(checks, ({ admit }) => admit !== undefined);

      // A push that changes no held-back check has no runs, and lands at once.
      const planned = admits
        ? yield* admissionOf({ head: input.head, layer: input.layer }, snapshot)
        : Option.none<AdmissionPlan>();

      if (!admits || Option.exists(planned, ({ runs }) => runs.length === 0)) {
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

  // Only a head still proposed has a plan (every run step asks again).
  const admissionPlan: VisibilityPort["admissionPlan"] = (input, snapshot) =>
    Arr.some(
      snapshot.layers,
      ({ name, proposed }) => name === input.layer && proposed === input.head
    )
      ? admissionOf(input, snapshot)
      : Effect.succeedNone;

  const onAdmission: VisibilityPort["onAdmission"] = (input, snapshot) =>
    Effect.gen(function* () {
      const row = Arr.findFirst(
        snapshot.layers,
        ({ name, proposed }) => name === input.layer && proposed === input.head
      );

      const planned = Option.isNone(row)
        ? Option.none<AdmissionPlan>()
        : yield* admissionOf(
            { head: input.head, layer: input.layer },
            snapshot
          );

      if (Option.isNone(row) || Option.isNone(planned)) {
        return noPlan;
      }

      const judged = judgeAdmission(planned.value, input.results, input.now);
      const areas = Arr.dedupe(planned.value.runs.map(({ area }) => area));

      if (judged.admitted.length < areas.length) {
        yield* Effect.logWarning(
          `the push of ${input.head} to ${input.layer} was not admitted`,
          judged.refused
        );

        return noPlan;
      }

      const visibility = visibilityIn(snapshot);
      const owed = caughtUp(snapshot, visibility, input.now);
      const seq = nextSeq(snapshot.ledger) + owed.length;

      const landed = yield* landLayer({
        checks: checksIn(visibility, input.layer),
        head: input.head,
        now: input.now,
        row: row.value,
        seq,
      });

      const published = landed.ledger ?? [];

      const roots = new Map(
        published.flatMap((entry) =>
          LedgerEntry.guards.CommitmentPublished(entry)
            ? [[entry.area, entry.suite] as const]
            : []
        )
      );

      // Each admitted area cites its new commitment, never its runs' root (that salt was kept nowhere).
      const admitted = yield* Effect.forEach(judged.admitted, (entry, index) =>
        Option.match(Option.fromUndefinedOr(roots.get(entry.area)), {
          onNone: () =>
            Effect.die(
              `the landing of ${input.head} published no commitment for admitted area ${entry.area}`
            ),
          onSome: (suite) =>
            Effect.succeed({
              ...entry,
              seq: seq + published.length + index,
              suite,
            }),
        })
      );

      return planOf({
        ...landed,
        ...appended([...owed, ...published, ...admitted]),
      });
    });

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
    standing: (snapshot) => {
      const now = nowOf();
      const visibility = visibilityIn(snapshot);

      return {
        posture: standing({ decisions: snapshot.decisions, now, visibility })
          .posture,
        until: nextMove({ decisions: snapshot.decisions, now, visibility }),
      };
    },
  };

  return port;
});

export const ProjectVisibilityLive: Layer.Layer<
  never,
  never,
  AdmissionStarts | LayerRepos | SaltSource
> = Layer.effect(ProjectVisibility, live);
