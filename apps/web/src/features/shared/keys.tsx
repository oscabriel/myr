/**
 * The switch turns every key but `?` off (WCAG 2.2 SC 2.1.4), and is on
 * whenever the storage cannot be read.
 */
import { Effect, Option, Result } from "effect";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { Kbd } from "../../components/ui/kbd.tsx";

export interface KeyPress {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly inField: boolean;
  readonly key: string;
  readonly metaKey: boolean;
}

export type KeyIntent =
  | { readonly index: number; readonly kind: "copy" }
  | {
      readonly kind:
        | "clear"
        | "keys"
        | "next"
        | "nextFile"
        | "previous"
        | "previousFile";
    };

const MOVES = {
  J: "nextFile",
  K: "previousFile",
  j: "next",
  k: "previous",
} as const satisfies Record<string, KeyIntent["kind"]>;

const DIGIT = /^[1-9]$/u;

const SHELL_WIDTH = "(min-width: 70rem)";

export const intentOf = (
  press: KeyPress,
  on: boolean
): KeyIntent | undefined => {
  if (press.inField || press.altKey || press.ctrlKey || press.metaKey) {
    return undefined;
  }

  if (press.key === "?") {
    return { kind: "keys" };
  }

  if (press.key === "Escape") {
    return { kind: "clear" };
  }

  if (!on) {
    return undefined;
  }

  if (DIGIT.test(press.key)) {
    return { index: Number(press.key), kind: "copy" };
  }

  const move = Object.entries(MOVES).find(([key]) => key === press.key);

  return move === undefined ? undefined : { kind: move[1] };
};

const SWITCH = "keys.single";

export const readShortcuts = (storage?: Storage): boolean =>
  storage === undefined ||
  Result.getOrElse(
    Result.try(() => storage.getItem(SWITCH) !== "off"),
    () => true
  );

export const writeShortcuts = (storage: Storage | undefined, on: boolean) => {
  Result.try(() => storage?.setItem(SWITCH, on ? "on" : "off"));
};

const localStorageOf = (): Storage | undefined =>
  Result.getOrUndefined(Result.try(() => globalThis.localStorage));

const KEYS = [
  { does: "Show these keys", keys: ["?"] },
  { does: "Next or previous row", keys: ["j", "k"] },
  { does: "Open the focused row", keys: ["Enter"] },
  { does: "Next or previous file", keys: ["J", "K"] },
  { does: "Copy the page's numbered command", keys: ["1", "…", "9"] },
  { does: "Close, or clear the selection", keys: ["Esc"] },
] as const;

const SETTINGS = [
  { label: "On", on: true },
  { label: "Off", on: false },
] as const;

