/**
 * The facts the gate and the rules evaluator decide over, gathered from the
 * repos through `RepoHost`: the gate's `PushFacts` for one push (its change
 * list, the lines it added, where it goes), and the rules' `EvaluationFacts`
 * at one commit (its CI and manifest files, its workspaces, its vouch file).
 * Neither the gate nor rule code reads a repo; the project service hands
 * them these.
 */
import { ObjectId, RepoHost, Revision } from "@repo/artifacts/repo-host";
import type { RepoNotFound, TreeEntry } from "@repo/artifacts/repo-host";
import { PushTarget } from "@repo/gate/facts";
import type { PushFacts } from "@repo/gate/facts";
import { addedLines, treeDiff } from "@repo/git/tree-diff";
import type { Change } from "@repo/git/tree-diff";
import type { Ask } from "@repo/protocol/domain/ask";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { RefNameText } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  AskId,
  Handle,
  LayerName,
  RepoPath,
  TreeSha,
} from "@repo/protocol/ids";
import type {
  CommitSha,
  LandedSha,
  ProjectName,
  RepoName,
} from "@repo/protocol/ids";
import type { Principal } from "@repo/protocol/principal";
import type { EvaluationFacts } from "@repo/rules/rules-evaluator";
import { Array, Effect, Option, Predicate, Schema } from "effect";
import type { DateTime } from "effect";

/** A commit the push names that the repo does not hold. */
export class MissingCommit extends Schema.TaggedError<MissingCommit>()(
  "MissingCommit",
  { sha: Schema.String }
) {}

const asAsk = Schema.decodeUnknownOption(AskId);

const asHandle = Schema.decodeUnknownOption(Handle);

const asLayer = Schema.decodeUnknownOption(LayerName);

/**
 * Where a push goes, read from the repo's name (spec §4.5): `<project>`,
 * `<project>--<ask>--<handle>`, `<project>--me--<handle>` or
 * `<project>--<layer>`. Any other name is read as canonical's, which takes
 * no push.
 */
export const targetOf = (repo: RepoName, project: ProjectName): PushTarget => {
  const [named, second, third, ...rest] = repo.split("--");
  const canonical = PushTarget.Canonical({ project });

  if (named !== project || rest.length > 0 || second === undefined) {
    return canonical;
  }

  if (third === undefined) {
    return Option.match(asLayer(second), {
      onNone: () => canonical,
      onSome: (layer) => PushTarget.Layer({ layer, project }),
    });
  }

  if (second === "me") {
    return Option.match(asHandle(third), {
      onNone: () => canonical,
      onSome: (owner) => PushTarget.WorkingFork({ owner, project }),
    });
  }

  return Option.match(
    Option.all({ ask: asAsk(second), claimant: asHandle(third) }),
    {
      onNone: () => canonical,
      onSome: ({ ask, claimant }) =>
        PushTarget.ClaimFork({ ask, claimant, project }),
    }
  );
};

const commitIn = (repo: RepoName, sha: CommitSha) =>
  RepoHost.use((host) => host.readCommit(repo, sha)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new MissingCommit({ sha })),
        onSome: Effect.succeed,
      })
    )
  );

const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const ScriptsOf = Schema.fromJsonString(
  Schema.Struct({ scripts: Schema.optionalKey(Schema.Json) })
);

const decodeScripts = Schema.decodeUnknownOption(ScriptsOf);

/** A `package.json` blob's `scripts`, as canonical JSON text; none when it reads as no manifest. */
const scriptsIn = (repo: RepoName, blob: string | undefined) =>
  blob === undefined
    ? Effect.succeed("")
    : RepoHost.use((host) => host.readBlob(repo, ObjectId.make(blob))).pipe(
        Effect.map((bytes) =>
          Option.flatMap(bytes, (read) => decodeScripts(textOf(read))).pipe(
            Option.map(({ scripts }) => JSON.stringify(scripts ?? null)),
            Option.getOrElse(() => "")
          )
        )
      );

/** Whether the root manifest's `scripts` differ between the change's two blobs. */
const scriptsChanged = (repo: RepoName, changes: readonly Change[]) =>
  Option.match(
    Array.findFirst(changes, (change) => change.path === "package.json"),
    {
      onNone: () => Effect.succeed(false),
      onSome: (change) =>
        Effect.map(
          Effect.all([
            scriptsIn(repo, change.before),
            scriptsIn(repo, change.after),
          ]),
          ([before, after]) => before !== after
        ),
    }
  );

