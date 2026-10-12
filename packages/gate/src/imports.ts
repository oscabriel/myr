// Stage 1 reads imports from text, with no compiler and no file system. Full
// resolution (path aliases, `exports` conditions, re-exports) is stage 3's.
import type { Policy } from "@repo/protocol/domain/policy";
import type { RepoPath } from "@repo/protocol/ids";
import { Array, Option } from "effect";

import { matchAny } from "./glob.ts";

export interface ImportSpecifier {
  readonly specifier: string;
  readonly line: number;
}

type Mode = "code" | "comment" | "block" | "quote" | "template" | "regex";

// After one of these, a `/` opens a regular expression, not a division.
const OPENS_REGEX = new Set("(,=:[!&|?{};+-*%<>~^");

// A postfix `++` or `--` ends an operand, so the `/` after it divides.
const POSTFIX = /(?:\+\+|--)$/u;

const KEYWORD_BEFORE_REGEX =
  /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/u;

/**
 * A line whose code opens with `*` reads as the inside of a block comment: an
 * answer's added lines can start after the comment opened.
 */
const maskOf = (text: string): string => {
  let out = "";
  let mode: Mode = "code";
  let quote = "";
  let inClass = false;
  let tail = "";
  let blankLine = true;
  const expressions: number[] = [];

  const emit = (chars: string, as: "blank" | "fill") => {
    for (const char of chars) {
      if (char === "\n") {
        out += char;
        blankLine = true;
      } else {
        out += as === "blank" ? " " : "_";
      }
    }
  };

  const keep = (chars: string) => {
    out += chars;
    tail = (tail + chars).slice(-32);
    blankLine = chars.endsWith("\n") || (blankLine && chars.trim() === "");
  };

  const close = (char: string) => {
    mode = "code";
    keep(char);
  };

  const inComment = (char: string) => {
    if (char === "\n") {
      mode = "code";
    }

    emit(char, "blank");

    return 1;
  };

  const inBlock = (char: string, next: string) => {
    if (char === "*" && next === "/") {
      mode = "code";
      emit("*/", "blank");

      return 2;
    }

    emit(char, "blank");

    return 1;
  };

  const inQuote = (char: string, next: string) => {
    if (char === "\\") {
      emit(char + next, "fill");

      return 2;
    }

    if (char === quote || char === "\n") {
      close(char);
    } else {
      emit(char, "fill");
    }

    return 1;
  };

  const inTemplate = (char: string, next: string) => {
    if (char === "\\") {
      emit(char + next, "fill");

      return 2;
    }

    if (char === "$" && next === "{") {
      expressions.push(0);
      close("${");

      return 2;
    }

    if (char === "`") {
      close(char);
    } else {
      emit(char, "fill");
    }

    return 1;
  };

  const inRegex = (char: string, next: string) => {
    if (char === "\\") {
      emit(char + next, "fill");

      return 2;
    }

    if (char === "\n" || (char === "/" && !inClass)) {
      close(char);
    } else {
      inClass = char === "[" || (inClass && char !== "]");
      emit(char, "fill");
    }

    return 1;
  };

  const opensRegex = () => {
    const before = tail.trimEnd();

    return (
      before === "" ||
      (OPENS_REGEX.has(before.slice(-1)) && !POSTFIX.test(before)) ||
      KEYWORD_BEFORE_REGEX.test(before)
    );
  };

  const opened = (char: string): Mode => {
    if (char === '"' || char === "'") {
      quote = char;

      return "quote";
    }

    if (char === "`") {
      return "template";
    }

    if (char === "/" && opensRegex()) {
      inClass = false;

      return "regex";
    }

    return "code";
  };

  const brace = (char: string) => {
    const open = expressions.pop();

    if (open === undefined) {
      return;
    }

    if (char === "}" && open === 0) {
      mode = "template";
    } else {
      expressions.push(open + (char === "{" ? 1 : 0) - (char === "}" ? 1 : 0));
    }
  };

  const inCode = (char: string, next: string) => {
    if (char === "/" && (next === "/" || next === "*")) {
      mode = next === "/" ? "comment" : "block";
      emit(char + next, "blank");

      return 2;
    }

    if (char === "*" && blankLine) {
      mode = "comment";
      emit(char, "blank");

      return 1;
    }

    mode = opened(char);

    if (mode === "code" && (char === "{" || char === "}")) {
      brace(char);
    }

    keep(char);

    return 1;
  };

  const steps = {
    block: inBlock,
    code: inCode,
    comment: inComment,
    quote: inQuote,
    regex: inRegex,
    template: inTemplate,
  } as const satisfies Record<Mode, (char: string, next: string) => number>;

  let at = 0;

  while (at < text.length) {
    at += steps[mode](text.charAt(at), text.charAt(at + 1));
  }

  return out;
};

