/**
 * The visibility cartridge's env (W6 614; ADR 0009), as the `ProjectEnv`
 * port:
 *
 * - The env shape: every `.env.schema` at the landed SHA (the repo's root
 *   first, then each workspace package's folder), parsed through the
 *   parser seam and never resolved, read once per commit, with each
 *   sensitive item's who and when from the Project DO's rows. Never a value.
 * - Write-only values: only a person the policy lets set values (the
 *   deciders unless `visibility.env.setters` names others) sets one, only
 *   for a `@sensitive` item of the shape, sealed by the vault under the
 *   platform's master key; the row and a public `ValueSet` ledger entry are
 *   the call's writes, and nothing returns the value.
 * - The env a check runs with: a placeholder for every sensitive item and
 *   the `@proxy` items, so unlanded code never sees a value.
 * - The scan: the one place a stored value is opened, to find it in a text
 *   or a blob, and it answers with the item's key alone.
 * - After a landing: a `ProxyWidened` decision for each item whose value
 *   may now reach a host it could not before (Q20; VL §8.7 #4).
 */
import { RepoHost, Revision } from "@repo/artifacts/repo-host";
import { Hostname } from "@repo/protocol/domain/common";
import type { Evidence } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { EnvItem, EnvSchemaView } from "@repo/protocol/domain/env";
import type { Policy } from "@repo/protocol/domain/policy";
import type { Territory } from "@repo/protocol/domain/territory";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import { RepoName, RepoPath, sameHandle } from "@repo/protocol/ids";
import type {
  DecisionId,
  EnvKey,
  Handle,
  LandedSha,
  ProjectName,
} from "@repo/protocol/ids";
import {
  NotDecider,
  NotSensitive,
  UnknownEnvItem,
} from "@repo/protocol/refusal";
import { EnvSchemaParser } from "@repo/visibility/env-schema";
import { envSchemaViewOf } from "@repo/visibility/env-shape";
import { scanBytes, scanText } from "@repo/visibility/leak-scan";
import type { Watched } from "@repo/visibility/leak-scan";
import { SealedValue, WriteOnlyValues } from "@repo/visibility/vault";
import {
  Array,
  Cache,
  Data,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Schema,
} from "effect";

import { openDecision } from "../attention/decisions.ts";
import { decidersOn, isDecider, nextDecisionId } from "../deciders.ts";
import { noRunEnv, ProjectEnv } from "../env-port.ts";
import type { EnvPort, EnvSchemaFile } from "../env-port.ts";
import { ProjectEventInput } from "../events.ts";
import type { ProjectSnapshot } from "../project-store.ts";
import type { EnvValueRow } from "../project-store/rows.ts";
import { noPlan, policyIn } from "../visibility-port.ts";

/** The env schema's name, in the repo's root and in a package's folder. */
const schemaName = ".env.schema";

/** The root's env schema: where the shape lives when nothing else says. */
const rootSchema = RepoPath.make(schemaName);