export const KeysHelp = ({
  on,
  onChange,
}: {
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}) => (
  <div className="flex flex-col gap-5">
    <dl className="text-ui grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5">
      {KEYS.map(({ does, keys }) => (
        <div className="contents" key={does}>
          <dt className="flex items-center gap-1">
            {keys.map((key) =>
              key === "…" ? (
                <span className="text-muted-foreground" key={key}>
                  to
                </span>
              ) : (
                <Kbd key={key}>{key}</Kbd>
              )
            )}
          </dt>
          <dd>{does}</dd>
        </div>
      ))}
    </dl>
    <fieldset className="border-rule flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <legend className="text-ui float-left font-medium">
        Single-key shortcuts
      </legend>
      <div className="border-input flex border">
        {SETTINGS.map(({ label, on: setting }) => (
          <button
            aria-pressed={on === setting}
            className="text-ui aria-pressed:bg-foreground aria-pressed:text-background hover:bg-surface aria-pressed:hover:bg-foreground h-8 cursor-pointer px-3 font-medium transition-colors duration-150"
            key={label}
            onClick={() => {
              onChange(setting);
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
    <p className="text-muted-foreground text-label">
      Off, only ? acts. No key acts while you type in a field.
    </p>
  </div>
);

export type CommandSlot = "facts" | "main";

const SlotContext = createContext<CommandSlot>("main");

export const CommandSlotProvider = ({
  children,
  slot,
}: {
  readonly children: ReactNode;
  readonly slot: CommandSlot;
}) => <SlotContext value={slot}>{children}</SlotContext>;

interface ListRegistration {
  readonly focus: (id: string) => void;
  readonly read: () => {
    readonly ids: readonly string[];
    readonly onSelect: (id: string) => void;
  };
  focused?: string;
}

interface FileRegistration {
  readonly read: () => {
    readonly onMove: (path: string) => void;
    readonly paths: readonly string[];
  };
  at?: string;
}

interface Command {
  readonly command: string;
  readonly id: string;
  readonly slot: CommandSlot;
}

interface Registry {
  readonly clearers: Set<() => void>;
  readonly files: Set<FileRegistration>;
  readonly lists: Set<ListRegistration>;
  readonly register: (command: Command) => () => void;
}

interface KeysState {
  readonly copied: string | undefined;
  readonly numbered: ReadonlyMap<string, number>;
  readonly on: boolean;
  readonly setOn: (on: boolean) => void;
}

const RegistryContext = createContext<Registry | undefined>(undefined);

const StateContext = createContext<KeysState | undefined>(undefined);

export const useKeys = () => useContext(StateContext);

const held = <A,>(set: Set<A>, item: A) => {
  set.add(item);

  return () => {
    set.delete(item);
  };
};

/** The page's own, over any that left late. */
const lastOf = <A,>(set: ReadonlySet<A>): A | undefined => [...set].at(-1);

export const inField = (event: KeyboardEvent) => {
  const [target] = event.composedPath();

  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(
        "input, textarea, select, [role=combobox], [role=searchbox], [role=textbox], [data-keys-off]"
      ) !== null)
  );
};

const numberOf = (
  commands: readonly Command[]
): ReadonlyMap<string, number> => {
  const ordered = [
    ...commands.filter(({ slot }) => slot === "facts"),
    ...commands.filter(({ slot }) => slot === "main"),
  ];

  const unique = [...new Set(ordered.map(({ command }) => command))];

  return new Map(
    unique.slice(0, 9).map((command, index) => [command, index + 1])
  );
};

const copyNumbered = (command: string, shown: (copied?: string) => void) =>
  Effect.tryPromise(() => navigator.clipboard.writeText(command)).pipe(
    Effect.andThen(
      Effect.sync(() => {
        shown(command);
      })
    ),
    Effect.andThen(Effect.sleep("2 seconds")),
    Effect.andThen(
      Effect.sync(() => {
        shown();
      })
    ),
    Effect.ignore
  );

const moveTo = (list: ListRegistration, step: 1 | -1) => {
  const { ids, onSelect } = list.read();
  const at = list.focused === undefined ? -1 : ids.indexOf(list.focused);

  const next =
    ids[
      Math.min(
        Math.max(at === -1 && step === -1 ? 0 : at + step, 0),
        ids.length - 1
      )
    ];

  if (next === undefined) {
    return;
  }

  list.focused = next;
  list.focus(next);

  const row = document.querySelector(`[data-list-key="${CSS.escape(next)}"]`);

  if (row instanceof HTMLElement) {
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: "nearest" });
  }

  if (globalThis.matchMedia(SHELL_WIDTH).matches) {
    onSelect(next);
  }
};

const moveFile = (files: FileRegistration, step: 1 | -1) => {
  const { onMove, paths } = files.read();
  const at = files.at === undefined ? -1 : paths.indexOf(files.at);
  const next = paths[Math.min(Math.max(at + step, 0), paths.length - 1)];

  if (next !== undefined) {
    files.at = next;
    onMove(next);
  }
};

interface Pressing {
  readonly copy: (command: string) => void;
  readonly numbered: ReadonlyMap<string, number>;
  readonly on: boolean;
  readonly openDialog: () => void;
  readonly registry: Registry;
}

const act = (intent: KeyIntent, now: Pressing): boolean => {
  const { registry } = now;

  if (intent.kind === "keys") {
    now.openDialog();

    return true;
  }

  if (intent.kind === "clear") {
    // An open sheet or dialog closes itself on Escape.
    if (document.querySelector('[role="dialog"]') === null) {
      lastOf(registry.clearers)?.();
    }

    return false;
  }

  if (intent.kind === "copy") {
    const command = [...now.numbered].find(
      ([, index]) => index === intent.index
    )?.[0];

    if (command !== undefined) {
      now.copy(command);
    }

    return command !== undefined;
  }

  if (intent.kind === "next" || intent.kind === "previous") {
    const list = lastOf(registry.lists);

    if (list !== undefined) {
      moveTo(list, intent.kind === "next" ? 1 : -1);
    }

    return list !== undefined;
  }

  const files = lastOf(registry.files);

  if (files !== undefined) {
    moveFile(files, intent.kind === "nextFile" ? 1 : -1);
  }

  return files !== undefined;
};

export const KeysProvider = ({
  children,
  openDialog,
}: {
  readonly children: ReactNode;
  readonly openDialog: () => void;
}) => {
  // The server has no storage and renders the keys on; nothing it renders
  // depends on them.
  const [on, setOn] = useState(() => readShortcuts(localStorageOf()));
  const [commands, setCommands] = useState<readonly Command[]>([]);
  const [copied, setCopied] = useState<string>();

  const registry = useMemo<Registry>(
    () => ({
      clearers: new Set(),
      files: new Set(),
      lists: new Set(),
      register: (command) => {
        setCommands((now) => [...now, command]);

        return () => {
          setCommands((now) => now.filter(({ id }) => id !== command.id));
        };
      },
    }),
    []
  );

  const turn = useCallback((next: boolean) => {
    setOn(next);
    writeShortcuts(localStorageOf(), next);
  }, []);

  const numbered = useMemo(() => numberOf(commands), [commands]);

  const pressing = useRef<Pressing | null>(null);

  useEffect(() => {
    pressing.current = {
      copy: (command) => {
        Effect.runFork(copyNumbered(command, setCopied));
      },
      numbered,
      on,
      openDialog,
      registry,
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = pressing.current;

      if (now === null || event.defaultPrevented || event.repeat) {
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

      if (intent !== undefined && act(intent, now)) {
        event.preventDefault();
      }
    };

    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const state = useMemo(
    () => ({ copied, numbered, on, setOn: turn }),
    [copied, numbered, on, turn]
  );

  return (
    <RegistryContext value={registry}>
      <StateContext value={state}>
        {children}
        <output aria-live="polite" className="sr-only">
          {copied === undefined ? "" : `Copied: ${copied}`}
        </output>
      </StateContext>
    </RegistryContext>
  );
};

const useLatest = <A,>(value: A) => {
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
  });

  return latest;
};

export const useListKeys = (
  ids: readonly string[],
  onSelect: (id: string) => void
): { readonly focused?: string } => {
  const registry = useContext(RegistryContext);
  const [focused, setFocused] = useState<string>();
  const latest = useLatest({ ids, onSelect });

  useEffect(
    () =>
      registry === undefined
        ? undefined
        : held(registry.lists, {
            focus: setFocused,
            read: () => latest.current,
          }),
    [latest, registry]
  );

  return focused === undefined ? {} : { focused };
};

export const useFileKeys = (
  paths: readonly string[],
  onMove: (path: string) => void
): void => {
  const registry = useContext(RegistryContext);
  const latest = useLatest({ onMove, paths });

  useEffect(
    () =>
      registry === undefined
        ? undefined
        : held(registry.files, { read: () => latest.current }),
    [latest, registry]
  );
};

export const useNumberedCommand = (command: string): number | undefined => {
  const registry = useContext(RegistryContext);
  const state = useContext(StateContext);
  const slot = useContext(SlotContext);
  const id = useId();

  useEffect(
    () => registry?.register({ command, id, slot }),
    [command, id, registry, slot]
  );

  return state?.on === true ? state.numbered.get(command) : undefined;
};

export const useCopiedCommand = (): Option.Option<string> =>
  Option.fromUndefinedOr(useContext(StateContext)?.copied);

export const useEscapeClears = (clear: () => void): void => {
  const registry = useContext(RegistryContext);
  const latest = useLatest(clear);

  useEffect(
    () =>
      registry === undefined
        ? undefined
        : held(registry.clearers, () => {
            latest.current();
          }),
    [latest, registry]
  );
};