/** What `pushFacts` is told: the push, and what the project knows about it. */
export interface PushInput {
  readonly ask: Option.Option<Ask>;
  readonly base: CommitSha;
  readonly claim: Option.Option<ClaimView>;
  /** How many live claims the pusher holds, for `CapReached`. */
  readonly claimsHeld: number;
  readonly head: CommitSha;
  readonly landed: LandedSha;
  readonly policy: Policy;
  readonly project: ProjectName;
  readonly pusher: Principal;
  readonly ref: string;
  /** The repo the push went to, which holds `base` and `head`. */
  readonly repo: RepoName;
}

/**
 * The gate's facts for one push: its change list from `base` to `head` (by
 * subtree ids, through the port), the lines it added, where it goes, and
 * whether it moved the root manifest's scripts. No layer paths or ratchet
 * counts yet (W6, W4). A commit the repo lacks is `MissingCommit`.
 */
export const pushFacts = (
  input: PushInput
): Effect.Effect<PushFacts, RepoNotFound | MissingCommit, RepoHost> =>
  Effect.gen(function* () {
    const base = yield* commitIn(input.repo, input.base);
    const head = yield* commitIn(input.repo, input.head);

    const changes = yield* treeDiff(
      input.repo,
      TreeSha.make(base.tree),
      TreeSha.make(head.tree)
    );

    return {
      addedLines: yield* addedLines(input.repo, changes),
      ask: input.ask,
      base: input.base,
      changes,
      claim: input.claim,
      claimsHeld: input.claimsHeld,
      head: input.head,
      landed: input.landed,
      layerPaths: new Set(),
      opensAsk: false,
      policy: input.policy,
      pusher: input.pusher,
      ref: Option.getOrElse(Schema.decodeOption(RefNameText)(input.ref), () =>
        RefNameText.make("refs/heads/main")
      ),
      scriptsChanged: yield* scriptsChanged(input.repo, changes),
      target: targetOf(input.repo, input.project),
    } satisfies PushFacts;
  });

// ------------------------------------------------------------ rules facts

// The folders whose files the run-block finder reads (spec §4.2 `checks`).
const CI_FOLDERS = [".github/workflows", ".forgejo/workflows", ".husky"];

// A file the finder reads is small; a large one is no config.
const MAX_FACT_BYTES = 256 * 1024;

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    exports: Schema.optionalKey(Schema.Json),
    name: Schema.optionalKey(Schema.String),
    workspaces: Schema.optionalKey(Schema.Json),
  })
);

const decodeManifest = Schema.decodeUnknownOption(Manifest);

/** The entries of the folder at `path` (`""` for the root) of a tree. */
const folderAt = (
  repo: RepoName,
  root: ObjectId,
  path: string
): Effect.Effect<readonly TreeEntry[], RepoNotFound, RepoHost> =>
  Effect.reduce(
    path === "" ? [] : path.split("/"),
    (): Option.Option<ObjectId> => Option.some(root),
    (folder, segment) =>
      Option.match(folder, {
        onNone: () => Effect.succeedNone,
        onSome: (id) =>
          RepoHost.use((host) => host.readTree(repo, id)).pipe(
            Effect.map((entries) =>
              Option.flatMap(entries, (found) =>
                Option.fromNullishOr(
                  found.find(
                    (entry) => entry.name === segment && entry.type === "tree"
                  )?.sha
                )
              )
            )
          ),
      })
  ).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed([]),
        onSome: (id) =>
          RepoHost.use((host) => host.readTree(repo, id)).pipe(
            Effect.map(Option.getOrElse(() => []))
          ),
      })
    )
  );

/** Each blob directly in a folder, as a path and its text. */
const filesIn = (repo: RepoName, root: ObjectId, folder: string) =>
  Effect.flatMap(folderAt(repo, root, folder), (entries) =>
    Effect.forEach(
      entries.filter(({ type }) => type === "blob"),
      (entry) =>
        RepoHost.use((host) => host.readBlob(repo, entry.sha)).pipe(
          Effect.map((bytes) =>
            Option.filter(bytes, (read) => read.length <= MAX_FACT_BYTES).pipe(
              Option.map((read) => ({
                content: textOf(read),
                path: RepoPath.make(
                  folder === "" ? entry.name : `${folder}/${entry.name}`
                ),
              }))
            )
          )
        )
    ).pipe(Effect.map(Array.getSomes))
  );

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  globalThis.Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value) && !isJsonArray(value);

const strings = (value: Schema.Json | undefined): readonly string[] =>
  value !== undefined && isJsonArray(value)
    ? value.filter(Predicate.isString)
    : [];

/** A manifest's `workspaces`: an array of globs, or `{ packages: [...] }`. */
const workspaceGlobs = (value: Schema.Json | undefined): readonly string[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (isJsonArray(value)) {
    return strings(value);
  }

  return isJsonObject(value) ? strings(value.packages) : [];
};

