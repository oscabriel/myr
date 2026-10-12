// Read the way varlock reads it, and never resolved. Where the header is
// silent, items are required and sensitive, as in varlock.
import type { EnvItem, EnvSchemaView } from "@repo/protocol/domain/env";
import { EnvKey } from "@repo/protocol/ids";
import type { LandedSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Array, Option, Predicate, Schema } from "effect";
import type { Types } from "effect";

import { isArgs, isCall, isList } from "./env-schema.ts";
import type {
  ParsedArgs,
  ParsedDecorator,
  ParsedEnvSchema,
  ParsedItem,
  ParsedValue,
} from "./env-schema.ts";

type Header = ParsedEnvSchema["header"];

const namedArg = (args: ParsedArgs, key: string): Option.Option<ParsedValue> =>
  Option.map(
    Array.findFirst(args.named, (arg) => arg.key === key),
    ({ value }) => value
  );

/** As in varlock, the first flag written decides. */
const firstNamed = (
  decorators: readonly ParsedDecorator[],
  ...names: readonly string[]
): Option.Option<ParsedDecorator> =>
  Array.findFirst(decorators, ({ name }) => names.includes(name));

/** `depends` when the flag's value is anything but `true` or `false`, which only the environment decides. */
const flagOf = (
  decorators: readonly ParsedDecorator[],
  flag: string,
  opposite: string
): Option.Option<boolean | "depends"> =>
  Option.map(firstNamed(decorators, flag, opposite), ({ name, value }) => {
    if (!Predicate.isBoolean(value)) {
      return "depends";
    }

    return name === flag ? value : !value;
  });

type Proxy = NonNullable<EnvItem["proxy"]>;

const textsOf = (value: ParsedValue): Option.Option<readonly string[]> => {
  const each = Predicate.isString(value) ? [value] : value;

  return isList(each) && each.every(Predicate.isString)
    ? Option.some(each)
    : Option.none();
};

/**
 * Whether the platform's swap, the placeholder in any request header, stays
 * where the rule lets the value go: varlock's default (any header), or a
 * `substituteIn` that names `header` among its targets. A rule that allows
 * only some headers (`header:authorization`), the query or a body field
 * would see the value land where it never allowed it.
 */
const swapsInsideTargets = (args: ParsedArgs): boolean =>
  Option.match(namedArg(args, "substituteIn"), {
    onNone: () => true,
    onSome: (targets) =>
      Option.exists(textsOf(targets), (each) => each.includes("header")),
  });

/**
 * None when it names no host as text. A rule the platform cannot honour
 * exactly is blocked rather than widened: one that waits on an `approval`,
 * carries `rules` for other paths, computes its credential with a
 * `transform`, keeps the value out of some headers (`substituteIn`), or has
 * a path or method that is not text.
 */
const ruleOf = (args: ParsedArgs): Option.Option<Proxy> =>
  Option.flatMap(Option.flatMap(namedArg(args, "domain"), textsOf), (hosts) => {
    const domains = Array.filter(hosts, (host) => host !== "");

    if (!Array.isReadonlyArrayNonEmpty(domains)) {
      return Option.none();
    }

    const rule: Types.Mutable<Proxy> = { domains };
    const path = namedArg(args, "path");
    const method = namedArg(args, "method");
    const block = namedArg(args, "block");
    const methods = Option.flatMap(method, textsOf);

    const exact =
      (Option.isNone(path) || Predicate.isString(path.value)) &&
      (Option.isNone(method) || Option.isSome(methods)) &&
      Option.isNone(namedArg(args, "approval")) &&
      Option.isNone(namedArg(args, "rules")) &&
      Option.isNone(namedArg(args, "transform")) &&
      swapsInsideTargets(args);

    if (Option.isSome(path) && Predicate.isString(path.value)) {
      rule.path = path.value;
    }

    if (Option.isSome(methods)) {
      rule.method = methods.value.join(", ");
    }

    if (!exact || Option.isSome(block)) {
      rule.block =
        !exact || block.pipe(Option.exists((each) => each !== false));
    }

    return Option.some(rule);
  });

const isProxied = (item: ParsedItem): boolean =>
  item.decorators.some(
    ({ name, value }) =>
      name === "proxy" && value !== "passthrough" && value !== "omit"
  );

/**
 * Rules that differ only in hosts share one; a later rule that differs
 * otherwise is left out, so the value goes nowhere the shape doesn't show.
 */
export const proxyOf = (item: ParsedItem): Option.Option<Proxy> => {
  const rules = Array.getSomes(
    Array.map(item.decorators, ({ name, value }): Option.Option<Proxy> =>
      name === "proxy" && isArgs(value) ? ruleOf(value) : Option.none()
    )
  );

  return Option.map(Array.head(rules), (first) => {
    const same = (rule: Proxy) =>
      rule.path === first.path &&
      rule.method === first.method &&
      rule.block === first.block;

    return {
      ...first,
      domains: Array.dedupe(
        Array.appendAll(
          first.domains,
          rules
            .slice(1)
            .filter(same)
            .flatMap((rule) => rule.domains)
        )
      ),
    };
  });
};

const builtInTypes = [
  "array",
  "boolean",
  "domain",
  "duration",
  "email",
  "enum",
  "ip",
  "isoDate",
  "md5",
  "number",
  "port",
  "record",
  "semver",
  "simple-object",
  "string",
  "url",
  "uuid",
] as const satisfies readonly string[];

/**
 * Whether the item's `@type` names a type only a plugin knows. A plugin's
 * type may be a credential that varlock treats as sensitive, and no plugin
 * is loaded here, so such an item counts as sensitive.
 */
