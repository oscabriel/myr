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
 * Without its `#fragment`: the server never sees one, so a link that carried it
 * would differ between the server's render and the browser's.
 */
export const hereOf = (location: {
  readonly pathname: string;
  readonly searchStr: string;
}) => `${location.pathname}${location.searchStr}`;

export const signInHref = (here: string) =>
  `/auth/signin?${new URLSearchParams({ return: here }).toString()}`;

const ACTION =
  "text-muted-foreground hover:text-foreground text-ui inline-flex cursor-pointer items-center gap-1.5 no-underline transition-colors duration-150";

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
        <LogIn aria-hidden="true" className="size-4" strokeWidth={1.75} />
        Sign in
      </a>
    ),
    onSome: (signedIn) => (
      <div className="flex min-w-0 items-center gap-3">
        <p className="text-ui flex min-w-0 items-baseline gap-1">
          <span className="text-muted-foreground sr-only shrink-0">
            Signed in as
          </span>
          {/* A long handle is cut short; its title is whole. */}
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

export const SessionSlot = () => {
  const here = useLocation({ select: hereOf });
  const who = useAtomValue(whoAtom);

  return (
    <SessionView
      handle={AsyncResult.isSuccess(who) ? who.value : Option.none()}
      here={here}
    />
  );
};

export const useSignedIn = (): boolean => {
  const who = useAtomValue(whoAtom);

  return AsyncResult.isSuccess(who) && Option.isSome(who.value);
};
