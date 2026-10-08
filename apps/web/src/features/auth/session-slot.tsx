/**
 * The header's session slot (issue 513): who is signed in, with sign-out,
 * or a link to sign in that comes back to this page. Signing in is only
 * for deciders (PRODUCT.md), so the slot stays one quiet line: the handle
 * in ink, the action in the nav's muted text.
 *
 * `SessionView` draws it from props; `SessionSlot` (no props: the root
 * route renders it, issue 511) wires it to `whoAtom` and the location.
 */
import { useAtomValue } from "@effect/atom-react";
import type { Handle } from "@repo/protocol/ids";
import { useLocation } from "@tanstack/react-router";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";

import { HandleLink } from "../shared/handle.tsx";
import { whoAtom } from "./who.ts";

/** Sign-in, coming back to `here` afterwards. */
const signInHref = (here: string) =>
  `/auth/signin?${new URLSearchParams({ return: here }).toString()}`;

/** The nav's own action style: muted text, ink on hover. */
const ACTION =
  "text-muted-foreground hover:text-foreground cursor-pointer text-sm no-underline transition-colors duration-150";

export const SessionView = ({
  handle,
  here,
}: {
  readonly handle: Option.Option<Handle>;
  readonly here: string;
}) =>
  Option.match(handle, {
    onNone: () => (
      <a className={ACTION} href={signInHref(here)}>
        Sign in
      </a>
    ),
    onSome: (signedIn) => (
      <div className="flex items-center gap-3">
        <p className="flex min-w-0 items-baseline gap-1">
          <span className="text-muted-foreground sr-only shrink-0 sm:not-sr-only">
            Signed in as
          </span>
          {/* The header's row never shrinks below its content, so a long
              handle is capped (a quarter of a phone's width) for `truncate`
              to take hold and keep "Sign out" on screen; its title is whole. */}
          <span
            className="max-w-[25vw] min-w-0 truncate sm:max-w-xs"
            title={signedIn}
          >
            <HandleLink handle={signedIn} />
          </span>
        </p>
        <span aria-hidden className="bg-rule h-4 w-px" />
        <form action="/auth/signout" className="flex" method="post">
          <button className={ACTION} type="submit">
            Sign out
          </button>
        </form>
      </div>
    ),
  });

export const SessionSlot = () => {
  const here = useLocation({ select: (location) => location.href });
  const who = useAtomValue(whoAtom);

  return (
    <SessionView
      handle={AsyncResult.isSuccess(who) ? who.value : Option.none()}
      here={here}
    />
  );
};