const isPluginTyped = (item: ParsedItem): boolean =>
  Option.exists(firstNamed(item.decorators, "type"), ({ value }) => {
    const type = isCall(value) ? value.fn : value;

    return !builtInTypes.some((builtIn) => builtIn === type);
  });

const enabledOf = (decorator: ParsedDecorator): ParsedDecorator =>
  decorator.name === "sensitive" && isArgs(decorator.value)
    ? {
        name: decorator.name,
        value: Option.getOrElse(
          namedArg(decorator.value, "enabled"),
          () => true
        ),
      }
    : decorator;

const defaultSensitive = (key: string, value: ParsedValue): boolean => {
  if (Predicate.isBoolean(value)) {
    return value;
  }

  const prefix =
    isCall(value) && value.fn === "inferFromPrefix"
      ? value.positional[0]
      : undefined;

  return !Predicate.isString(prefix) || !key.startsWith(prefix);
};

/**
 * A flag only the environment decides counts as sensitive, and so does an
 * item whose `@type` only a plugin knows; an item routed through `@proxy(…)`
 * is sensitive whatever it says, as in varlock.
 */
export const isSensitive = (item: ParsedItem, header: Header): boolean =>
  isProxied(item) ||
  Option.match(flagOf(item.decorators.map(enabledOf), "sensitive", "public"), {
    onNone: () =>
      isPluginTyped(item) ||
      Option.match(firstNamed(header, "defaultSensitive"), {
        onNone: () => true,
        onSome: ({ value }) => defaultSensitive(item.key, value),
      }),
    onSome: (flag) => flag !== false,
  });

export const requiredOf = (
  item: ParsedItem,
  header: Header
): boolean | "depends" =>
  Option.getOrElse(flagOf(item.decorators, "required", "optional"), () =>
    Option.match(firstNamed(header, "defaultRequired"), {
      onNone: () => true,
      onSome: ({ value }) => {
        if (value === "infer") {
          return item.value !== undefined && item.value !== "";
        }

        return Predicate.isBoolean(value) ? value : "depends";
      },
    })
  );

const textOf = (value: ParsedValue): string => {
  if (isCall(value)) {
    return value.text;
  }

  if (isList(value)) {
    return `[${value.map(textOf).join(", ")}]`;
  }

  if (isArgs(value)) {
    const named = value.named.map(
      ({ key, value: each }) => `${key}=${textOf(each)}`
    );

    return `(${[...value.positional.map(textOf), ...named].join(", ")})`;
  }

  return String(value);
};

const tagsOf = (item: ParsedItem): readonly string[] =>
  Array.dedupe(
    item.decorators.flatMap(({ name, value }) =>
      name === "tag" && isArgs(value)
        ? value.positional
            .filter((tag) => Predicate.isString(tag) || Predicate.isNumber(tag))
            .map(String)
            .filter((tag) => tag !== "")
        : []
    )
  );

const docsOf = (item: ParsedItem): Option.Option<string> =>
  Option.flatMap(firstNamed(item.decorators, "docs"), ({ value }) =>
    isArgs(value)
      ? Option.filter(Array.last(value.positional), Predicate.isString)
      : Option.none()
  );

const itemOf = (
  item: ParsedItem & { readonly key: EnvKey },
  header: Header
): EnvItem => {
  const shown: Types.Mutable<EnvItem> = {
    key: item.key,
    required: requiredOf(item, header),
    sensitive: isSensitive(item, header),
    tags: tagsOf(item),
  };

  const type = Option.filter(
    Option.map(firstNamed(item.decorators, "type"), ({ value }) =>
      textOf(value)
    ),
    (text) => text !== ""
  );

  if (Option.isSome(type)) {
    shown.type = type.value;
  }

  const docs = docsOf(item);

  if (Option.isSome(docs)) {
    shown.docs = docs.value;
  }

  const deprecated = firstNamed(item.decorators, "deprecated");

  if (Option.isSome(deprecated)) {
    shown.deprecated = deprecated.value.value !== false;
  }

  if (item.description !== undefined && item.description !== "") {
    shown.description = item.description;
  }

  const proxy = proxyOf(item);

  if (Option.isSome(proxy)) {
    shown.proxy = proxy.value;
  }

  const placeholder = Option.filter(
    Option.map(
      firstNamed(item.decorators, "placeholder"),
      ({ value }) => value
    ),
    Predicate.isString
  );

  if (Option.isSome(placeholder)) {
    shown.placeholder = placeholder.value;
  }

  return shown;
};

const isNamed = (
  item: ParsedItem
): item is ParsedItem & { readonly key: EnvKey } => Schema.is(EnvKey)(item.key);

const currentEnvOf = (header: Header): Option.Option<EnvKey> =>
  Option.flatMap(firstNamed(header, "currentEnv"), ({ value }) => {
    const key =
      isCall(value) && value.fn === "ref" ? value.positional[0] : undefined;

    return Schema.is(EnvKey)(key) ? Option.some(key) : Option.none();
  });

export const envSchemaViewOf = (input: {
  readonly at: LandedSha;
  readonly file: RepoPath;
  readonly parsed: ParsedEnvSchema;
  readonly project: ProjectName;
}): EnvSchemaView => {
  const { header, items } = input.parsed;

  const shown: Types.Mutable<EnvSchemaView> = {
    at: input.at,
    file: input.file,
    imports: input.parsed.imports,
    items: Array.map(Array.filter(items, isNamed), (item) =>
      itemOf(item, header)
    ),
    project: input.project,
  };

  const currentEnv = currentEnvOf(header);

  if (Option.isSome(currentEnv)) {
    shown.currentEnvKey = currentEnv.value;
  }

  return shown;
};
