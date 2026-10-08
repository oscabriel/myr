/**
 * The facts the gate and the rules evaluator decide over, gathered from the
 * repos through `RepoHost`: the gate's `PushFacts` for one push (its change
 * list, the lines it added, where it goes), and the rules' `EvaluationFacts`
 * at one commit (the files its finder and judge closure read, its
 * workspaces, its vouch file).
 * Neither the gate nor rule code reads a repo; the project service hands
 * them these.
 */
import { ObjectId, RepoHost, Revision } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import { judgeInputs } from "@repo/checks/judge";
import { workspacesIn } from "@repo/checks/workspaces";
import { PushTarget } from "@repo/gate/facts";
import type { PushFacts } from "@repo/gate/facts";
import { addedLines, treeDiff } from "@repo/git/tree-diff";
import type { Change } from "@repo/git/tree-diff";
import type { Ask } from "@repo/protocol/domain/ask";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { RefNameText } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import { AskId, Handle, LayerName, TreeSha } from "@repo/protocol/ids";
import type {
  CommitSha,
  LandedSha,
  ProjectName,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import type { Principal } from "@repo/protocol/principal";
import type { EvaluationFacts } from "@repo/rules/rules-evaluator";
import { Array, Effect, Option, Schema } from "effect";
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

/** How many of a repo's trees or blobs the facts read at once. */
const READS_AT_ONCE = 16;

/** A blob or a folder of a commit's tree: its path from the root, and its id. */
interface Located {
  readonly path: string;
  readonly sha: ObjectId;
}

/**
 * Every blob under the tree `root`, by its path from the root: each folder
 * read once, a level at a time. A submodule is no file.
 */
const blobsUnder = (
  repo: RepoName,
  root: ObjectId
): Effect.Effect<readonly Located[], RepoNotFound, RepoHost> => {
  const level = (
    folders: readonly Located[],
    found: readonly Located[]
  ): Effect.Effect<readonly Located[], RepoNotFound, RepoHost> =>
    folders.length === 0
      ? Effect.succeed(found)
      : Effect.flatMap(
          Effect.forEach(
            folders,
            (folder) =>
              RepoHost.use((host) => host.readTree(repo, folder.sha)).pipe(
                Effect.map((entries) =>
                  Option.getOrElse(entries, () => []).map((entry) => ({
                    path:
                      folder.path === ""
                        ? entry.name
                        : `${folder.path}/${entry.name}`,
                    sha: entry.sha,
                    type: entry.type,
                  }))
                )
              ),
            { concurrency: READS_AT_ONCE }
          ),
          (children) => {
            const all = children.flat();

            return level(
              all.filter(({ type }) => type === "tree"),
              [...found, ...all.filter(({ type }) => type === "blob")]
            );
          }
        );

  return level([{ path: "", sha: root }], []);
};

/** What `evaluationFacts` is told besides the commit. */
export interface FactsInput {
  readonly initializer: Handle;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  /** Where the vouch file is, as the policy before this commit says. */
  readonly vouchFile: RepoPath;
}

/**
 * The rules' facts at one commit of `repo`: every file of its tree, with
 * the text of each one the run-block finder or the judge closure reads
 * (`@repo/checks`' `judgeInputs`, which the CLI's local check and hook
 * gather through too), the workspaces its root manifest declares, and its
 * vouch file. The seed is the commit's own first eight hex digits, so the
 * same commit always sees the same randomness. A commit the repo lacks gives
 * empty facts: the evaluation then decides on its config folder alone.
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

    const blobs = yield* blobsUnder(repo, commit.value.tree);
    const ids = new Map(blobs.map(({ path, sha }) => [path, sha]));

    const ci = yield* judgeInputs(blobs, (paths) =>
      Effect.forEach(
        paths,
        (path) =>
          Option.match(Option.fromUndefinedOr(ids.get(path)), {
            onNone: () => Effect.succeed([]),
            onSome: (sha) =>
              RepoHost.use((host) => host.readBlob(repo, sha)).pipe(
                Effect.map((bytes) =>
                  Option.toArray(
                    Option.map(bytes, (read) => ({ bytes: read, path }))
                  )
                )
              ),
          }),
        { concurrency: READS_AT_ONCE }
      ).pipe(Effect.map((read) => read.flat()))
    );

    const vouch = yield* RepoHost.use((host) =>
      host.readFile(repo, Revision.Commit({ sha: at }), input.vouchFile)
    );

    const facts: EvaluationFacts = {
      ...empty,
      ci,
      workspaces: workspacesIn(ci),
    };

    return Option.match(vouch, {
      onNone: () => facts,
      onSome: (bytes) => ({ ...facts, vouchFile: textOf(bytes) }),
    });
  }).pipe(Effect.catchTag("RepoNotFound", () => Effect.succeed(empty)));
};
