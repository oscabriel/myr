/**
 * The keyboard's single keys: what each press does, when none acts (focus in
 * a text field, the switch off), and the switch itself, kept in the
 * browser's storage as a per-viewer convenience that must survive a
 * storage that refuses to read or write.
 */
import { describe, expect, it } from "@effect/vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  intentOf,
  KeysHelp,
  readShortcuts,
  writeShortcuts,
} from "../src/features/shared/keys.tsx";

/** A press of `key` outside any text field, with no modifier held. */
const press = (key: string, inField = false) => ({
  altKey: false,
  ctrlKey: false,
  inField,
  key,
  metaKey: false,
});

/** A `Storage` whose every read and write throws, as a blocked one does. */
const refusing: Storage = {
  clear: () => {
    throw new Error("blocked");
  },
  getItem: () => {
    throw new Error("blocked");
  },
  key: () => {
    throw new Error("blocked");
  },
  get length(): number {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

/** A `Storage` held in a map, as a browser's is. */
const kept = (): Storage => {
  const items = new Map<string, string>();

  return {
    clear: () => {
      items.clear();
    },
    getItem: (name) => items.get(name) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
    removeItem: (name) => {
      items.delete(name);
    },
    setItem: (name, value) => {
      items.set(name, value);
    },
  };
};

describe("a single key", () => {
  it("opens the keys dialog with ?", () => {
    expect(intentOf(press("?"), true)).toStrictEqual({ kind: "keys" });
  });

  it("moves through the page's list with j and k, and its files with J and K", () => {
    expect(
      ["j", "k", "J", "K"].map((key) => intentOf(press(key), true))
    ).toStrictEqual([
      { kind: "next" },
      { kind: "previous" },
      { kind: "nextFile" },
      { kind: "previousFile" },
    ]);
  });

  it("copies the page's numbered commands with 1 to 9, and nothing with 0", () => {
    expect(intentOf(press("1"), true)).toStrictEqual({
      index: 1,
      kind: "copy",
    });
    expect(intentOf(press("9"), true)).toStrictEqual({
      index: 9,
      kind: "copy",
    });
    expect(intentOf(press("0"), true)).toBeUndefined();
  });

  it("clears with Escape", () => {
    expect(intentOf(press("Escape"), true)).toStrictEqual({ kind: "clear" });
  });

  it("does nothing once the switch is off, but ? still opens the dialog that holds it", () => {
    expect(intentOf(press("j"), false)).toBeUndefined();
    expect(intentOf(press("1"), false)).toBeUndefined();
    expect(intentOf(press("?"), false)).toStrictEqual({ kind: "keys" });
  });

  it("does nothing while focus is in a text field, ? and Escape included", () => {
    expect(
      ["j", "?", "1", "Escape"].map((key) => intentOf(press(key, true), true))
    ).toStrictEqual([undefined, undefined, undefined, undefined]);
  });

  it("leaves a press with Ctrl, Alt or Meta to the browser", () => {
    expect(intentOf({ ...press("k"), ctrlKey: true }, true)).toBeUndefined();
    expect(intentOf({ ...press("j"), metaKey: true }, true)).toBeUndefined();
    expect(intentOf({ ...press("1"), altKey: true }, true)).toBeUndefined();
  });
});

describe("the switch", () => {
  it("is on until it is turned off, and stays as it was left", () => {
    const storage = kept();

    expect(readShortcuts(storage)).toBeTruthy();

    writeShortcuts(storage, false);

    expect(readShortcuts(storage)).toBeFalsy();

    writeShortcuts(storage, true);

    expect(readShortcuts(storage)).toBeTruthy();
  });

  it("is on when the storage refuses to read, and a refused write changes nothing", () => {
    expect(readShortcuts(refusing)).toBeTruthy();
    expect(() => {
      writeShortcuts(refusing, false);
    }).not.toThrow();
    expect(readShortcuts()).toBeTruthy();
  });

  it("is in the dialog, with every key and what it does", () => {
    const markup = renderToStaticMarkup(
      <KeysHelp
        on={false}
        onChange={() => {
          // A static render never presses it.
        }}
      />
    );

    const text = markup.replaceAll(/<[^>]+>/gu, " ");

    expect(text).toContain("Single-key shortcuts");
    expect(markup).toMatch(
      /<button\b[^>]*aria-pressed="true"[^>]*>Off<\/button>/u
    );
    expect(markup).toMatch(
      /<button\b[^>]*aria-pressed="false"[^>]*>On<\/button>/u
    );

    for (const key of ["?", "j", "k", "J", "K", "1", "9", "Esc"]) {
      expect(markup).toContain(`<kbd`);
      expect(text).toContain(key);
    }
  });
});
