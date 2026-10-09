/**
 * A project's evaluated policy (the people page's read, the data pattern in
 * `src/surfaces.ts`): `projectPolicy` over the browser's `/rpc`, keyed by
 * the project's policy, so a landing (`Landed`, which `watch.ts` turns into
 * `keys.policy`) makes it read again. It is keyed by the project too: when
 * the watch's stream fails at connect, its poll changes only the project's
 * keys. The people page seeds it with what its loader read on the server.
 */
import type { ProjectName } from "@repo/protocol/ids";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const policyAtom = Atom.family((project: ProjectName) =>
  ContractsClient.query(
    "projectPolicy",
    { project },
    { reactivityKeys: [...keys.policy(project), ...keys.project(project)] }
  )
);
