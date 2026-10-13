import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { todayAtom } from "../../client/today.ts";
import { AppLink } from "../shared/link.tsx";
import { INBOX_PATH } from "../shared/paths.ts";

const InboxCount = () => {
  const today = useAtomValue(todayAtom());

  const waiting = AsyncResult.isSuccess(today)
    ? today.value.decisions.length + today.value.overflow
    : 0;

  return (
    <AppLink
      activeOptions={{ includeSearch: false }}
      className="text-ui text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground flex h-8 shrink-0 items-center gap-1.5 no-underline transition-colors duration-[120ms]"
      to={INBOX_PATH}
    >
      Inbox
      {waiting === 0 ? null : (
        <span className="text-foreground font-medium tabular-nums">
          {waiting}
          <span className="sr-only"> decisions waiting</span>
        </span>
      )}
    </AppLink>
  );
};

// `React.lazy` takes a module's default export.
export default InboxCount;
