/**
 * The code browser's reads (the data pattern in `src/surfaces.ts`): one
 * atom per code contract over the browser's `/rpc`, each taking the
 * contract's own payload and keyed by the project's code (`keys.code`),
 * which a landing changes. The code pages read on the server first (their
 * loaders), so the browser calls only the reads a page draws there (every
 * path for the file tree, `pathsAtom`) or keeps live: the project page's
 * root folder and README (`projectCodeAtom`), which its loader also read.
 */
import type { Contract } from "@repo/protocol/contracts";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";
import { Atom } from "effect/reactivity";
import type { Rpc } from "effect/rpc";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** What the contract tagged `Tag` takes. */
type PayloadOf<Tag extends string> = Rpc.Payload<Rpc.ExtractTag<Contract, Tag>>;

const options = (project: ProjectName) => ({
  reactivityKeys: keys.code(project),
});

/** Main, the tags and the forks. */
export const refsAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.query("listRefs", { project }, options(project))
  )
);

/** One folder; the root at main when the payload names neither. */
export const treeAtom = (payload: PayloadOf<"readTree">) =>
  ContractsClient.query("readTree", payload, options(payload.project));

/** Every file path at a revision, for the file tree. */
export const pathsAtom = (payload: PayloadOf<"listPaths">) =>
  ContractsClient.query("listPaths", payload, options(payload.project));

/** One file at a revision. */
export const fileAtom = (payload: PayloadOf<"readFile">) =>
  ContractsClient.query("readFile", payload, options(payload.project));

/** A page of the log. */
export const logAtom = (payload: PayloadOf<"log">) =>
  ContractsClient.query("log", payload, options(payload.project));

/** One commit and what it changed. */
export const commitAtom = (payload: PayloadOf<"showCommit">) =>
  ContractsClient.query("showCommit", payload, options(payload.project));

/**
 * The project page's code: the root folder at main and, when it has one,
 * its README, read after it. A project with nothing landed yet refuses
 * the read, and its page shows no code. It renders as waiting on the
 * server, where the page draws its loader's read of the same code
 * (`server/folder.ts`); in the browser it takes over once it has a value,
 * and reads again on each landing.
 */
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
