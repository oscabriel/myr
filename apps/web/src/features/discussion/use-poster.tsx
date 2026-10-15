import { useAtom, useAtomValue } from "@effect/atom-react";
import type { PostDiscussion } from "@repo/protocol/contracts";
import { ownerOf } from "@repo/protocol/ids";
import type { DiscussionId, ProjectName } from "@repo/protocol/ids";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Effect, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { postDiscussionAtom } from "../../client/discussion.ts";
import { hereOf } from "../auth/session-slot.tsx";
import { whoAtom } from "../auth/who.ts";
import { CallFailure } from "../shared/call-failure.tsx";
import type { Poster } from "./post-form.tsx";

type PostPayload = typeof PostDiscussion.payloadSchema.Type;

/**
 * Posts in `project`: a reply in `discussion` when named, else a new thread,
 * whose page it goes to once it is open. Only this page's own post is
 * answered here: the atom is shared, and another page's result is not ours.
 * A sent post clears the form from the answer itself, not from an effect.
 */
export const usePoster = (
  project: ProjectName,
  discussion?: DiscussionId
): Poster => {
  const navigate = useNavigate();
  const here = useLocation({ select: hereOf });
  const who = useAtomValue(whoAtom);
  const [posted, post] = useAtom(postDiscussionAtom, { mode: "promiseExit" });
  const [waiting, setWaiting] = useState(false);
  const [sent, setSent] = useState(0);

  const posting = (payload: PostPayload) =>
    Effect.promise(() => post(payload)).pipe(
      Effect.flatMap((exit) => exit),
      Effect.tap(({ discussion: made }) =>
        Effect.sync(() => {
          setWaiting(false);
          setSent((count) => count + 1);

          if (discussion === undefined) {
            void navigate({
              params: { discussion: made.id, owner: ownerOf(project), project },
              to: "/$owner/$project/discussions/$discussion",
            });
          }
        })
      ),
      Effect.ignore
    );

  return {
    busy: waiting && posted.waiting,
    checking: !AsyncResult.isSuccess(who),
    handle: AsyncResult.isSuccess(who) ? who.value : Option.none(),
    here,
    onPost: (input) => {
      setWaiting(true);
      Effect.runFork(
        posting(
          discussion === undefined
            ? { ...input, project }
            : { ...input, discussion, project }
        )
      );
    },
    refusal:
      waiting && AsyncResult.isFailure(posted) ? (
        <div aria-live="polite">
          <CallFailure
            cause={posted.cause}
            doing={discussion === undefined ? "open a discussion" : "reply"}
            here={here}
          />
        </div>
      ) : undefined,
    sent,
  };
};
