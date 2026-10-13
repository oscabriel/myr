/** A `localStorage` that keeps what is written, for one test. */
export const keptStorage = (entries: Readonly<Record<string, string>> = {}) => {
  const items = new Map<string, string>(Object.entries(entries));

  const storage: Storage = {
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

  return storage;
};

const blocked = () => {
  throw new Error("blocked");
};

/** A `localStorage` the browser refuses (a private window, blocked site data). */
export const refusingStorage: Storage = {
  clear: blocked,
  getItem: blocked,
  key: blocked,
  get length(): number {
    return blocked();
  },
  removeItem: blocked,
  setItem: blocked,
};
