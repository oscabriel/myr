/**
 * A call the propose and proposal pages sent, failed. A session that ended
 * (or never began) asks the reader to sign in and come back to the same
 * address, so the form or the proposal is where they left it; anything else
 * shows as Today's failures do: the refusal, or that the platform did not
 * answer.
 */
import { Unauthenticated } from "@repo/protocol/principal";
import { Cause, Option, Schema } from "effect";
import { LogIn } from "lucide-react";

import { FailureView } from "../today/today-page.tsx";

const isUnauthenticated = Schema.is(Unauthenticated);

/** Sign-in, coming back to `here` afterwards. */
const signInHref = (here: string) =>
  `/auth/signin?${new URLSearchParams({ return: here }).toString()}`;

export const ProposalFailure = ({
  cause,
  doing,
  here,
}: {
  readonly cause: Cause.Cause<unknown>;
  /** What the reader was doing, as "Sign in to …" ends: `propose it`. */
  readonly doing: string;
  /** The page's own address (`hereOf`), where sign-in comes back to. */
  readonly here: string;
}) =>
  Option.exists(Cause.findErrorOption(cause), isUnauthenticated) ? (
    <output className="border-rule flex items-start gap-2 border-t border-b py-3 text-sm">
      <LogIn aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        You are not signed in, or your session has ended.{" "}
        <a
          className="decoration-rule font-medium underline hover:decoration-current"
          href={signInHref(here)}
        >
          Sign in
        </a>{" "}
        to {doing}; you come back to this page.
      </span>
    </output>
  ) : (
    <FailureView cause={cause} />
  );
