/**
 * The way to the propose form, for signed-in members only. Who is signed in
 * is the browser's to learn (`whoAtom`), after the first paint, so the
 * server renders no link and the browser adds it, as the header's session
 * slot does (`features/auth/session-slot.tsx`).
 */
import { useAtomValue } from "@effect/atom-react";
import type { ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { MessageSquarePlus } from "lucide-react";

import { whoAtom } from "../auth/who.ts";

/** The form's address for `project`. */
export const proposeFormPath = (project: ProjectName) =>
  `/${project}/proposals/new`;

export const ProposeLink = ({ project }: { readonly project: ProjectName }) => (
  <a
    className="decoration-rule flex w-fit items-center gap-2 text-sm font-medium underline hover:decoration-current"
    data-propose=""
    href={proposeFormPath(project)}
  >
    <MessageSquarePlus aria-hidden="true" className="size-4 shrink-0" />
    Propose an ask
  </a>
);

/** `ProposeLink` once the browser knows someone is signed in; nothing before or otherwise. */
export const SignedInProposeLink = ({
  project,
}: {
  readonly project: ProjectName;
}) =>
  Option.isSome(Option.flatten(AsyncResult.value(useAtomValue(whoAtom)))) ? (
    <ProposeLink project={project} />
  ) : null;
