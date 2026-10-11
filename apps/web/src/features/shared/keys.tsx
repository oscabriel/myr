/**
 * The keyboard's single keys, one listener for the whole shell:
 *
 * - `?` opens the keys dialog, which lists them and holds the switch;
 * - `j` / `k` move through the page's list (its rows, `useListKeys`), and at
 *   the shell's width select the row, so the inspector follows; `Enter`
 *   opens the focused row, as a link does;
 * - `J` / `K` move between the page's files (`useFileKeys`);
 * - `1` to `9` copy the page's numbered commands, the inspector's first
 *   (`useNumberedCommand`);
 * - `Escape` clears the selection (a sheet or a dialog closes itself).
 *
 * No key acts while focus is in a text field, a combobox or the tree's
 * search, or with Ctrl, Alt or Meta held. Every key has a twin a pointer
 * reaches: rows are links, files are the tree's rows, commands have their
 * copy buttons. The switch turns every key but `?` off (WCAG 2.2 SC 2.1.4)
 * and is the viewer's own: kept in this browser's storage, on until turned
 * off, and on whenever the storage cannot be read.
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

/** A key pressed, as the listener reads it. */
export interface KeyPress {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  /** Whether focus is in a text field, a combobox or a search. */
  readonly inField: boolean;
  readonly key: string;
  readonly metaKey: boolean;
}

/** What a key asks for. */
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

/** The shell's width, from which the rail and the inspector are columns. */
const SHELL_WIDTH = "(min-width: 70rem)";

/**
 * What `press` asks for, with the single keys `on` or off; nothing for a
 * press in a text field, with a modifier held, or with no meaning here.
 */
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

/** Where the switch is kept, in the browser's storage. */
const SWITCH = "keys.single";

/** Whether the single keys are on: on unless `storage` says off, or cannot say. */
export const readShortcuts = (storage?: Storage): boolean =>
  storage === undefined ||
  Result.getOrElse(
    Result.try(() => storage.getItem(SWITCH) !== "off"),
    () => true
  );

/** Keep the switch as `on` says; a storage that refuses keeps nothing. */
export const writeShortcuts = (storage: Storage | undefined, on: boolean) => {
  Result.try(() => storage?.setItem(SWITCH, on ? "on" : "off"));
};

/** The browser's storage, when there is one this page may use. */
const localStorageOf = (): Storage | undefined =>
  Result.getOrUndefined(Result.try(() => globalThis.localStorage));

/** The keys and what each does, as the dialog lists them. */
const KEYS = [
  { does: "Show these keys", keys: ["?"] },
  { does: "Next or previous row", keys: ["j", "k"] },
  { does: "Open the focused row", keys: ["Enter"] },
  { does: "Next or previous file", keys: ["J", "K"] },
  { does: "Copy the page's numbered command", keys: ["1", "…", "9"] },
  { does: "Close, or clear the selection", keys: ["Esc"] },
] as const;

/** The switch's two settings, each a button that says whether it is pressed. */
const SETTINGS = [
  { label: "On", on: true },
  { label: "Off", on: false },
] as const;

/**
 * The keys dialog's body: every key with what it does, and the switch. `?`
 * opens it even with the switch off, so the switch is always in reach.
 */
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

/** Which part of the page a command sits in: the inspector's are numbered first. */
export type CommandSlot = "facts" | "main";

const SlotContext = createContext<CommandSlot>("main");

/** Commands under `slot` number as the inspector's or main's. */
export const CommandSlotProvider = ({
  children,
  slot,
}: {
  readonly children: ReactNode;
  readonly slot: CommandSlot;
}) => <SlotContext value={slot}>{children}</SlotContext>;

/** A list the page lets `j` and `k` move through. */
interface ListRegistration {
  readonly focus: (id: string) => void;
  readonly read: () => {
    readonly ids: readonly string[];
    readonly onSelect: (id: string) => void;
  };
  focused?: string;
}

/** The files a page lets `J` and `K` move between. */
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

/** What the page registers with the listener; one for the shell's life. */
interface Registry {
  readonly clearers: Set<() => void>;
  readonly files: Set<FileRegistration>;
  readonly lists: Set<ListRegistration>;
  readonly register: (command: Command) => () => void;
}

/** What the keys show: whether they are on, the numbers, the last copy. */
interface KeysState {
  readonly copied: string | undefined;
  readonly numbered: ReadonlyMap<string, number>;
  readonly on: boolean;
  readonly setOn: (on: boolean) => void;
}

const RegistryContext = createContext<Registry | undefined>(undefined);

const StateContext = createContext<KeysState | undefined>(undefined);

/** The keys' state, for the dialog. */
export const useKeys = () => useContext(StateContext);

/** `item` in `set` until the returned function takes it out. */
const held = <A,>(set: Set<A>, item: A) => {
  set.add(item);

  return () => {
    set.delete(item);
  };
};

/** The last registered of `set`: the page's own, over any that left late. */
const lastOf = <A,>(set: ReadonlySet<A>): A | undefined => [...set].at(-1);

/** Whether `event` was pressed inside something that takes typing. */
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

/** Numbers commands 1 to 9: the inspector's first, each command once. */
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

/** Copy `command`, then mark it copied for two seconds. */
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

/** The row a key moved to: focused, scrolled to, and selected at the shell's width. */
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

  // The inspector is a column at the shell's width, so a move selects there.
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

/** What the listener reads when a key is pressed. */
interface Pressing {
  readonly copy: (command: string) => void;
  readonly numbered: ReadonlyMap<string, number>;
  readonly on: boolean;
  readonly openDialog: () => void;
  readonly registry: Registry;
}

/** Do what `intent` asks; whether it did anything (so the browser does not too). */
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

/**
 * The shell's one listener and the state behind it. `openDialog` opens the
 * keys dialog (the shell draws it).
 */
export const KeysProvider = ({
  children,
  openDialog,
}: {
  readonly children: ReactNode;
  readonly openDialog: () => void;
}) => {
  // The server has no storage and renders the keys on; nothing it renders
  // depends on them (a command's number comes once the page has run).
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

  // The listener reads the latest of these, kept here after each render.
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

/** `value`, kept current in a ref after each render, for a handler to read later. */
const useLatest = <A,>(value: A) => {
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
  });

  return latest;
};

/**
 * Let `j` and `k` move through `ids` (the page's rows, in order); at the
 * shell's width each move also selects the row (`onSelect`). Give each row's
 * link `data-list-key={id}` so the move focuses it and `Enter` opens it.
 * Returns the row the keys rest on, to draw as focused.
 */
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

/** Let `J` and `K` move between `paths` (the page's files, in order), each move calling `onMove`. */
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

/**
 * Number `command` among the page's commands: the digit that copies it, while
 * the single keys are on, to show before it ("Copy (1)"); nothing when they
 * are off or it is past the ninth.
 */
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

/** The command a number key copied in the last two seconds, to show as copied. */
export const useCopiedCommand = (): Option.Option<string> =>
  Option.fromUndefinedOr(useContext(StateContext)?.copied);

/** Let `Escape` call `clear` while the caller is on the page (the selection's). */
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