// Each form of import, read in the masked text: `… from "x"` (an import or
// re-export, or the last line of one), `import "x"`, `import("x")` and
// `require("x")`. A string's contents read as `_`. A call may also name its
// module by a template with no `${}`, which is as fixed as a string; one with
// a substitution keeps its `${`, so it never matches.
const FORMS = [
  /(?<![\w$.])from\s*(?<quote>["'])(?<contents>_+)\k<quote>/gu,
  /(?<![\w$.])import\s*(?<quote>["'])(?<contents>_+)\k<quote>/gu,
  /(?<![\w$.])import\s*\(\s*(?<quote>["'`])(?<contents>_+)\k<quote>/gu,
  /(?<![\w$.])require\s*\(\s*(?<quote>["'`])(?<contents>_+)\k<quote>/gu,
];

export const importSpecifiers = (text: string): readonly ImportSpecifier[] => {
  const masked = maskOf(text);

  return FORMS.flatMap((form) =>
    [...masked.matchAll(form)].map((match) => {
      const contents = match.groups?.contents ?? "";
      // The contents end one character before the match does, at the quote.
      const start = match.index + match[0].length - 1 - contents.length;

      return {
        line: text.slice(0, start).split("\n").length,
        specifier: text.slice(start, start + contents.length),
        start,
      };
    })
  )
    .toSorted((one, other) => one.start - other.start)
    .map(({ line, specifier }) => ({ line, specifier }));
};

const RELATIVE = /^\.\.?(?:\/|$)/u;

const INSIDES = new Set(["src", "test", "internal"]);

type Module = Policy["modules"][number];

const moduleOf = (modules: Policy["modules"], path: string) =>
  Array.findFirst(modules, (module) => matchAny(module.paths, path));

const resolve = (from: string, specifier: string): Option.Option<string> => {
  const parts = from.split("/").slice(0, -1);

  for (const part of specifier.split("/")) {
    if (part === "..") {
      if (parts.length === 0) {
        return Option.none();
      }

      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }

  return Option.some(parts.join("/"));
};

const bare = (path: string) =>
  path.replace(/\.[cm]?[jt]sx?$/u, "").replace(/\/index$/u, "");

const rootsOf = (module: Module) =>
  module.paths.map((glob) =>
    glob.replace(/^\//u, "").replace(/\/(?:\*\*)?$/u, "")
  );

const isInternal = (module: Module, target: string) =>
  module.publicFiles !== undefined &&
  !rootsOf(module).includes(target) &&
  !module.publicFiles.some((file) => bare(file) === bare(target));

const relative = (
  from: string,
  specifier: string,
  modules: Policy["modules"]
) =>
  Option.flatMap(resolve(from, specifier), (target) =>
    Option.filter(moduleOf(modules, target), (module) =>
      isInternal(module, target)
    )
  );

const subpath = (specifier: string, modules: Policy["modules"]) => {
  const segments = specifier.split("/");
  const length = specifier.startsWith("@") ? 2 : 1;
  const name = segments.slice(0, length).join("/");

  return segments.slice(length).some((segment) => INSIDES.has(segment))
    ? Array.findFirst(modules, (module) => module.module === name)
    : Option.none();
};

export const reachedInternals = (input: {
  readonly from: RepoPath;
  readonly specifier: string;
  readonly modules: Policy["modules"];
}): Option.Option<{ readonly from: RepoPath; readonly to: string }> => {
  const { from, modules, specifier } = input;
  const own = Option.map(moduleOf(modules, from), (module) => module.module);

  const reached = RELATIVE.test(specifier)
    ? relative(from, specifier, modules)
    : subpath(specifier, modules);

  return Option.flatMap(reached, (module) =>
    Option.contains(own, module.module)
      ? Option.none()
      : Option.some({ from, to: specifier })
  );
};