/** Every string an `exports` field leads to, nested conditions included. */
const exportTargets = (value: Schema.Json | undefined): readonly string[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (Predicate.isString(value)) {
    return [value];
  }

  if (isJsonArray(value)) {
    return value.flatMap(exportTargets);
  }

  return isJsonObject(value) ? Object.values(value).flatMap(exportTargets) : [];
};

const withoutDotSlash = (path: string) => path.replace(/^(?:\.\/)+/u, "");

/**
 * The folders a workspace glob names: `packages/*` is every folder in
 * `packages`, and a glob with no `*` is its own folder. Deeper globs are
 * read as their folder prefix's children.
 */
const foldersOf = (repo: RepoName, root: ObjectId, glob: string) => {
  const clean = withoutDotSlash(glob).replace(/\/+$/u, "");
  const star = clean.indexOf("*");

  if (star === -1) {
    return Effect.succeed([clean]);
  }

  const parent = clean.slice(0, star).replace(/\/+$/u, "");

  return Effect.map(folderAt(repo, root, parent), (entries) =>
    entries
      .filter(({ type }) => type === "tree")
      .map(({ name }) => (parent === "" ? name : `${parent}/${name}`))
  );
};

/** One workspace package: its folder, its name, and the files its `exports` name. */
const workspaceAt = (repo: RepoName, root: ObjectId, dir: string) =>
  Effect.map(filesIn(repo, root, dir), (files) =>
    Option.flatMap(
      Option.fromNullishOr(
        files.find(({ path }) => path === `${dir}/package.json`)
      ),
      ({ content }) => decodeManifest(content)
    ).pipe(
      Option.flatMap((manifest) =>
        Option.map(Option.fromNullishOr(manifest.name), (name) => ({
          dir,
          exports: exportTargets(manifest.exports).map((target) =>
            RepoPath.make(`${dir}/${withoutDotSlash(target)}`)
          ),
          name,
        }))
      ),
      Option.filter(({ name }) => name.length > 0)
    )
  );

/** What `evaluationFacts` is told besides the commit. */
export interface FactsInput {
  readonly initializer: Handle;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  /** Where the vouch file is, as the policy before this commit says. */
  readonly vouchFile: RepoPath;
}

/**
 * The rules' facts at one commit of `repo`: the files at its root and in
 * its CI folders (what the run-block finder and the judge closure read), the
 * workspaces its root manifest declares, and its vouch file. The seed is the
 * commit's own first eight hex digits, so the same commit always sees the
 * same randomness. A commit the repo lacks gives empty facts: the evaluation
 * then decides on its config folder alone.
 */
export const evaluationFacts = (
  repo: RepoName,
  at: CommitSha,
  input: FactsInput
): Effect.Effect<EvaluationFacts, never, RepoHost> => {
  const empty: EvaluationFacts = {
    ci: [],
    initializer: input.initializer,
    now: input.now,
    project: input.project,
    seed: Number.parseInt(at.slice(0, 8), 16),
    workspaces: [],
  };

  return Effect.gen(function* () {
    const commit = yield* RepoHost.use((host) => host.readCommit(repo, at));

    if (Option.isNone(commit)) {
      return empty;
    }

    const root = commit.value.tree;
    const atRoot = yield* filesIn(repo, root, "");

    const ci = [
      ...atRoot,
      ...(yield* Effect.forEach(CI_FOLDERS, (folder) =>
        filesIn(repo, root, folder)
      )).flat(),
    ];

    const globs = Option.match(
      Option.flatMap(
        Option.fromNullishOr(
          atRoot.find(({ path }) => path === "package.json")
        ),
        ({ content }) => decodeManifest(content)
      ),
      {
        onNone: () => [],
        onSome: (manifest) => workspaceGlobs(manifest.workspaces),
      }
    );

    const dirs = Array.dedupe(
      (yield* Effect.forEach(globs, (glob) =>
        foldersOf(repo, root, glob)
      )).flat()
    );

    const workspaces = Array.getSomes(
      yield* Effect.forEach(dirs, (dir) => workspaceAt(repo, root, dir))
    );

    const vouch = yield* RepoHost.use((host) =>
      host.readFile(repo, Revision.Commit({ sha: at }), input.vouchFile)
    );

    const facts: EvaluationFacts = { ...empty, ci, workspaces };

    return Option.match(vouch, {
      onNone: () => facts,
      onSome: (bytes) => ({ ...facts, vouchFile: textOf(bytes) }),
    });
  }).pipe(Effect.catchTag("RepoNotFound", () => Effect.succeed(empty)));
};
