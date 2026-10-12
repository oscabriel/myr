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

/** Never holds a value, so it may be stored and cross a Workflow step. */
export const UnlandedRunEnv = Schema.Struct(
  Struct.pick(CheckJob.fields, ["placeholders", "proxies"])
);

export type UnlandedRunEnv = typeof UnlandedRunEnv.Type;

/** Holds opened values for landed code: never stored, never in a Workflow step's output. */
export const RunEnv = Schema.Struct(
  Struct.pick(CheckJob.fields, ["landed", "placeholders", "proxies", "values"])
);

export type RunEnv = typeof RunEnv.Type;

export const noRunEnv: UnlandedRunEnv = { placeholders: [], proxies: [] };

export type EnvSchemaFile = Omit<EnvSchemaView, "at" | "project">;

const envFile = RepoPath.make(".env.schema");

export interface ValueSet {
  readonly result: {
    readonly key: EnvKey;
    readonly setAt: DateTime.Utc;
    readonly setBy: Handle;
  };
  readonly writes: ProjectWrites;
}

export type Scanned = { readonly text: string } | { readonly blob: Uint8Array };

export interface EnvPort {
  readonly view: (
    at: LandedSha,
    snapshot: ProjectSnapshot
  ) => Effect.Effect<EnvSchemaFile>;
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
  readonly runEnv: (
    input: { readonly landed: boolean },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<RunEnv>;
  readonly scan: (
    scanned: Scanned,
    snapshot: ProjectSnapshot
  ) => Effect.Effect<Option.Option<EnvKey>>;
  readonly onLanded: (
    input: {
      readonly after: LandedSha;
      readonly before: Option.Option<LandedSha>;
      readonly now: DateTime.Utc;
    },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<VisibilityPlan>;
}

const decides = (snapshot: ProjectSnapshot, handle: Handle) =>
  Option.exists(policyIn(snapshot), (policy) =>
    policy.deciders.some(({ handles }) =>
      handles.some((each) => sameHandle(each, handle))
    )
  );

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

export const ProjectEnv = Context.Reference<EnvPort>("project/ProjectEnv", {
  defaultValue: () => noEnv,
});

export const NoEnv: Layer.Layer<never> = Layer.succeed(ProjectEnv, noEnv);
