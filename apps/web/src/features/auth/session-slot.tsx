/**
 * The session, wherever the shell shows it (the rail's foot, the tablet's
 * top bar, the phone's More sheet): who is signed in, with sign-out, or a
 * link to sign in that comes back to this page. Signing in is only for
 * deciders (PRODUCT.md), so the slot stays quiet: the handle in ink, the
 * action in muted text.
 *
 * `SessionView` draws it from props; `SessionSlot` wires it to `whoAtom`
 * and the location. Sign-in is a server route, so its link is a plain
 * anchor that loads the document; the handle's page is the router's.
 */
import { useAtomValue } from "@effect/atom-react";
import type { Handle } from "@repo/protocol/ids";
import { useLocation } from "@tanstack/react-router";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { LogIn } from "lucide-react";

import { AppLink } from "../shared/link.tsx";
import { personPath } from "../shared/paths.ts";
import { whoAtom } from "./who.ts";

/**
 * Where sign-in comes back to: the page the reader is on, without its
 * `#fragment`. The server never sees a fragment, so a link that carried one
 * would differ between the server's render and the browser's (`#L3`).
 */
export const hereOf = (location: {
  readonly pathname: string;
  readonly searchStr: string;
}) => `${location.pathname}${location.searchStr}`;

/** Sign-in, coming back to `here` afterwards. */
export const signInHref = (here: string) =>
  `/auth/signin?${new URLSearchParams({ return: here }).toString()}`;

/** The session's own action style: muted text, ink on hover. */
const ACTION =
  "text-muted-foreground hover:text-foreground text-ui inline-flex cursor-pointer items-center gap-1.5 no-underline transition-colors duration-150";

/**
 * Where the slot sits: `rail` stacks the handle over its action in the
 * rail's foot and the More sheet; `bar` keeps both on the top bar's line.
 */
export type SessionLayout = "bar" | "rail";

export const SessionView = ({
  handle,
  here,
  layout = "bar",
}: {
  readonly handle: Option.Option<Handle>;
  readonly here: string;
  readonly layout?: SessionLayout;
}) =>
  Option.match(handle, {
    onNone: () => (
      <a className={ACTION} href={signInHref(here)}>
        <LogIn aria-hidden="true" className="size-4" strokeWidth={1.75} />
        Sign in
      </a>
    ),
    onSome: (signedIn) => (
      <div
        className={
          layout === "rail"
            ? "flex min-w-0 flex-col gap-0.5"
            : "flex min-w-0 items-center gap-3"
        }
      >
        <p className="text-ui flex min-w-0 items-baseline gap-1">
          <span className="text-muted-foreground sr-only shrink-0">
            Signed in as
          </span>
          {/* A long handle is cut short for the line it shares; its title
              is whole. */}
          <AppLink
            className="decoration-rule hover:decoration-foreground max-w-[12rem] min-w-0 truncate font-medium underline-offset-4 hover:underline"
            title={signedIn}
            to={personPath(signedIn)}
          >
            {signedIn}
          </AppLink>
        </p>
        <form action="/auth/signout" className="flex" method="post">
          <button className={ACTION} type="submit">
            Sign out
          </button>
        </form>
      </div>
    ),
  });

export const SessionSlot = ({
  layout = "bar",
}: {
  readonly layout?: SessionLayout;
}) => {
  const here = useLocation({ select: hereOf });
  const who = useAtomValue(whoAtom);

  return (
    <SessionView
      handle={AsyncResult.isSuccess(who) ? who.value : Option.none()}
      here={here}
      layout={layout}
    />
  );
};

/** Whether someone is signed in, as far as this browser knows yet. */
export const useSignedIn = (): boolean => {
  const who = useAtomValue(whoAtom);

  return AsyncResult.isSuccess(who) && Option.isSome(who.value);
};
