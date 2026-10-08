/**
 * The env shape's neutral port (W6 609; ADR 0009): a project's public env
 * schema, its write-only values, the env its checks run with, and the scan
 * that finds a stored value where it must not be. The default is a project
 * without the visibility cartridge: no items, no values, nothing to scan
 * for. The cartridge's `ProjectEnv` (614) parses `.env.schema` at the
 * landed SHA and seals values with the platform's master key.
 *
 * As `visibility-port.ts`: each method reads the project as the call has it
 * (`snapshot`) and returns its rows for the service to commit; nothing here
 * returns a value.
 */
import { CheckJob } from "@repo/checks/check-runner";
import type { EnvSchemaView } from "@repo/protocol/domain/env";
import { RepoPath, sameHandle } from "@repo/protocol/ids";
import type { EnvKey, Handle, LandedSha } from "@repo/protocol/ids";
import type { Person } from "@repo/protocol/principal";
import { NotDecider, UnknownEnvItem } from "@repo/protocol/refusal";
import type { NotSensitive, ValueTooShort } from "@repo/protocol/refusal";
import { Context, Effect, Layer, Option, Schema, Struct } from "effect";
import type { DateTime, Redacted } from "effect";

import type { ProjectSnapshot, ProjectWrites } from "./project-store.ts";
import { noPlan, policyIn } from "./visibility-port.ts";
import type { VisibilityPlan } from "./visibility-port.ts";

/**
 * The env a check job carries: what unlanded code sees in place of each
 * write-only value, and the outbound hosts whose requests the platform
 * rewrites. The `CheckJob`'s own fields, so the job's schema decides their
 * form (611 reshapes them) and this follows.
 */
export const RunEnv = Schema.Struct(
  Struct.pick(CheckJob.fields, ["placeholders", "proxies"])
);

export type RunEnv = typeof RunEnv.Type;

/** The env a job carries when the project has no write-only values: none. */
export const noRunEnv: RunEnv = { placeholders: [], proxies: [] };

/** A project's env schema at one commit, as `envShape` shows it but for where and whose. */
export type EnvSchemaFile = Omit<EnvSchemaView, "at" | "project">;

/** Where the env schema lives: the repo's root (VL §8.3). */
const envFile = RepoPath.make(".env.schema");

/** A write-only value set: what `setEnv` answers with, and the rows that keep it sealed. */
export interface ValueSet {
  readonly result: {
    readonly key: EnvKey;
    readonly setAt: DateTime.Utc;
    readonly setBy: Handle;
  };
  readonly writes: ProjectWrites;
}

/** What `scan` searches: a text that leaves a run, or a blob an answer adds. */
export type Scanned = { readonly text: string } | { readonly blob: Uint8Array };

/** The project's env, as the project service reaches it. */
export interface EnvPort {
  /** The env schema at a landed commit: its file, imports and items, each sensitive item with who set its value and when. */
  readonly view: (
    at: LandedSha,
    snapshot: ProjectSnapshot
  ) => Effect.Effect<EnvSchemaFile>;
  /** A write-only value for one sensitive item, sealed; never returned. */
  readonly set: (
    input: {
      readonly acknowledgeShort: boolean;
      readonly by: Person;
      readonly key: EnvKey;
      readonly now: DateTime.Utc;
      readonly value: Redacted.Redacted;
    },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<
    ValueSet,
    NotDecider | UnknownEnvItem | NotSensitive | ValueTooShort
  >;
  /** The env a check runs with: placeholders and proxies for unlanded code, the values only for landed code. */
  readonly runEnv: (
    input: { readonly landed: boolean },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<RunEnv>;
  /** The stored value `scanned` contains, by its item's key; none when it holds none. */
  readonly scan: (
    scanned: Scanned,
    snapshot: ProjectSnapshot
  ) => Effect.Effect<Option.Option<EnvKey>>;
  /** After a landing moved the landed SHA: a `ProxyWidened` decision for each widened `@proxy`. */
  readonly onLanded: (
    input: {
      readonly after: LandedSha;
      readonly before: Option.Option<LandedSha>;
      readonly now: DateTime.Utc;
    },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<VisibilityPlan>;
}

/** Whether `handle` decides anything in the project the snapshot holds. */
const decides = (snapshot: ProjectSnapshot, handle: Handle) =>
  Option.exists(policyIn(snapshot), (policy) =>
    policy.deciders.some(({ handles }) =>
      handles.some((each) => sameHandle(each, handle))
    )
  );

/**
 * A project without the cartridge's env: no items, so no value to set (a
 * decider asking is told the item is unknown; anyone else, that only
 * deciders set values), nothing for a check but its own env, and nothing to
 * scan for.
 */
export const noEnv: EnvPort = {
  onLanded: () => Effect.succeed(noPlan),
  runEnv: () => Effect.succeed(noRunEnv),
  scan: () => Effect.succeedNone,
  set: ({ by, key }, snapshot) =>
    Effect.fail(
      decides(snapshot, by.handle)
        ? new UnknownEnvItem({ key })
        : new NotDecider({})
    ),
  view: () => Effect.succeed({ file: envFile, imports: [], items: [] }),
};

/**
 * How a host gives the project service its env. The default is `noEnv`,
 * so a host that provides nothing runs the platform without it.
 */
export const ProjectEnv = Context.Reference<EnvPort>("project/ProjectEnv", {
  defaultValue: () => noEnv,
});

/** The default, said out loud: a project without the cartridge's env. */
export const NoEnv: Layer.Layer<never> = Layer.succeed(ProjectEnv, noEnv);
