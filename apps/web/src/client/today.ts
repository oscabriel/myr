/**
 * The signed-in decider's Today, as an atom over the `today` contract: every
 * project they decide in, or the one `project` names. The browser's `/rpc`
 * call carries the session cookie; the platform decides who is
 * asking, and answers a person who decides nothing with `NotDecider`.
 *
 * A write that changes Today (a decision taken, here or by a teammate's
 * `decide`) invalidates `keys.today()`, and this atom reads again.
 */
import type { ProjectName } from "@repo/protocol/ids";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/**
 * The caller's Today, across their projects or narrowed to one. A server
 * render never reads it (the page's loader does, with the reader's
 * session, and seeds it); unseeded, it renders as waiting there.
 */
const todayFamily = Atom.family((project: ProjectName | undefined) =>
  Atom.withServerValueInitial(
    ContractsClient.query("today", project === undefined ? {} : { project }, {
      reactivityKeys: keys.today(),
    })
  )
);

export const todayAtom = (project?: ProjectName) => todayFamily(project);
