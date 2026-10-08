import { AskInput, PolicyInput } from "@repo/protocol/domain/policy";
import { VisibilityPolicy } from "@repo/protocol/domain/visibility";
import { AskId, Handle, RepoPath } from "@repo/protocol/ids";
import { Effect, Option, Schema, Struct } from "effect";

import { defaultPolicyInput } from "./defaults.ts";
import { RulesFailed } from "./rules-evaluator.ts";
import type { ConfigBundle } from "./rules-evaluator.ts";

// An ask file: `<id>.ask.ts`, or the `.js` a bundler writes for it.
const ASK_FILE = /\.ask\.[cm]?[jt]s$/u;

// A module that runs: TypeScript or JavaScript, not JSON or a vouch file.
const SCRIPT = /\.[cm]?[jt]s$/u;

/**
 * The config folder a bundle holds: its project module's folder. The bundle
 * names it, so `rules` never spells it (the brand lives in `packages/brand`,
 * which `rules` does not import).
 */
const folderOf = (bundle: ConfigBundle) =>
  bundle.entry.slice(0, bundle.entry.lastIndexOf("/") + 1);

/** Where a committed policy stands in for the TypeScript (the fallback). */
export const policyJsonOf = (bundle: ConfigBundle) =>
  `${folderOf(bundle)}policy.json`;

/** The bundle's project module, when it has one. */
export const projectModule = (bundle: ConfigBundle): string | undefined =>
  SCRIPT.test(bundle.entry) && Object.hasOwn(bundle.modules, bundle.entry)
    ? bundle.entry
    : undefined;

// The visibility module: `visibility.ts`, or the `.js` a bundler writes for it.
const VISIBILITY_FILE = /^visibility\.[cm]?[jt]s$/u;

/**
 * The bundle's visibility module (`<folder>/visibility.ts`), when it has
 * one: the project's layers and held-back checks.
 */
export const visibilityModule = (bundle: ConfigBundle): string | undefined => {
  const folder = folderOf(bundle);

  return Object.keys(bundle.modules)
    .toSorted()
    .find(
      (path) =>
        path.startsWith(folder) &&
        VISIBILITY_FILE.test(path.slice(folder.length))
    );
};

/** The bundle's ask files, in path order so evaluation is the same every time. */
export const askModules = (bundle: ConfigBundle): readonly string[] => {
  const asks = `${folderOf(bundle)}asks/`;

  return Object.keys(bundle.modules)
    .filter((path) => path.startsWith(asks) && ASK_FILE.test(path))
    .toSorted();
};

/** A decode failure, named by the file it came from. */
export const failedAt =
  (where: string) =>
  (failure: Schema.SchemaError): RulesFailed =>
    new RulesFailed({
      detail: `${where}: ${failure.message}`,
      reason: "decode",
    });

/** A module whose default export is missing (or `null`) states nothing. */
const noDefault = (path: string, what: string) =>
  new RulesFailed({
    detail: `${path}: its default export is not ${what}`,
    reason: "decode",
  });

/**
 * The policy a committed `policy.json` states, when the bundle has one. It
 * carries its asks inline.
 */
const fromPolicyJson = (
  bundle: ConfigBundle
): Effect.Effect<Option.Option<PolicyInput>, RulesFailed> => {
  const path = policyJsonOf(bundle);
  const source = bundle.modules[path];

  return source === undefined
    ? Effect.succeedNone
    : Schema.decodeEffect(Schema.fromJsonString(PolicyInput))(source).pipe(
        Effect.map((policy) =>
          Option.some({ ...policy, source: "config" as const })
        ),
        Effect.mapError(failedAt(path))
      );
};

/**
 * The policy input a bundle states without running code: its `policy.json`,
 * or else the defaults. Its source is the config folder whenever there is
 * one, and the defaults only when there is none, so every
 * adapter gives one bundle the same source.
 */
export const statedWithoutCode = (
  bundle: ConfigBundle
): Effect.Effect<PolicyInput, RulesFailed> =>
  Effect.map(
    fromPolicyJson(bundle),
    Option.getOrElse((): PolicyInput =>
      Object.keys(bundle.modules).length === 0
        ? defaultPolicyInput
        : { ...defaultPolicyInput, source: "config" }
    )
  );

