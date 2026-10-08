/**
 * The static half of "red for the right reason": five shapes of check
 * that pass whatever the answer does, read from the check file's source
 * before it ever runs. It reads expect-style checks (vitest, jest, bun); a
 * file with no `expect(` call (pytest, go test) is outside it and flags
 * nothing, and the twice-red run still guards it.
 */
import { Array, Option, pipe } from "effect";

/**
 * A shape of check that passes whatever the answer does, as `WeakCheck`'s
 * `weakness` names it.
 */
export type Weakness =
  | "self-referential"
  | "constant pin"
  | "absence-only"
  | "mock-only"
  | "fixture-asserts-fixture";

/**
 * The check file as an ask carries it: its repo path, which places its
 * relative imports, and its source.
 */
export interface CheckFile {
  readonly path: string;
  readonly content: string;
}

/** One `expect(subject).matcher(expected)` in the check, as source text. */
interface Expectation {
  readonly subject: string;
  readonly negated: boolean;
  readonly matcher: string;
  readonly expected: string;
}

/** The check's source twice: without comments, and with string contents blanked too. */
interface Source {
  readonly text: string;
  readonly masked: string;
}

const QUOTES = new Set(['"', "'", "`"]);

/** The index just past the string literal that opens at `start`. */
const stringEnd = (source: string, start: number) => {
  const quote = source[start];
  let at = start + 1;

  while (at < source.length && source[at] !== quote) {
    at += source[at] === "\\" ? 2 : 1;
  }

  return Math.min(at + 1, source.length);
};

const blank = (text: string) => text.replaceAll(/[^\n]/gu, " ");

/**
 * Comments become spaces in both copies; a string stays in `text` and keeps
 * only its quotes in `masked`. Both keep every index, so a position found in
 * `masked` reads the same span of `text`.
 */
const read = (source: string): Source => {
  const text: string[] = [];
  const masked: string[] = [];
  let at = 0;

  while (at < source.length) {
    const pair = source.slice(at, at + 2);
    const char = source[at] ?? "";

    if (pair === "//" || pair === "/*") {
      // A line comment ends before its newline, a block comment after `*/`.
      const close = pair === "//" ? "\n" : "*/";
      const found = source.indexOf(close, at + 2);
      const end = found === -1 ? source.length : found + close.length;
      const span = blank(source.slice(at, end));

      text.push(span);
      masked.push(span);
      at = end;
    } else if (QUOTES.has(char)) {
      const end = stringEnd(source, at);
      const literal = source.slice(at, end);

      text.push(literal);
      masked.push(`${char}${blank(literal.slice(1, -1))}${literal.slice(-1)}`);
      at = end;
    } else {
      text.push(char);
      masked.push(char);
      at += 1;
    }
  }

  return { masked: masked.join(""), text: text.join("") };
};

/** The index of the `)` that closes the `(` at `open`, in masked source. */
const closing = (masked: string, open: number) => {
  let depth = 0;

  for (let at = open; at < masked.length; at += 1) {
    if (masked[at] === "(") {
      depth += 1;
    } else if (masked[at] === ")") {
      depth -= 1;

      if (depth === 0) {
        return Option.some(at);
      }
    }
  }

  return Option.none();
};

