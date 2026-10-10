/**
 * `J` and `K` on the code pages: the next or the previous file, from the
 * one the page shows, in the tree's order (a file's page and its why page
 * move to the next file's; a commit's page scrolls its diff to the next
 * file's header). The keys mean what the shell's keys dialog says
 * (`intentOf`), and the switch that turns the single keys off turns these
 * off too. No key acts while focus is in a field or the tree's filter.
 */
import { useEffect, useRef } from "react";

import { inField, intentOf, useKeys } from "../shared/keys.tsx";

/** The file `step` away from `current` in `paths`; the first or last when the page shows none of them. */
export const stepFrom = (
  paths: readonly string[],
  current: string | undefined,
  step: 1 | -1
): string | undefined => {
  const at = current === undefined ? -1 : paths.indexOf(current);

  if (at === -1) {
    return step === 1 ? paths[0] : paths.at(-1);
  }

  return paths[Math.min(Math.max(at + step, 0), paths.length - 1)];
};

export const useCodeFileKeys = (
  paths: readonly string[],
  current: string | undefined,
  onMove: (path: string) => void
) => {
  const on = useKeys()?.on ?? true;
  const latest = useRef({ current, on, onMove, paths });

  useEffect(() => {
    latest.current = { current, on, onMove, paths };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = latest.current;

      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const intent = intentOf(
        {
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          inField: inField(event),
          key: event.key,
          metaKey: event.metaKey,
        },
        now.on
      );

      if (intent?.kind !== "nextFile" && intent?.kind !== "previousFile") {
        return;
      }

      const next = stepFrom(
        now.paths,
        now.current,
        intent.kind === "nextFile" ? 1 : -1
      );

      if (next !== undefined && next !== now.current) {
        event.preventDefault();
        now.onMove(next);
      }
    };

    // Before the tree's own keys, which take letters to find a row.
    document.addEventListener("keydown", onKey, { capture: true });

    return () => {
      document.removeEventListener("keydown", onKey, { capture: true });
    };
  }, []);
};
