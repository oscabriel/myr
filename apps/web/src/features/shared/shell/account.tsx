import { SessionSlot } from "../../auth/session-slot.tsx";
import { useShellReads } from "./context.ts";

/** Sign in, or the inbox with its count, the handle and Sign out. */
export const Account = () => (
  <div className="flex min-w-0 items-center gap-3">
    {useShellReads().inboxCount}
    <SessionSlot />
  </div>
);
