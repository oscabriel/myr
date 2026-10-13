/**
 * Appearance (ADR 0042): the theme follows the system, or its opposite. Each
 * choice shows what it gives on this machine now, and follows the system as
 * it turns. The choice is kept in this browser's `localStorage` alone.
 */
import { Result } from "effect";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  applyTheme,
  DARK_SCHEME_QUERY,
  readPreference,
  resolveTheme,
  THEME_PREFERENCE_KEY,
  THEME_PREFERENCES,
  writePreference,
} from "../shared/theme.ts";
import type { Theme, ThemeDocument, ThemePreference } from "../shared/theme.ts";

const CHOICE_LABELS: Readonly<Record<ThemePreference, string>> = {
  opposite: "Opposite of system",
  same: "Same as system",
};

const THEME_LABELS: Readonly<Record<Theme, string>> = {
  dark: "Dark",
  light: "Light",
};

/** Where a choice lands: the browser's storage and the page it is made on. */
export interface ThemePlace {
  readonly document: ThemeDocument;
  readonly storage: Storage | undefined;
  readonly system: Theme;
}

/** Keeps the choice, then draws the page in it at once, as the head script would. */
export const choosePreference = (
  preference: ThemePreference,
  place: ThemePlace
) => {
  writePreference(place.storage, preference);
  applyTheme(place.document, resolveTheme(place.system, preference));
};

export const AppearanceView = ({
  onChoose,
  preference,
  system,
}: {
  readonly onChoose: (preference: ThemePreference) => void;
  readonly preference: ThemePreference;
  /** Unknown on the server, which cannot see the reader's system. */
  readonly system: Theme | undefined;
}) => (
  <fieldset className="flex flex-col gap-2">
    <legend className="text-ui mb-2 font-semibold">Theme</legend>
    {THEME_PREFERENCES.map((choice) => (
      <label
        className="border-rule bg-card text-ui hover:bg-surface has-checked:border-foreground flex min-h-11 cursor-pointer items-center gap-3 border px-3 py-2 transition-colors duration-[120ms]"
        key={choice}
      >
        <input
          checked={choice === preference}
          className="accent-primary size-4 shrink-0"
          name="theme"
          onChange={() => {
            onChoose(choice);
          }}
          type="radio"
          value={choice}
        />
        <span className="font-medium">{CHOICE_LABELS[choice]}</span>
        {system === undefined ? null : (
          <span className="text-muted-foreground ml-auto">
            {THEME_LABELS[resolveTheme(system, choice)]}
          </span>
        )}
      </label>
    ))}
  </fieldset>
);

// Not `useMedia` from `features/code/media.ts`: its server snapshot is
// `false`, and this page must name no theme the server cannot see.
const subscribeToSystem = (changed: () => void) => {
  const scheme = globalThis.matchMedia(DARK_SCHEME_QUERY);

  scheme.addEventListener("change", changed);

  return () => {
    scheme.removeEventListener("change", changed);
  };
};

const systemNow = (): Theme =>
  globalThis.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";

const systemOnServer = (): Theme | undefined => undefined;

type StorageListener = (event: { readonly key: string | null }) => void;

/** The window's storage events, by which this tab hears another one write. */
export interface StorageEvents {
  readonly addEventListener: (
    type: "storage",
    listener: StorageListener
  ) => void;
  readonly removeEventListener: (
    type: "storage",
    listener: StorageListener
  ) => void;
}

/**
 * The choice as this tab shows it: the one made here, or what storage holds
 * once another tab writes one. A browser that refuses storage keeps the one
 * made here, which storage cannot give back.
 */
export const preferenceStore = (
  storage: () => Storage | undefined,
  events: StorageEvents
) => {
  let chosen: ThemePreference | undefined;
  const listeners = new Set<() => void>();

  return {
    choose: (preference: ThemePreference) => {
      chosen = preference;

      for (const changed of listeners) {
        changed();
      }
    },
    current: (): ThemePreference => chosen ?? readPreference(storage()),
    subscribe: (changed: () => void) => {
      const heard: StorageListener = ({ key }) => {
        if (key === THEME_PREFERENCE_KEY) {
          chosen = undefined;
          changed();
        }
      };

      listeners.add(changed);
      events.addEventListener("storage", heard);

      return () => {
        listeners.delete(changed);
        events.removeEventListener("storage", heard);
      };
    },
  };
};

const localStorageOf = (): Storage | undefined =>
  Result.getOrUndefined(Result.try(() => globalThis.localStorage));

const storedOnServer = (): ThemePreference => "same";

export const Appearance = () => {
  const system = useSyncExternalStore(
    subscribeToSystem,
    systemNow,
    systemOnServer
  );

  const store = useMemo(() => preferenceStore(localStorageOf, globalThis), []);

  const preference = useSyncExternalStore(
    store.subscribe,
    store.current,
    storedOnServer
  );

  const choose = useCallback(
    (chosen: ThemePreference) => {
      choosePreference(chosen, {
        document: globalThis.document,
        storage: localStorageOf(),
        system: systemNow(),
      });
      store.choose(chosen);
    },
    [store]
  );

  return (
    <AppearanceView onChoose={choose} preference={preference} system={system} />
  );
};