/** A character that makes a path segment a glob. */
const GLOB = /[*?[{]/u;

/**
 * The folder a territory's glob covers: its fixed head (`packages/week/**`
 * → `packages/week`), or, for a glob naming one file, that file's folder.
 * The root is `""`.
 */
const folderOf = (glob: string): string => {
  const segments = glob
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");

  const fixed = Array.takeWhile(segments, (segment) => !GLOB.test(segment));

  return (fixed.length === segments.length ? fixed.slice(0, -1) : fixed).join(
    "/"
  );
};

/**
 * Where a project's env schemas live: `.env.schema` in the repo's root,
 * then `<package folder>/.env.schema` for each workspace package the
 * policy's territories name, in order, each once.
 */
export const schemaFilesAt = (
  modules: readonly Territory[]
): readonly RepoPath[] =>
  Array.dedupe([
    schemaName,
    ...modules.flatMap(({ paths }) =>
      paths.flatMap((glob) => {
        const folder = folderOf(glob);

        return folder === "" ? [] : [`${folder}/${schemaName}`];
      })
    ),
  ]).map((path) => RepoPath.make(path));

/** Whether `pattern` (a host, or a glob `*.example.com`) covers `host`. */
const covers = (pattern: string, host: string) =>
  pattern === host ||
  (pattern.startsWith("*.") && host.endsWith(pattern.slice(1)));

/**
 * The hosts an item's value may reach through the platform's proxy: its
 * `@proxy` domains, lower-cased, unless the rule blocks every request. Only
 * a sensitive item holds a value, so any other reaches none.
 */
const reachOf = (item: EnvItem | undefined): readonly string[] =>
  item?.sensitive === true &&
  item.proxy !== undefined &&
  item.proxy.block !== true
    ? Array.dedupe(item.proxy.domains.map((host) => host.toLowerCase()))
    : [];

/** A widened `@proxy`: the item, and every host its value may now reach. */
export interface Widened {
  readonly hosts: readonly Hostname[];
  readonly item: EnvKey;
}

/**
 * Each item of `after` whose value may reach a host that no host or glob
 * of `before` covered: a new `@proxy` domain, a new proxied item, or a rule
 * that blocked every request and no longer does. A narrowing, an unchanged
 * rule and a newly blocked one widen nothing. The hosts are all the item's
 * hosts after, as hostnames.
 */
export const widenedProxies = (
  before: Pick<EnvSchemaView, "items">,
  after: Pick<EnvSchemaView, "items">
): readonly Widened[] =>
  after.items.flatMap((item) => {
    const was = reachOf(before.items.find(({ key }) => key === item.key));
    const reach = reachOf(item);

    return reach.some((host) => !was.some((each) => covers(each, host)))
      ? [{ hosts: reach.filter(Schema.is(Hostname)), item: item.key }]
      : [];
  });

/** One commit's env schemas, as the cache keeps them. */
class ReadAt extends Data.Class<{
  readonly at: LandedSha;
  readonly files: readonly RepoPath[];
  readonly project: ProjectName;
}> {}

/**
 * A commit's env shape, read once: its items without any value's who and
 * when (the DO's rows add those), and the schema that declared each item.
 */
interface Read {
  readonly declaredIn: ReadonlyMap<EnvKey, RepoPath>;
  readonly schema: EnvSchemaFile;
}

/** A shape with no schema in it: no items. */
const unread: Read = {
  declaredIn: new Map(),
  schema: { file: rootSchema, imports: [], items: [] },
};

/** How many commits' shapes one project keeps read. */
const readCapacity = 16;

/**
 * Several schemas as one shape: the root's items, then each package's not
 * already declared (the first schema to declare a key holds it); the file
 * is the first schema read, the imports are every schema's, and the
 * current env key is the first one named.
 */
const merged = (views: readonly EnvSchemaView[]): Read => {
  const [first] = views;

  if (first === undefined) {
    return unread;
  }

  const declaredIn = new Map<EnvKey, RepoPath>();
  const items: EnvItem[] = [];

  for (const view of views) {
    for (const item of view.items) {
      if (!declaredIn.has(item.key)) {
        declaredIn.set(item.key, view.file);
        items.push(item);
      }
    }
  }

  const currentEnv = Array.findFirst(views, (view) =>
    Predicate.isNotUndefined(view.currentEnvKey)
  );

  return {
    declaredIn,
    schema: {
      file: first.file,
      imports: Array.dedupe(views.flatMap(({ imports }) => imports)),
      items,
      ...(Option.isSome(currentEnv) &&
        currentEnv.value.currentEnvKey !== undefined && {
          currentEnvKey: currentEnv.value.currentEnvKey,
        }),
    },
  };
};

/** The project's landed SHA and its row, once something landed. */
const landedIn = (snapshot: ProjectSnapshot) =>
  Option.flatMap(snapshot.project, (row) =>
    row.landed === undefined
      ? Option.none()
      : Option.some({ landed: row.landed, row })
  );

/**
 * Whether `handle` may set write-only values: one of the setters the
 * policy's `visibility.env` names, or, when it names the deciders or the
 * project declares no visibility, a decider.
 */
const maySet = (policy: Policy, handle: Handle) => {
  const setters = policy.visibility?.env.setters ?? "deciders";

  return setters === "deciders"
    ? isDecider(policy, handle)
    : setters.some((each) => sameHandle(each, handle));
};

/** An item with who set its value and when, from its row: only a sensitive item has one. */
const withValue = (
  item: EnvItem,
  rows: ReadonlyMap<EnvKey, EnvValueRow>
): EnvItem => {
  const row = rows.get(item.key);

  return item.sensitive && row !== undefined
    ? { ...item, value: { setAt: row.setAt, setBy: row.setBy } }
    : item;
};

const encodeSealed = Schema.encodeEffect(Schema.toCodecJson(SealedValue));

const decodeSealed = Schema.decodeUnknownEffect(
  Schema.toCodecJson(SealedValue)
);

/** A host list as evidence shows it: `none` before an item had any. */
const hostsText = (hosts: readonly string[]) =>
  hosts.length === 0 ? "none" : hosts.join(", ");

/**
 * The `ProjectEnv` port over the parser seam, the vault and the project's
 * repos (the public namespace's): the name 609's stub exported, so the
 * cartridge's `index.ts` and the platform compose it unchanged.
 */
export const ProjectEnvLive: Layer.Layer<
  never,
  never,
  EnvSchemaParser | WriteOnlyValues | RepoHost
> = Layer.effect(
  ProjectEnv,
  Effect.gen(function* () {
    const parser = yield* EnvSchemaParser;
    const vault = yield* WriteOnlyValues;
    const host = yield* RepoHost;

    /** One schema at a commit, as the public sees it; none where the commit has no such file, or it cannot be read. */
    const viewOf = (key: ReadAt, file: RepoPath) =>
      host
        .readFile(
          RepoName.make(key.project),
          Revision.Commit({ sha: key.at }),
          file
        )
        .pipe(
          Effect.orDie,
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeedNone,
              onSome: (bytes) =>
                parser.parse(file, new TextDecoder().decode(bytes)).pipe(
                  Effect.map((parsed) =>
                    Option.some(
                      envSchemaViewOf({
                        at: key.at,
                        file,
                        parsed,
                        project: key.project,
                      })
                    )
                  ),
                  Effect.catchTag("EnvSchemaUnreadable", ({ reason }) =>
                    Effect.as(
                      Effect.logWarning(
                        `the env schema ${file} at ${key.at} cannot be read: ${reason}`
                      ),
                      Option.none<EnvSchemaView>()
                    )
                  )
                ),
            })
          )
        );

    // Read once per commit: a landed commit's schemas never change. A
    // failed read is not kept, so the next call reads again.
    const reads = yield* Cache.makeWith(
      (key: ReadAt) =>
        Effect.map(
          Effect.forEach(key.files, (file) => viewOf(key, file)),
          (views) => merged(Array.getSomes(views))
        ),
      {
        capacity: readCapacity,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
      }
    );

    /** The shape at `at`, from the schemas the snapshot's policy places. */
    const readAt = (at: LandedSha, snapshot: ProjectSnapshot) =>
      Option.match(snapshot.project, {
        onNone: () => Effect.succeed(unread),
        onSome: (row) =>
          Cache.get(
            reads,
            new ReadAt({
              at,
              files: schemaFilesAt(
                Option.match(policyIn(snapshot), {
                  onNone: () => [],
                  onSome: ({ modules }) => modules,
                })
              ),
              project: row.project,
            })
          ),
      });

    /** The shape at the landed SHA; none before anything landed. */
    const landedRead = (snapshot: ProjectSnapshot) =>
      Option.match(landedIn(snapshot), {
        onNone: () => Effect.succeed(unread),
        onSome: ({ landed }) => readAt(landed, snapshot),
      });

    /** Every stored value, opened, to look for; dropped when the scan ends. */
    const watched = (rows: readonly EnvValueRow[]) =>
      Effect.forEach(rows, (row) =>
        decodeSealed(row.sealed).pipe(
          Effect.orDie,
          Effect.flatMap(vault.open),
          Effect.map((value): Watched => ({ key: row.key, value }))
        )
      );

    const port: EnvPort = {
      onLanded: ({ after, before, now }, snapshot) =>
        Effect.gen(function* () {
          const live = Option.all({
            before,
            landed: landedIn(snapshot),
            policy: policyIn(snapshot),
          });

          if (Option.isNone(live)) {
            return noPlan;
          }

          const { landed, policy } = live.value;
          const was = yield* readAt(live.value.before, snapshot);
          const is = yield* readAt(after, snapshot);
          const decisions = new Map<DecisionId, Decision>();

          for (const { hosts, item } of widenedProxies(was.schema, is.schema)) {
            const id = nextDecisionId(snapshot.decisions, decisions);

            const evidence: readonly Evidence[] = [
              {
                label: "before",
                value: hostsText(
                  reachOf(was.schema.items.find(({ key }) => key === item))
                ),
              },
              {
                label: "after",
                value: hostsText(
                  reachOf(is.schema.items.find(({ key }) => key === item))
                ),
              },
            ];

            decisions.set(
              id,
              openDecision({
                deciders: decidersOn(
                  policy,
                  [is.declaredIn.get(item) ?? rootSchema],
                  landed.row.initializer
                ),
                evidence,
                expireDays: policy.budget.expireDays,
                id,
                now,
                project: landed.row.project,
                subject: DecisionSubject.cases.ProxyWidened.make({
                  hosts,
                  item,
                }),
              })
            );
          }

          return {
            effects: [],
            writes: { decisions: [...decisions.values()] },
          };
        }),
      // A landed run would get the values opened; until the check job has
      // a field for them (611 adds it), a landed run sees the placeholders
      // too, and nothing here opens a value for any run.
      runEnv: (_landed, snapshot) =>
        Effect.map(landedRead(snapshot), ({ schema }) => {
          const sensitive = schema.items.filter((item) => item.sensitive);

          return sensitive.length === 0
            ? noRunEnv
            : {
                placeholders: sensitive.map(({ key }) => key),
                proxies: sensitive.filter((item) => item.proxy !== undefined),
              };
        }),
      scan: (scanned, snapshot) =>
        Array.isReadonlyArrayEmpty(snapshot.envValues)
          ? Effect.succeedNone
          : Effect.map(watched(snapshot.envValues), (values) =>
              "text" in scanned
                ? scanText(scanned.text, values)
                : scanBytes(scanned.blob, values)
            ),
      set: ({ acknowledgeShort, by, key, now, value }, snapshot) =>
        Effect.gen(function* () {
          const policy = policyIn(snapshot);

          if (!Option.exists(policy, (each) => maySet(each, by.handle))) {
            return yield* new NotDecider({});
          }

          const { schema } = yield* landedRead(snapshot);
          const item = schema.items.find((each) => each.key === key);

          if (item === undefined) {
            return yield* new UnknownEnvItem({ key });
          }

          if (!item.sensitive) {
            return yield* new NotSensitive({ key });
          }

          const sealed = yield* vault.put({ acknowledgeShort, key, value });

          // Who set which item's value, for the platform's own logs, as the
          // public ledger says it: never the value.
          yield* Effect.logInfo("a write-only value was set").pipe(
            Effect.annotateLogs({ by: by.handle, key })
          );

          const entry = LedgerEntry.cases.ValueSet.make({
            at: now,
            by: by.handle,
            key,
            seq: Math.max(0, ...snapshot.ledger.map(({ seq }) => seq)) + 1,
          });

          return {
            result: { key, setAt: now, setBy: by.handle },
            writes: {
              envValues: [
                {
                  key,
                  sealed: yield* Effect.orDie(encodeSealed(sealed)),
                  setAt: now,
                  setBy: by.handle,
                },
              ],
              events: [ProjectEventInput.LedgerAppended({ at: now, entry })],
              ledger: [entry],
            },
          };
        }),
      view: (at, snapshot) =>
        Effect.map(readAt(at, snapshot), ({ schema }) => {
          const rows = new Map(snapshot.envValues.map((row) => [row.key, row]));

          return {
            ...schema,
            items: schema.items.map((item) => withValue(item, rows)),
          };
        }),
    };

    return port;
  })
);
