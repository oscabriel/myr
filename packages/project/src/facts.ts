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
import { AskId, Handle, keyOf, LayerName, TreeSha } from "@repo/protocol/ids";
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

export class MissingCommit extends Schema.TaggedError<MissingCommit>()(
  "MissingCommit",
  { sha: Schema.String }
) {}

const asAsk = Schema.decodeUnknownOption(AskId);

const asHandle = Schema.decodeUnknownOption(Handle);

const asLayer = Schema.decodeUnknownOption(LayerName);

export const targetOf = (repo: RepoName, project: ProjectName): PushTarget => {
  const [named, second, third, ...rest] = repo.split("--");
  const canonical = PushTarget.Canonical({ project });

  if (named !== keyOf(project) || rest.length > 0 || second === undefined) {
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

export interface PushInput {
  readonly ask: Option.Option<Ask>;
  readonly base: CommitSha;
  readonly claim: Option.Option<ClaimView>;
  readonly claimsHeld: number;
  readonly head: CommitSha;
  readonly landed: LandedSha;
  readonly policy: Policy;
  readonly project: ProjectName;
  readonly pusher: Principal;
  readonly ref: string;
  readonly repo: RepoName;
}

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

const READS_AT_ONCE = 16;

interface Located {
  readonly path: string;
  readonly sha: ObjectId;
}

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

export interface FactsInput {
  readonly initializer: Handle;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly vouchFile: RepoPath;
}

// The seed is the commit's first eight hex digits, so the same commit always
// sees the same randomness.
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
