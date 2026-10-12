import type { Contract } from "@repo/protocol/contracts";
import type { CommitView } from "@repo/protocol/domain/code";
import type { ProjectName, RepoPath } from "@repo/protocol/ids";
import { Array, Effect, Option } from "effect";
import { Atom } from "effect/reactivity";
import type { Rpc } from "effect/rpc";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

type PayloadOf<Tag extends string> = Rpc.Payload<Rpc.ExtractTag<Contract, Tag>>;

const options = (project: ProjectName) => ({
  reactivityKeys: keys.code(project),
});

export const refsAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.query("listRefs", { project }, options(project))
  )
);

export const treeAtom = (payload: PayloadOf<"readTree">) =>
  ContractsClient.query("readTree", payload, options(payload.project));

export const pathsAtom = (payload: PayloadOf<"listPaths">) =>
  ContractsClient.query("listPaths", payload, options(payload.project));

export const fileAtom = (payload: PayloadOf<"readFile">) =>
  ContractsClient.query("readFile", payload, options(payload.project));

export const logAtom = (payload: PayloadOf<"log">) =>
  ContractsClient.query("log", payload, options(payload.project));

export const commitAtom = (payload: PayloadOf<"showCommit">) =>
  ContractsClient.query("showCommit", payload, options(payload.project));

export const projectCodeAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.runtime.factory.withReactivity(keys.code(project))(
      ContractsClient.runtime.atom(
        Effect.gen(function* () {
          const client = yield* ContractsClient;
          const root = yield* client("readTree", { at: "main", project });

          if (root.readme === undefined) {
            return { root };
          }

          const readme = yield* client("readFile", {
            at: root.at,
            path: root.readme.path,
            project,
          });

          return { readme, root };
        })
      )
    )
  )
);

export const LAST_CHANGES_CAP = 30;

export const lastChangesAtom = Atom.family(
  (key: {
    readonly at: string;
    readonly paths: readonly RepoPath[];
    readonly project: ProjectName;
  }) =>
    Atom.withServerValueInitial(
      ContractsClient.runtime.atom(
        Effect.gen(function* () {
          const client = yield* ContractsClient;

          if (key.paths.length > LAST_CHANGES_CAP) {
            return new Map<string, CommitView>();
          }

          const found = yield* Effect.forEach(
            key.paths,
            (path) =>
              client("log", {
                at: key.at,
                limit: 1,
                path,
                project: key.project,
              }).pipe(
                Effect.map(({ commits }) => Option.fromUndefinedOr(commits[0])),
                Effect.orElseSucceed(() => Option.none<CommitView>()),
                Effect.map((commit) =>
                  Option.map(commit, (last) => [path, last] as const)
                )
              ),
            { concurrency: 3 }
          );

          return new Map<string, CommitView>(Array.getSomes(found));
        })
      )
    )
);
