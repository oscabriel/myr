import { Unauthenticated } from "@repo/protocol/principal";
import { Refusal } from "@repo/protocol/refusal";
import { Cause, Option, Schema } from "effect";
import { LogIn } from "lucide-react";

import { signInHref } from "../auth/session-slot.tsx";
import { UnreachableNotice } from "./pending.tsx";
import { RefusalView } from "./refusal.tsx";

const isUnauthenticated = Schema.is(Unauthenticated);

const isRefusal = Schema.is(Refusal);

export const CallFailure = ({
  cause,
  doing,
  here,
}: {
  readonly cause: Cause.Cause<unknown>;
  readonly doing: string;
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
