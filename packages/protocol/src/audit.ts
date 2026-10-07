/**
 * Which harness runs the CLI, read from the env the harness gives its
 * children, and how that travels to the platform: as the basic-auth
 * username git sends beside the token. It is audit metadata, never
 * identity: the token in the password slot is the only identity. The env
 * table lives here once; the CLI's agent policy and git's credential helper
 * both read it through `detectHarness`.
 */
import { Option, Schema } from "effect";
import type { Types } from "effect";

/** What the platform records of the harness behind a call. */
export const HarnessAudit = Schema.Struct({
  harness: Schema.optionalKey(Schema.NonEmptyString),
  model: Schema.optionalKey(Schema.NonEmptyString),
  session: Schema.optionalKey(Schema.NonEmptyString),
});

export type HarnessAudit = typeof HarnessAudit.Type;

/** Whether an env name is one of a harness's markers. */
const named =
  (...names: readonly string[]) =>
  (key: string) =>
    names.includes(key);

const prefixed = (prefix: string) => (key: string) => key.startsWith(prefix);

/**
 * Each harness and the env names that mark it, in the order they are
 * tried. `AI_AGENT` comes before all of them and is taken verbatim.
 */
const markers = [
  {
    harness: "claude-code",
    marks: named("CLAUDECODE", "CLAUDE_CODE", "CLAUDE_CODE_ENTRYPOINT"),
  },
  { harness: "codex", marks: prefixed("CODEX_") },
  { harness: "cursor", marks: named("CURSOR_AGENT") },
  { harness: "opencode", marks: named("OPENCODE") },
  { harness: "amp", marks: prefixed("AMP_") },
  { harness: "pi", marks: prefixed("PI_") },
  { harness: "gemini", marks: named("GEMINI_CLI") },
] as const satisfies readonly {
  readonly harness: string;
  readonly marks: (key: string) => boolean;
}[];

/** `value`, unless it is absent or empty. */
const given = (value: string | undefined) =>
  value === undefined || value === "" ? undefined : value;

/** pi's model, as `provider/model` when pi names both. */
const piModel = (env: Readonly<Record<string, string | undefined>>) => {
  const model = given(env.PI_MODEL);
  const provider = given(env.PI_PROVIDER);

  return model === undefined || provider === undefined
    ? model
    : `${provider}/${model}`;
};

/**
 * The harness `env` says runs this process: `AI_AGENT` verbatim, else the
 * first harness whose marker is set. pi also names its model
 * (`PI_PROVIDER/PI_MODEL`) and session (`PI_SESSION_ID`) to its children.
 */
export const detectHarness = (
  env: Readonly<Record<string, string | undefined>>
): HarnessAudit => {
  const set = Object.keys(env).filter((key) => given(env[key]) !== undefined);

  const harness =
    given(env.AI_AGENT) ??
    markers.find(({ marks }) => set.some(marks))?.harness;

  const audit: Types.Mutable<HarnessAudit> = {};

  if (harness === undefined) {
    return audit;
  }

  audit.harness = harness;

  if (harness !== "pi") {
    return audit;
  }

  const model = piModel(env);
  const session = given(env.PI_SESSION_ID);

  if (model !== undefined) {
    audit.model = model;
  }

  if (session !== undefined) {
    audit.session = session;
  }

  return audit;
};

/** The username's fields, in the order they are written. */
const fields = ["harness", "model", "session"] as const;

const PREFIX = "audit;";

/**
 * The longest value a field keeps: three of them, with the prefix and their
 * keys, stay within 200 characters (30 + 3 × 56 = 198).
 */
const VALUE_LIMIT = 56;

/** `value` with every character a username field can't carry as `_`, cut to the limit. */
const clean = (value: string) =>
  value.replaceAll(/[^A-Za-z0-9._/-]/gu, "_").slice(0, VALUE_LIMIT);

/**
 * The basic-auth username that carries `audit`:
 * `audit;harness=pi&model=moonshot/kimi-k3`. Values keep `[A-Za-z0-9._/-]`
 * and turn anything else into `_`, so `;`, `&`, `=` and `:` never occur in
 * one; the whole stays within 200 characters.
 */
export const auditUser = (audit: HarnessAudit): string =>
  `${PREFIX}${fields
    .flatMap((field) => {
      const value = audit[field];

      return value === undefined ? [] : [`${field}=${clean(value)}`];
    })
    .join("&")}`;

const Pair = /^(?<field>harness|model|session)=(?<value>[A-Za-z0-9._/-]+)$/u;

/** What an `auditUser` username carries; none for any other username. */
export const parseAuditUser = (user: string): Option.Option<HarnessAudit> => {
  if (!user.startsWith(PREFIX)) {
    return Option.none();
  }

  const rest = user.slice(PREFIX.length);

  const pairs =
    rest === "" ? [] : rest.split("&").map((pair) => Pair.exec(pair));

  const entries = pairs.flatMap((match) =>
    match?.groups?.field === undefined || match.groups.value === undefined
      ? []
      : [[match.groups.field, match.groups.value] as const]
  );

  return entries.length === pairs.length
    ? Schema.decodeOption(HarnessAudit)(Object.fromEntries(entries))
    : Option.none();
};
