/**
 * A call the propose, proposal or decision pages sent, failed. A session
 * that ended (or never began) asks the reader to sign in and come back to
 * the same address, so the form, the proposal or the decision is where
 * they left it; a refusal reads as the platform gave it, through
 * `RefusalView`; anything else is the platform not answering, in ink,
 * never as a refusal.
 */
import { Unauthenticated } from "@repo/protocol/principal";
import { Refusal } from "@repo/protocol/refusal";
import { Cause, Option, Schema } from "effect";
import { LogIn } from "lucide-react";

import { signInHref } from "../auth/session-slot.tsx";
import { UnreachableNotice } from "../shared/pending.tsx";
import { RefusalView } from "../shared/refusal.tsx";

const isUnauthenticated = Schema.is(Unauthenticated);

const isRefusal = Schema.is(Refusal);

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
}) => {
  const error = Cause.findErrorOption(cause);

  if (Option.exists(error, isUnauthenticated)) {
    return (
      <p className="border-rule text-ui flex items-start gap-2 border-y py-3">
        <LogIn
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0"
          strokeWidth={1.75}
        />
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
      </p>
    );
  }

  return Option.isSome(error) && isRefusal(error.value) ? (
    <RefusalView refusals={[error.value]} />
  ) : (
    <UnreachableNotice />
  );
};
