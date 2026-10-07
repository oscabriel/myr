/**
 * Reads a shell command line the way bash would, as far as the hook policy
 * needs: simple commands split on `; && || | ( )` and newlines, words after
 * quote removal (single, double, `$'…'` and backslash escapes), the files a
 * command reads with `<`, and heredoc and here-string text. What runs inside
 * `$(…)`, backticks and `<(…)` comes back as simple commands too; an unquoted
 * heredoc's substitutions run, a quoted one's don't.
 *
 * Variables and globs stay unexpanded, and a substitution's word holds its
 * source text. Unclosed quotes run to the end, so a command bash would refuse
 * to parse is still read for what it holds.
 */

/**
 * One simple command: its words after quote removal, the files it reads with
 * `<`, and the heredoc or here-string text on its stdin.
 */
export interface Simple {
  readonly words: string[];
  readonly reads: string[];
  readonly stdin: string[];
}

interface Scanned {
  readonly commands: readonly Simple[];
  /** Just past the `)` that closed a nested scan, or the source's end. */
  readonly end: number;
}

/** A heredoc whose body starts after the next newline. */
interface Heredoc {
  readonly delimiter: string;
  /** A quoted delimiter keeps `$(…)` in the body from running. */
  readonly quoted: boolean;
  /** `<<-` strips leading tabs from each line. */
  readonly tabs: boolean;
  readonly into: string[];
}

/** What the word being read is for. */
type Slot =
  | "argument"
  | "read"
  | "write"
  | "here-string"
  | "heredoc"
  | "heredoc-tabs";

/** Redirect operators, longest first, and what the word after each is. */
const REDIRECTS: readonly (readonly [string, Slot])[] = [
  ["<<<", "here-string"],
  ["<<-", "heredoc-tabs"],
  ["&>>", "write"],
  ["<<", "heredoc"],
  ["<>", "read"],
  ["<&", "write"],
  ["&>", "write"],
  [">>", "write"],
  [">|", "write"],
  [">&", "write"],
  ["<", "read"],
  [">", "write"],
];

const BLANKS = new Set([" ", "\t"]);

// Inside double quotes, `\` escapes only these.
const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);

// Inside backticks, `\` escapes only these.
const BACKTICK_ESCAPES = new Set(["`", "\\", "$"]);

