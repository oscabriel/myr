/**
 * Reads one command's argv: which words are options, the values they take,
 * and which are operands. A program's `Grammar` names its options that take a
 * value; any option it doesn't name is taken to stand alone, which can only
 * turn a value into an option the policy judges, never hide one.
 */

/** A table of names, written as one space-separated line. */
export const names = (line: string): ReadonlySet<string> =>
  new Set(line.split(" ").filter((name) => name.length > 0));

/** Which options take a value, for one program. */
export interface Grammar {
  /** Options whose value is the next word unless attached: `-m`, `--message`. */
  readonly values: ReadonlySet<string>;
  /** Short options whose value, if any, is attached: `-S[keyid]`. */
  readonly attached: ReadonlySet<string>;
}

export interface Parsed {
  /** Each option by name: `-n`, `--no-verify`; a bundle `-anm` gives three. */
  readonly options: readonly string[];
  /** Each option that took a value, with that value. */
  readonly values: readonly (readonly [option: string, value: string])[];
  readonly operands: readonly string[];
}

export const grammar = (values: string, attached = ""): Grammar => ({
  attached: names(attached),
  values: names(values),
});

export const NO_OPTIONS = grammar("");

/** What one word of bundled short options holds. */
interface Bundle {
  readonly options: readonly string[];
  /** The value the last option took, attached or from the next word. */
  readonly value?: string;
  /** Whether that value was the next word. */
  readonly takesNext: boolean;
}

/** A bundle of short options, `-anm x`, `-mx`, `-Skey`: each letter, and a value if one takes it. */
const bundle = (
  arg: string,
  next: string | undefined,
  rules: Grammar
): Bundle => {
  const options: string[] = [];

  for (let offset = 1; offset < arg.length; offset += 1) {
    const option = `-${arg[offset] ?? ""}`;
    const rest = arg.slice(offset + 1);

    options.push(option);

    if (rules.values.has(option) && rest.length === 0) {
      return next === undefined
        ? { options, takesNext: false }
        : { options, takesNext: true, value: next };
    }

    if (rules.values.has(option) || rules.attached.has(option)) {
      return { options, takesNext: false, value: rest };
    }
  }

  return { options, takesNext: false };
};

/**
 * Splits `args` into options, the values they take, and operands. With
 * `permute`, options may follow operands, as git and GNU tools allow; without
 * it, the first operand and everything after it are operands, as a wrapper
 * hands them to the command it runs.
 */
export const parse = (
  args: readonly string[],
  rules: Grammar,
  permute: boolean
): Parsed => {
  const options: string[] = [];
  const values: (readonly [string, string])[] = [];
  const operands: string[] = [];
  let index = 0;

  while (index < args.length) {
    const arg = args[index] ?? "";
    const next = args[index + 1];

    index += 1;

    if (arg === "--") {
      operands.push(...args.slice(index));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      operands.push(...(permute ? [arg] : args.slice(index - 1)));

      if (!permute) {
        break;
      }
    } else if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = equals === -1 ? arg : arg.slice(0, equals);

      const takesNext =
        equals === -1 && rules.values.has(name) && next !== undefined;

      options.push(name);

      if (equals !== -1) {
        values.push([name, arg.slice(equals + 1)]);
      } else if (takesNext) {
        values.push([name, next]);
        index += 1;
      }
    } else {
      const short = bundle(arg, next, rules);

      options.push(...short.options);

      if (short.value !== undefined) {
        values.push([short.options.at(-1) ?? "", short.value]);
      }

      index += short.takesNext ? 1 : 0;
    }
  }

  return { operands, options, values };
};
