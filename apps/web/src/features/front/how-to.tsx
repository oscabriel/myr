/**
 * The strip of three steps above the asks, which a reader may dismiss. The
 * dismissal is kept in this browser's localStorage, never a cookie: a cookie
 * would take the page out of the edge cache (ADR 0042 says the same of the
 * theme). The server has no storage and draws the strip; a reader who
 * dismissed it sees it go once the page has read the storage.
 */
import { Brand } from "@repo/brand";
import { Result } from "effect";
import { X } from "lucide-react";
import { useCallback, useId, useSyncExternalStore } from "react";

import { Button } from "../../components/ui/button.tsx";
import { CommandLine } from "../shared/command.tsx";
import { AppLink } from "../shared/link.tsx";
import { INSTALL_PATH } from "../shared/paths.ts";

const DISMISSED = "asks.how-to";

export const readHowToDismissed = (storage?: Storage): boolean =>
  storage !== undefined &&
  Result.getOrElse(
    Result.try(() => storage.getItem(DISMISSED) === "dismissed"),
    () => false
  );

export const dismissHowTo = (storage?: Storage) => {
  Result.try(() => storage?.setItem(DISMISSED, "dismissed"));
};

export const restoreHowTo = (storage?: Storage) => {
  Result.try(() => storage?.removeItem(DISMISSED));
};

const browserStorage = (): Storage | undefined =>
  Result.getOrUndefined(Result.try(() => globalThis.localStorage));

/** Said on this page when it changes the storage; another tab says `storage`. */
const CHANGED = "asks-how-to";

const subscribe = (onChange: () => void) => {
  globalThis.addEventListener(CHANGED, onChange);
  globalThis.addEventListener("storage", onChange);

  return () => {
    globalThis.removeEventListener(CHANGED, onChange);
    globalThis.removeEventListener("storage", onChange);
  };
};

const dismissedHere = () => readHowToDismissed(browserStorage());

const shownOnServer = () => false;

export const useHowTo = () => {
  const dismissed = useSyncExternalStore(
    subscribe,
    dismissedHere,
    shownOnServer
  );

  const dismiss = useCallback(() => {
    dismissHowTo(browserStorage());
    globalThis.dispatchEvent(new Event(CHANGED));
  }, []);

  const restore = useCallback(() => {
    restoreHowTo(browserStorage());
    globalThis.dispatchEvent(new Event(CHANGED));
  }, []);

  return { dismiss, dismissed, restore };
};

export const HOW_TO_TITLE = "How to take an ask";

const STEPS = [
  {
    command: `${Brand.cli} claim <ask> --project <owner>/<name>`,
    label: "Claim one you may take",
  },
  { command: `${Brand.cli} check`, label: "Check your answer before you push" },
  {
    command: `git push ${Brand.slug} HEAD:main`,
    label: "Push it to your fork",
  },
] as const;

const LINK = "decoration-rule underline hover:decoration-current";

// `llms.txt` is a server route, so its link is a plain anchor.

export const HowToTake = ({
  onDismiss,
}: {
  readonly onDismiss: () => void;
}) => {
  const heading = useId();

  return (
    <section
      aria-labelledby={heading}
      className="border-rule bg-card flex flex-col gap-4 border p-4"
      data-how-to=""
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ui font-semibold" id={heading}>
          {HOW_TO_TITLE}
        </h2>
        <Button
          aria-label={`Dismiss ${HOW_TO_TITLE.toLowerCase()}`}
          onClick={onDismiss}
          size="icon-sm"
          title="Dismiss"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" strokeWidth={1.75} />
        </Button>
      </div>
      <ol className="columns:grid-cols-3 grid gap-4">
        {STEPS.map(({ command, label }, index) => (
          <li className="flex min-w-0 flex-col gap-1" key={command}>
            <p className="text-label text-muted-foreground">
              {index + 1}. {label}
            </p>
            <CommandLine command={command} numbered />
          </li>
        ))}
      </ol>
      <p className="text-ui text-muted-foreground">
        New here?{" "}
        <AppLink className={`text-foreground ${LINK}`} to={INSTALL_PATH}>
          Install the command line
        </AppLink>{" "}
        first. For agents:{" "}
        <a
          className={`text-foreground text-mono font-mono ${LINK}`}
          href="/llms.txt"
        >
          llms.txt
        </a>
      </p>
    </section>
  );
};