const ANSI_C: ReadonlyMap<string, string> = new Map([
  ["E", "\u001B"],
  ["a", "\u0007"],
  ["b", "\b"],
  ["e", "\u001B"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["v", "\v"],
]);

const ANSI_C_ESCAPE =
  /\\(?:x(?<hex>[\da-f]{1,2})|u(?<unicode>[\da-f]{1,4})|(?<octal>[0-7]{1,3})|(?<char>[\s\S]))/giu;

const decodeEscape = (
  hex: string | undefined,
  unicode: string | undefined,
  octal: string | undefined,
  char: string | undefined
): string => {
  if (hex !== undefined) {
    return String.fromCodePoint(Number.parseInt(hex, 16));
  }

  if (unicode !== undefined) {
    return String.fromCodePoint(Number.parseInt(unicode, 16));
  }

  if (octal !== undefined) {
    return String.fromCodePoint(Number.parseInt(octal, 8));
  }

  return ANSI_C.get(char ?? "") ?? char ?? "";
};

/** The text of an ANSI-C quoted `$'…'` body, escapes decoded. */
const ansiC = (body: string): string => {
  let decoded = "";
  let from = 0;

  for (const match of body.matchAll(ANSI_C_ESCAPE)) {
    const { char, hex, octal, unicode } = match.groups ?? {};

    decoded += body.slice(from, match.index);
    decoded += decodeEscape(hex, unicode, octal, char);
    from = match.index + match[0].length;
  }

  return decoded + body.slice(from);
};

/**
 * Reads `src` from `start` into simple commands. A nested scan (inside `$(`)
 * stops at its unmatched `)`. Unclosed quotes run to the end, so a command a
 * shell would refuse to parse is still judged on what it holds.
 */
const scan = (src: string, start: number, nested: boolean): Scanned => {
  const commands: Simple[] = [];
  const heredocs: Heredoc[] = [];
  let simple: Simple = { reads: [], stdin: [], words: [] };
  let word = "";
  let inWord = false;
  let quoted = false;
  let slot: Slot = "argument";
  let depth = 0;
  let at = start;

  const append = (text: string, fromQuotes: boolean) => {
    word += text;
    inWord = true;
    quoted ||= fromQuotes;
  };

  // `$(…)`: what it runs is judged; its source text stands in for its output.
  const substitution = (from: number) => {
    const inner = scan(src, from + 2, true);

    commands.push(...inner.commands);

    return { end: inner.end, text: src.slice(from, inner.end) };
  };

  // `…`: up to the next unescaped backtick.
  const backtick = (from: number) => {
    let body = "";
    let end = from + 1;

    while (end < src.length && src[end] !== "`") {
      const next = src[end + 1] ?? "";
      const escaped = src[end] === "\\" && BACKTICK_ESCAPES.has(next);

      body += escaped ? next : (src[end] ?? "");
      end += escaped ? 2 : 1;
    }

    commands.push(...scan(body, 0, false).commands);

    return { end: end + 1, text: src.slice(from, end + 1) };
  };

  // Double-quoted text, or an unquoted heredoc's body: `$(…)` and backticks
  // still run there. Stops before `limit`, or at `closing`.
  const expand = (from: number, limit: number, closing: string) => {
    let text = "";
    let end = from;

    while (end < limit && src[end] !== closing) {
      const char = src[end] ?? "";
      const next = src[end + 1] ?? "";

      if (char === "\\" && DOUBLE_QUOTE_ESCAPES.has(next)) {
        text += next === "\n" ? "" : next;
        end += 2;
      } else if ((char === "$" && next === "(") || char === "`") {
        const { end: after, text: source } =
          char === "`" ? backtick(end) : substitution(end);

        text += source;
        end = after;
      } else {
        text += char;
        end += 1;
      }
    }

    return { end: end + 1, text };
  };

  // At a newline: each pending heredoc's body, line by line to its delimiter.
  const readHeredocs = (from: number): number => {
    let line = from;

    for (const heredoc of heredocs) {
      const lines: string[] = [];
      const bodyStart = line;
      let bodyEnd = line;

      while (line < src.length) {
        const newline = src.indexOf("\n", line);
        const eol = newline === -1 ? src.length : newline;
        const raw = src.slice(line, eol);
        const text = heredoc.tabs ? raw.replace(/^\t+/u, "") : raw;

        line = eol + 1;

        if (text === heredoc.delimiter) {
          break;
        }

        lines.push(text);
        bodyEnd = eol;
      }

      heredoc.into.push(lines.join("\n"));

      if (!heredoc.quoted) {
        expand(bodyStart, bodyEnd, "");
      }
    }

    heredocs.splice(0);

    return line;
  };

  const finishWord = () => {
    if (!inWord) {
      return;
    }

    if (slot === "argument") {
      simple.words.push(word);
    } else if (slot === "read") {
      simple.reads.push(word);
    } else if (slot === "here-string") {
      simple.stdin.push(word);
    } else if (slot === "heredoc" || slot === "heredoc-tabs") {
      heredocs.push({
        delimiter: word,
        into: simple.stdin,
        quoted,
        tabs: slot === "heredoc-tabs",
      });
    }

    word = "";
    inWord = false;
    quoted = false;
    slot = "argument";
  };

  const finishCommand = () => {
    finishWord();
    slot = "argument";

    const { reads, stdin, words } = simple;

    if (words.length + reads.length + stdin.length > 0) {
      commands.push(simple);
    }

    simple = { reads: [], stdin: [], words: [] };
  };

  // `<`, `<<`, `>`, `>>`, `&>` and the rest. An unquoted all-digit word right
  // before one is its file descriptor, not an argument.
  const redirect = (): number => {
    if (inWord && !quoted && /^\d+$/u.test(word)) {
      word = "";
      inWord = false;
    } else {
      finishWord();
    }

    const [operator, target] = REDIRECTS.find(([text]) =>
      src.startsWith(text, at)
    ) ?? [">", "write"];

    slot = target;

    return at + operator.length;
  };

  // `$'…'`, `$(…)` and `${…}`; any other `$` is a literal.
  const dollar = (next: string): number | undefined => {
    if (next === "'") {
      let end = at + 2;

      while (end < src.length && src[end] !== "'") {
        end += src[end] === "\\" ? 2 : 1;
      }

      append(ansiC(src.slice(at + 2, Math.min(end, src.length))), true);

      return end + 1;
    }

    if (next === "(") {
      const inner = substitution(at);

      append(inner.text, false);

      return inner.end;
    }

    if (next === "{") {
      const close = src.indexOf("}", at);
      const end = close === -1 ? src.length : close + 1;

      append(src.slice(at, end), false);

      return end;
    }

    return undefined;
  };

  // Quotes, escapes and expansions, each part of the current word. None when
  // `char` starts none of them.
  const wordPart = (char: string, next: string): number | undefined => {
    if (char === "\\") {
      if (next !== "\n") {
        append(next, true);
      }

      return at + 2;
    }

    if (char === "'") {
      const close = src.indexOf("'", at + 1);
      const end = close === -1 ? src.length : close;

      append(src.slice(at + 1, end), true);

      return end + 1;
    }

    if (char === '"') {
      const inner = expand(at + 1, src.length, '"');

      append(inner.text, true);

      return inner.end;
    }

    // Backticks, and the process substitutions `<(…)` and `>(…)`.
    if (char === "`" || ((char === "<" || char === ">") && next === "(")) {
      const inner = char === "`" ? backtick(at) : substitution(at);

      append(inner.text, false);

      return inner.end;
    }

    return char === "$" ? dollar(next) : undefined;
  };

  // Blanks, newlines, comments, redirects and the operators between simple
  // commands. None when `char` is none of them.
  const operator = (char: string, next: string): number | undefined => {
    if (BLANKS.has(char)) {
      finishWord();

      return at + 1;
    }

    if (char === "\n") {
      finishCommand();

      return heredocs.length > 0 ? readHeredocs(at + 1) : at + 1;
    }

    if (char === "#" && !inWord) {
      const newline = src.indexOf("\n", at);

      return newline === -1 ? src.length : newline;
    }

    if (char === "<" || char === ">" || (char === "&" && next === ">")) {
      return redirect();
    }

    if (char === ";" || char === "&" || char === "|") {
      finishCommand();

      return at + (next === char || (char === "|" && next === "&") ? 2 : 1);
    }

    if (char === "(" || char === ")") {
      finishCommand();
      depth = char === "(" ? depth + 1 : Math.max(0, depth - 1);

      return at + 1;
    }

    return undefined;
  };

  while (at < src.length) {
    const char = src[at] ?? "";
    const next = src[at + 1] ?? "";

    if (char === ")" && nested && depth === 0) {
      finishCommand();

      return { commands, end: at + 1 };
    }

    const after = wordPart(char, next) ?? operator(char, next);

    if (after === undefined) {
      append(char, false);
      at += 1;
    } else {
      at = after;
    }
  }

  finishCommand();

  return { commands, end: src.length };
};

/** The simple commands in `command`, including those inside substitutions. */
export const simpleCommands = (command: string): readonly Simple[] =>
  scan(command, 0, false).commands;

/** The words of the first simple command in `text`, as `env -S` splits it. */
export const wordsOf = (text: string): readonly string[] =>
  scan(text, 0, false).commands[0]?.words ?? [];
