import { RepoHost, Revision } from "@repo/artifacts/repo-host";
import type { EnvProxy } from "@repo/checks/check-runner";
import { Hostname } from "@repo/protocol/domain/common";
import type { Evidence } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { EnvItem, EnvSchemaView } from "@repo/protocol/domain/env";
import type { Policy } from "@repo/protocol/domain/policy";
import type { Territory } from "@repo/protocol/domain/territory";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import { keyOf, RepoName, RepoPath, sameHandle } from "@repo/protocol/ids";
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
import { placeholderFor, proxyMap } from "@repo/visibility/proxy";
import type { ProxyRule } from "@repo/visibility/proxy";
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

const schemaName = ".env.schema";

const rootSchema = RepoPath.make(schemaName);

const GLOB = /[*?[{]/u;

const folderOf = (glob: string): string => {
  const segments = glob
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");

  const fixed = Array.takeWhile(segments, (segment) => !GLOB.test(segment));

  return (fixed.length === segments.length ? fixed.slice(0, -1) : fixed).join(
    "/"
  );
};

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

const covers = (pattern: string, host: string) =>
  pattern === host ||
  (pattern.startsWith("*.") && host.endsWith(pattern.slice(1)));

/** Only a sensitive item holds a value, so any other reaches no host. */
const reachOf = (item: EnvItem | undefined): readonly string[] =>
  item?.sensitive === true &&
  item.proxy !== undefined &&
  item.proxy.block !== true
    ? Array.dedupe(item.proxy.domains.map((host) => host.toLowerCase()))
    : [];

const reachIn = (view: Pick<EnvSchemaView, "items">, key: EnvKey) =>
  reachOf(view.items.find((item) => item.key === key));

export interface Widened {
  readonly hosts: readonly Hostname[];
  readonly item: EnvKey;
}

export const widenedProxies = (
  before: Pick<EnvSchemaView, "items">,
  after: Pick<EnvSchemaView, "items">
): readonly Widened[] =>
  after.items.flatMap((item) => {
    const was = reachIn(before, item.key);
    const reach = reachOf(item);

    return reach.some((host) => !was.some((each) => covers(each, host)))
      ? [{ hosts: reach.filter(Schema.is(Hostname)), item: item.key }]
      : [];
  });

class ReadAt extends Data.Class<{
  readonly at: LandedSha;
  readonly files: readonly RepoPath[];
  readonly project: ProjectName;
}> {}

interface Read {
  readonly declaredIn: ReadonlyMap<EnvKey, RepoPath>;
  readonly schema: EnvSchemaFile;
}

const unread: Read = {
  declaredIn: new Map(),
  schema: { file: rootSchema, imports: [], items: [] },
};

const readCapacity = 16;

/** The first schema to declare a key holds it. */
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
    Option.fromUndefinedOr(view.currentEnvKey)
  );

  return {
    declaredIn,
    schema: {
      file: first.file,
      imports: Array.dedupe(views.flatMap(({ imports }) => imports)),
      items,
      ...(Option.isSome(currentEnv) && { currentEnvKey: currentEnv.value }),
    },
  };
};

const landedIn = (snapshot: ProjectSnapshot) =>
  Option.flatMap(snapshot.project, (row) =>
    row.landed === undefined
      ? Option.none()
      : Option.some({ landed: row.landed, row })
  );

const maySet = (policy: Policy, handle: Handle) => {
  const setters = policy.visibility?.env.setters ?? "deciders";

  return setters === "deciders"
    ? isDecider(policy, handle)
    : setters.some((each) => sameHandle(each, handle));
};

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

/** The check job's wire takes no empty method or path. */
const nonEmpty = (text: Option.Option<string>) =>
  Option.getOrUndefined(Option.filter(text, (each) => each !== ""));

const onTheWire = (rule: ProxyRule): EnvProxy => {
  const method = nonEmpty(rule.method);
  const path = nonEmpty(rule.path);

  return {
    block: rule.block,
    host: rule.host,
    key: rule.key,
    placeholder: rule.placeholder,
    ...(method !== undefined && { method }),
    ...(path !== undefined && { path }),
  };
};

const hostsText = (hosts: readonly string[]) =>
  hosts.length === 0 ? "none" : hosts.join(", ");

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

    const viewOf = (key: ReadAt, file: RepoPath) =>
      host
        .readFile(
          RepoName.make(keyOf(key.project)),
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

    // A landed commit's schemas never change; a failed read is not kept.
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

    const landedRead = (snapshot: ProjectSnapshot) =>
      Option.match(landedIn(snapshot), {
        onNone: () => Effect.succeed(unread),
        onSome: ({ landed }) => readAt(landed, snapshot),
      });

    /** Opened values to scan for; dropped when the scan ends. */
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
              { label: "before", value: hostsText(reachIn(was.schema, item)) },
              { label: "after", value: hostsText(reachIn(is.schema, item)) },
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
      // Only a run of landed code carries the values; the sandbox's env
      // gateway swaps them in on the way out.
      runEnv: ({ landed }, snapshot) =>
        Effect.gen(function* () {
          const { schema } = yield* landedRead(snapshot);
          const sensitive = schema.items.filter((item) => item.sensitive);

          if (sensitive.length === 0) {
            return noRunEnv;
          }

          const unlanded = {
            placeholders: sensitive.map((item) => ({
              key: item.key,
              placeholder: placeholderFor(item),
            })),
            proxies: proxyMap(schema).map(onTheWire),
          };

          if (!landed) {
            return unlanded;
          }

          const keys = new Set(sensitive.map(({ key }) => key));

          return {
            ...unlanded,
            landed,
            values: yield* watched(
              snapshot.envValues.filter((row) => keys.has(row.key))
            ),
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

          // Never the value.
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
