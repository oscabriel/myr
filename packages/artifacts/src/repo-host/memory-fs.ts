type ReadOptions = string | { readonly encoding?: string } | undefined;

interface Stats {
  readonly mode: number;
  readonly size: number;
  readonly ino: number;
  readonly uid: number;
  readonly gid: number;
  readonly dev: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly isFile: () => boolean;
  readonly isDirectory: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

const failure = (code: string, path: string) =>
  Promise.reject(Object.assign(new Error(`${code}: ${path}`), { code }));

const normalize = (path: string) =>
  `/${path
    .split("/")
    .filter((part) => part !== "")
    .join("/")}`;

const parentOf = (path: string) => {
  const cut = path.lastIndexOf("/");

  return cut <= 0 ? "/" : path.slice(0, cut);
};

// isomorphic-git asks for text as "utf8", alone or as `{ encoding }`.
const UTF8 = /^utf-?8$/iu;

const wantsText = (options: ReadOptions) =>
  options instanceof Object
    ? UTF8.test(options.encoding ?? "")
    : UTF8.test(options ?? "");

const stats = (kind: "file" | "dir", size: number): Stats => ({
  ctimeMs: 0,
  dev: 1,
  gid: 1,
  ino: 0,
  isDirectory: () => kind === "dir",
  isFile: () => kind === "file",
  isSymbolicLink: () => false,
  mode: kind === "dir" ? 0o4_0000 : 0o10_0644,
  mtimeMs: 0,
  size,
  uid: 1,
});

// Repos here hold no symlinks, but isomorphic-git binds both methods.
const readlink = (raw: string) => failure("EINVAL", normalize(raw));

const symlink = (_target: string, raw: string) =>
  failure("ENOSYS", normalize(raw));

export const memoryFs = () => {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(["/"]);

  const childrenOf = (dir: string) => {
    const prefix = dir === "/" ? "/" : `${dir}/`;
    const names = new Set<string>();

    for (const path of [...files.keys(), ...dirs]) {
      if (path !== dir && path.startsWith(prefix)) {
        names.add(path.slice(prefix.length).split("/")[0] ?? "");
      }
    }

    return [...names];
  };

  // isomorphic-git calls `readFile()` with no path to learn whether this fs
  // returns promises, so that call must answer with a rejected promise.
  const readFile = (raw?: string, options?: ReadOptions) => {
    const path = normalize(raw ?? "");
    const content = files.get(path);

    if (content === undefined) {
      return failure(dirs.has(path) ? "EISDIR" : "ENOENT", path);
    }

    return Promise.resolve(
      wantsText(options) ? new TextDecoder().decode(content) : content
    );
  };

  const writeFile = (raw: string, data: string | Uint8Array) => {
    const path = normalize(raw);

    if (!dirs.has(parentOf(path))) {
      return failure("ENOENT", path);
    }

    files.set(
      path,
      data instanceof Uint8Array
        ? Uint8Array.from(data)
        : new TextEncoder().encode(data)
    );

    return Promise.resolve();
  };

  const unlink = (raw: string) => {
    const path = normalize(raw);

    return files.delete(path) ? Promise.resolve() : failure("ENOENT", path);
  };

  const readdir = (raw: string) => {
    const path = normalize(raw);

    if (files.has(path)) {
      return failure("ENOTDIR", path);
    }

    return dirs.has(path)
      ? Promise.resolve(childrenOf(path))
      : failure("ENOENT", path);
  };

  const mkdir = (raw: string) => {
    const path = normalize(raw);

    if (dirs.has(path) || files.has(path)) {
      return failure("EEXIST", path);
    }

    if (!dirs.has(parentOf(path))) {
      return failure("ENOENT", path);
    }

    dirs.add(path);

    return Promise.resolve();
  };

  const rmdir = (raw: string) => {
    const path = normalize(raw);

    if (!dirs.has(path)) {
      return failure("ENOENT", path);
    }

    if (childrenOf(path).length > 0) {
      return failure("ENOTEMPTY", path);
    }

    dirs.delete(path);

    return Promise.resolve();
  };

  const stat = (raw: string) => {
    const path = normalize(raw);
    const content = files.get(path);

    if (content !== undefined) {
      return Promise.resolve(stats("file", content.byteLength));
    }

    return dirs.has(path)
      ? Promise.resolve(stats("dir", 0))
      : failure("ENOENT", path);
  };

  const removeTree = (raw: string) => {
    const root = normalize(raw);

    const inside = (path: string) =>
      path === root || path.startsWith(`${root}/`);

    for (const path of [...files.keys()].filter(inside)) {
      files.delete(path);
    }

    for (const path of [...dirs].filter(inside)) {
      dirs.delete(path);
    }
  };

  return {
    promises: {
      lstat: stat,
      mkdir,
      readFile,
      readdir,
      readlink,
      rmdir,
      stat,
      symlink,
      unlink,
      writeFile,
    },
    removeTree,
  };
};
