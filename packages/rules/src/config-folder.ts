import { AskInput, PolicyInput } from "@repo/protocol/domain/policy";
import { VisibilityPolicy } from "@repo/protocol/domain/visibility";
import { AskId, Handle, RepoPath } from "@repo/protocol/ids";
import { Effect, Option, Schema, Struct } from "effect";

import { defaultPolicyInput } from "./defaults.ts";
import { RulesFailed } from "./rules-evaluator.ts";
import type { ConfigBundle } from "./rules-evaluator.ts";

const ASK_FILE = /\.ask\.[cm]?[jt]s$/u;

const SCRIPT = /\.[cm]?[jt]s$/u;

/** The bundle names the folder, so `rules` never spells the brand. */
const folderOf = (bundle: ConfigBundle) =>
  bundle.entry.slice(0, bundle.entry.lastIndexOf("/") + 1);

export const policyJsonOf = (bundle: ConfigBundle) =>
  `${folderOf(bundle)}policy.json`;

export const projectModule = (bundle: ConfigBundle): string | undefined =>
  SCRIPT.test(bundle.entry) && Object.hasOwn(bundle.modules, bundle.entry)
    ? bundle.entry
    : undefined;

const VISIBILITY_FILE = /^visibility\.[cm]?[jt]s$/u;

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

export const askModules = (bundle: ConfigBundle): readonly string[] => {
  const asks = `${folderOf(bundle)}asks/`;

  return Object.keys(bundle.modules)
    .filter((path) => path.startsWith(asks) && ASK_FILE.test(path))
    .toSorted();
};

export const failedAt =
  (where: string) =>
  (failure: Schema.SchemaError): RulesFailed =>
    new RulesFailed({
      detail: `${where}: ${failure.message}`,
      reason: "decode",
    });

const noDefault = (path: string, what: string) =>
  new RulesFailed({
    detail: `${path}: its default export is not ${what}`,
    reason: "decode",
  });

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

/** Its source is the config folder whenever there is one, so every adapter gives one bundle the same source. */
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

export const Collected = Schema.Struct({
  asks: Schema.Array(Schema.Struct({ ask: Schema.Json, path: Schema.String })),
  project: Schema.optionalKey(Schema.Json),
  visibility: Schema.optionalKey(Schema.Json),
});

export type Collected = typeof Collected.Type;

const AskFile = Schema.Struct({
  ...Struct.omit(AskInput.fields, ["askedBy", "blockedBy", "file", "id"]),
  askedBy: Schema.optionalKey(Handle),
  blockedBy: Schema.optionalKey(Schema.Array(AskId)),
});

const ProjectFile = PolicyInput.mapFields(
  Struct.omit(["asks", "source", "visibility"])
);

const idOf = (path: string) =>
  path.slice(path.lastIndexOf("/") + 1).replace(ASK_FILE, "");

/** The id and file come from the path, whatever the data says. */
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

export const fromCollected = (input: {
  readonly collected: Collected;
  readonly entry: string;
  readonly fallback: PolicyInput;
  readonly initializer: Handle;
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