/** What the config folder's modules exported, as data, read back from the sandbox. */
export const Collected = Schema.Struct({
  asks: Schema.Array(Schema.Struct({ ask: Schema.Json, path: Schema.String })),
  /** Absent when the bundle has no project module; `null` when it exports nothing. */
  project: Schema.optionalKey(Schema.Json),
  /** Absent when the bundle has no visibility module; `null` when it exports nothing. */
  visibility: Schema.optionalKey(Schema.Json),
});

export type Collected = typeof Collected.Type;

/**
 * An ask as its file states it: the path names it (its id and file), and
 * the asker and what blocks it may go unsaid.
 */
const AskFile = Schema.Struct({
  ...Struct.omit(AskInput.fields, ["askedBy", "blockedBy", "file", "id"]),
  askedBy: Schema.optionalKey(Handle),
  blockedBy: Schema.optionalKey(Schema.Array(AskId)),
});

/**
 * A project module's data: its asks are the ask files, its source the
 * folder, and its visibility the visibility module's.
 */
const ProjectFile = PolicyInput.mapFields(
  Struct.omit(["asks", "source", "visibility"])
);

/** An ask's id: its file's name less `.ask.ts`. */
const idOf = (path: string) =>
  path.slice(path.lastIndexOf("/") + 1).replace(ASK_FILE, "");

/**
 * An ask file's data as an `AskInput`. The id and file come from the path,
 * whatever the data says; an ask that names no asker was asked by the
 * initializer, and one that names nothing blocking it is blocked by nothing.
 */
const askInputOf = (path: string, data: Schema.Json, initializer: Handle) =>
  Effect.gen(function* () {
    if (data === null) {
      return yield* noDefault(path, "an ask");
    }

    const ask = yield* Schema.decodeUnknownEffect(AskFile)(data).pipe(
      Effect.mapError(failedAt(path))
    );

    const id = yield* Schema.decodeEffect(AskId)(idOf(path)).pipe(
      Effect.mapError(failedAt(`${path}'s file name`))
    );

    return {
      ...ask,
      askedBy: ask.askedBy ?? initializer,
      blockedBy: ask.blockedBy ?? [],
      file: RepoPath.make(path),
      id,
    } satisfies AskInput;
  });

/**
 * The visibility module's data as the project's `VisibilityPolicy`, when
 * the folder has one; a module that exports nothing, or no policy, fails
 * naming it.
 */
const visibilityOf = (
  data: Schema.Json | undefined,
  path: string | undefined
): Effect.Effect<Option.Option<VisibilityPolicy>, RulesFailed> => {
  if (data === undefined) {
    return Effect.succeedNone;
  }

  const where = path ?? "visibility.ts";

  return data === null
    ? Effect.fail(noDefault(where, "a visibility policy"))
    : Schema.decodeUnknownEffect(VisibilityPolicy)(data).pipe(
        Effect.map(Option.some),
        Effect.mapError(failedAt(where))
      );
};

/**
 * The policy input the config folder's modules give: the project module's
 * data, or `fallback` when the folder has no project module (its
 * `policy.json`, or the defaults), with every ask file's ask after the
 * fallback's own, and the visibility module's policy when the folder has
 * one (else the fallback's). Its source is the config folder.
 */
export const fromCollected = (input: {
  readonly collected: Collected;
  readonly entry: string;
  readonly fallback: PolicyInput;
  readonly initializer: Handle;
  /** The visibility module's path, which a failure names. */
  readonly visibility?: string | undefined;
}): Effect.Effect<PolicyInput, RulesFailed> =>
  Effect.gen(function* () {
    const { collected, entry, fallback, initializer } = input;
    const { project } = collected;

    if (project === null) {
      return yield* noDefault(entry, "a project");
    }

    const base =
      project === undefined
        ? fallback
        : {
            ...(yield* Schema.decodeUnknownEffect(ProjectFile)(project).pipe(
              Effect.mapError(failedAt(entry))
            )),
            asks: [],
          };

    const asks: AskInput[] = [...base.asks];

    for (const { ask, path } of collected.asks) {
      asks.push(yield* askInputOf(path, ask, initializer));
    }

    const visibility = yield* visibilityOf(
      collected.visibility,
      input.visibility
    );

    return Option.match(visibility, {
      onNone: () => ({ ...base, asks, source: "config" as const }),
      onSome: (stated) => ({
        ...base,
        asks,
        source: "config" as const,
        visibility: stated,
      }),
    });
  });