const expectationAt = (
  { masked, text }: Source,
  start: number
): Option.Option<Expectation> =>
  Option.gen(function* () {
    const open = masked.indexOf("(", start);
    const close = yield* closing(masked, open);

    // `.not`, `.resolves` and `.rejects`, then the matcher's call.
    const chain =
      /\s*(?<modifiers>(?:\.\s*(?:not|resolves|rejects)\s*)*)\.\s*(?<matcher>[A-Za-z_$][\w$]*)\s*\(/uy;

    chain.lastIndex = close + 1;
    const found = yield* Option.fromNullishOr(chain.exec(masked));
    const matcherOpen = found.index + found[0].length - 1;
    const matcherClose = yield* closing(masked, matcherOpen);

    return {
      expected: text.slice(matcherOpen + 1, matcherClose).trim(),
      matcher: found.groups?.matcher ?? "",
      negated: /\bnot\b/u.test(found.groups?.modifiers ?? ""),
      subject: text.slice(open + 1, close).trim(),
    };
  });

const expectationsOf = (source: Source) =>
  Array.getSomes(
    Array.map(
      [...source.masked.matchAll(/(?<![\w$.])expect\s*\(/gu)],
      (match) => expectationAt(source, match.index)
    )
  );

const importsOf = ({ masked, text }: Source) =>
  pipe(
    [
      ...text.matchAll(
        /(?<keyword>\bfrom|\bimport\s*\(?|\brequire\s*\()\s*["'](?<specifier>[^"'\n]+)["']/gu
      ),
    ],
    // A keyword inside a string is blanked in `masked`.
    Array.filter((match) => masked[match.index] !== " "),
    Array.map((match) => match.groups?.specifier ?? "")
  );

const EXTENSION = /\.(?:[cm]?[jt]sx?|json)$/u;

const GLOB = /[*?[{]/u;

const segmentsOf = (path: string) =>
  path.split("/").filter((segment) => segment !== "" && segment !== ".");

/**
 * The folder a territory glob covers: its fixed head (`packages/week/**` →
 * `packages/week`), or, for a glob naming one file, that file's folder, since
 * a check reaches a file through its folder's index too.
 */
const baseOf = (glob: string) => {
  const segments = segmentsOf(glob);
  const fixed = Array.takeWhile(segments, (segment) => !GLOB.test(segment));

  const isFile =
    fixed.length === segments.length && EXTENSION.test(fixed.at(-1) ?? "");

  return isFile ? fixed.slice(0, -1) : fixed;
};

/** A relative import's repo path, resolved from the check file's folder. */
const resolve = (checkPath: string, specifier: string) => {
  const resolved = segmentsOf(checkPath).slice(0, -1);

  for (const segment of segmentsOf(specifier)) {
    if (segment === "..") {
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }

  return resolved;
};

const startsWith = (path: readonly string[], head: readonly string[]) =>
  head.every((segment, index) => path[index] === segment);

/**
 * Whether an import reaches into a territory's folder: a relative import
 * that resolves inside it, or to a folder above it (`../src` reaching
 * `src/week.ts` through `src/index.ts`), or a package import whose unscoped
 * name is one of its folders (`@datekit/week` for `packages/week/**`).
 */
const reaches =
  (checkPath: string) => (specifier: string, base: readonly string[]) => {
    if (!specifier.startsWith(".")) {
      const parts = specifier.split("/");
      const name = specifier.startsWith("@") ? parts[1] : parts[0];

      return name !== undefined && base.includes(name);
    }

    const path = resolve(checkPath, specifier);

    return startsWith(path, base) || startsWith(base, path);
  };

// After strings, numbers and the literal keywords go, a literal has no
// identifier left but its object keys, and no call or arrow.
const isLiteral = (text: string) =>
  text !== "" &&
  !/[(=]/u.test(text) &&
  !/[A-Za-z_$]/u.test(
    text
      .replaceAll(
        /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\$]|\\.)*`/gu,
        "0"
      )
      .replaceAll(
        /\b(?:0[box][\da-f_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?)\b/giu,
        "0"
      )
      .replaceAll(/\b(?:true|false|null|undefined|NaN|Infinity)\b/gu, "0")
      .replaceAll(/[A-Za-z_$][\w$]*\s*:/gu, "")
  );

/** `not.toThrow()`, `toBeUndefined()`, `toBeFalsy()` and their mirrors. */
const isAbsence = ({ matcher, negated }: Expectation) =>
  negated
    ? ["toThrow", "toThrowError", "toBeDefined", "toBeTruthy"].includes(matcher)
    : ["toBeUndefined", "toBeFalsy"].includes(matcher);

const MOCK_MATCHER =
  /^to(?:HaveBeen(?:Last|Nth)?Called|BeCalled|Have(?:Last|Nth)?Returned)/u;

const rootOf = (text: string) =>
  /^(?:await\s+)?(?<root>[A-Za-z_$][\w$]*)/u.exec(text)?.groups?.root;

const mocksOf = ({ text }: Source) =>
  new Set(
    Array.map(
      [
        ...text.matchAll(
          /\b(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:(?:vi|jest)\.(?:fn|spyOn)|mock)\s*\(/gu
        ),
      ],
      (match) => match.groups?.name ?? ""
    )
  );

const isOnMock = (mocks: ReadonlySet<string>) => (each: Expectation) =>
  MOCK_MATCHER.test(each.matcher) ||
  each.subject.includes(".mock.") ||
  /\b(?:vi|jest)\.fn\s*\(/u.test(each.subject) ||
  mocks.has(rootOf(each.subject) ?? "");

/** The names the check binds to a call's result (`const range = weekRange(…)`). */
const resultsOf = ({ text }: Source) =>
  new Set(
    Array.map(
      [
        ...text.matchAll(
          /\b(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[A-Za-z_$][\w$.]*\s*\(/gu
        ),
      ],
      (match) => match.groups?.name ?? ""
    )
  );

const squash = (text: string) => text.replaceAll(/\s+/gu, "");

/**
 * Expected and actual from one source: the same expression twice, or the
 * subject read straight off the fixture the expected one comes from. A value
 * the check computed is not a fixture: two of its fields may be compared
 * (`expect(range.start).toBeLessThan(range.end)`).
 */
const isFromOneFixture =
  (results: ReadonlySet<string>) =>
  ({ expected, subject }: Expectation) => {
    const root = rootOf(subject);

    return (
      !isLiteral(subject) &&
      (squash(subject) === squash(expected) ||
        (!subject.includes("(") &&
          root !== undefined &&
          !results.has(root) &&
          root === rootOf(expected)))
    );
  };

/** `expect(1).toBe(1)`: a literal held against a literal, or against nothing. */
const isConstantPin = ({ expected, subject }: Expectation) =>
  isLiteral(subject) && (expected === "" || isLiteral(expected));

/**
 * The weak shapes a check file is in, given the territory's paths (globs).
 * A shape over expectations holds only when every expectation in the file
 * has it, so one real assertion among weak ones keeps the check:
 *
 * - `self-referential`: the check imports nothing from the territory's
 *   folders (its relative imports resolved from its own path);
 * - `constant pin`: every expectation holds a literal against a literal
 *   (`expect(1).toBe(1)`);
 * - `absence-only`: every expectation is `not.toThrow`, `toBeUndefined` or
 *   `toBeFalsy` (or a mirror);
 * - `mock-only`: every expectation is on a `vi.fn()` or a spy;
 * - `fixture-asserts-fixture`: every expectation takes expected and actual
 *   from the same fixture, or computes both the same way.
 */
export const weaknessesOf = (
  checkFile: CheckFile,
  territoryPaths: readonly string[]
): readonly Weakness[] => {
  const source = read(checkFile.content);
  const expectations = expectationsOf(source);

  if (!Array.isReadonlyArrayNonEmpty(expectations)) {
    return [];
  }

  const bases = territoryPaths.map(baseOf);
  const intoTerritory = reaches(checkFile.path);
  const mocks = mocksOf(source);

  const every = (holds: (each: Expectation) => boolean) =>
    expectations.every(holds);

  const found: readonly [Weakness, boolean][] = [
    [
      "self-referential",
      !importsOf(source).some((specifier) =>
        bases.some((base) => intoTerritory(specifier, base))
      ),
    ],
    ["constant pin", every(isConstantPin)],
    ["absence-only", every(isAbsence)],
    ["mock-only", every(isOnMock(mocks))],
    ["fixture-asserts-fixture", every(isFromOneFixture(resultsOf(source)))],
  ];

  return found.flatMap(([weakness, holds]) => (holds ? [weakness] : []));
};
