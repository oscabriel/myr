/**
 * Globs read as `.gitignore` reads them: a glob with a `/` before its end is
 * anchored at the root, and one with none matches a file's name at any depth.
 * The gate keeps its own matcher rather than importing `@repo/checks`' (it
 * takes no checks dependency); both read the same globs.
 */

// The characters a RegExp reads as syntax, which a glob means literally.
const SYNTAX = new Set("\\^$.|+()[]{}");

const sourceOf = (glob: string) => {
  let source = "";
  let at = 0;

  while (at < glob.length) {
    if (glob.startsWith("**/", at)) {
      // Any number of whole folders, none included.
      source += "(?:.*/)?";
      at += 3;
    } else if (glob.startsWith("/**", at) && at + 3 === glob.length) {
      // The folder itself, or anything under it.
      source += "(?:/.*)?";
      at += 3;
    } else if (glob.startsWith("**", at)) {
      source += ".*";
      at += 2;
    } else {
      const char = glob.charAt(at);

      if (char === "*") {
        source += "[^/]*";
      } else if (char === "?") {
        source += "[^/]";
      } else {
        source += SYNTAX.has(char) ? `\\${char}` : char;
      }

      at += 1;
    }
  }

  return `^${source}$`;
};

/**
 * The glob as one anchored at the root, by `.gitignore`'s rules. Whether it
 * is anchored is read before a trailing `/` becomes `/**`, so `generated/`
 * is every folder of that name.
 */
const anchored = (glob: string) => {
  const folder = glob.endsWith("/") ? `${glob}**` : glob;

  if (folder.startsWith("/")) {
    return folder.slice(1);
  }

  return glob.slice(0, -1).includes("/") ? folder : `**/${folder}`;
};

export const matchGlob = (glob: string, path: string): boolean =>
  new RegExp(sourceOf(anchored(glob)), "u").test(path);

export const matchAny = (globs: readonly string[], path: string): boolean =>
  globs.some((glob) => !glob.startsWith("!") && matchGlob(glob, path)) &&
  !globs.some((glob) => glob.startsWith("!") && matchGlob(glob.slice(1), path));
