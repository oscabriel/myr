/**
 * Small schemas the domain's nouns share. Like every file in `domain/`, this
 * one imports only `effect` and sibling protocol files, never the RPC stack,
 * so the SDK and the rules sandbox can load it.
 */
import { Schema } from "effect";

import { RepoPath } from "../ids.ts";

/** A path pattern in a repo, as the config folder writes one: `packages/parse/**`. */
export const Glob = Schema.NonEmptyString.pipe(Schema.brand("Glob"));

export type Glob = typeof Glob.Type;

/**
 * One of the project's own commands, as its maintainers write it in the run
 * block: `bun test {path}`. The platform runs it; it never rewrites it.
 */
export const Command = Schema.NonEmptyString.pipe(Schema.brand("Command"));

export type Command = typeof Command.Type;

/** A host a check's setup may reach, or an env item's proxy may serve: `registry.npmjs.org`. */
export const Hostname = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/u
    )
  ),
  Schema.brand("Hostname")
);

export type Hostname = typeof Hostname.Type;

/** Where a ratchet reads its number in a command's JSON output: `/total/lines`. */
export const JsonPath = Schema.NonEmptyString.pipe(Schema.brand("JsonPath"));

export type JsonPath = typeof JsonPath.Type;

/**
 * A name in the project's code that a migrate ask moves from or to: an
 * exported function, type or module. (`Symbol` would shadow the global.)
 */
export const SymbolName = Schema.NonEmptyString.pipe(
  Schema.brand("SymbolName")
);

export type SymbolName = typeof SymbolName.Type;

/** A full git ref name, as text: `refs/heads/main`. */
export const RefNameText = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^refs\/(?!.*\.\.)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/u)
  ),
  Schema.brand("RefNameText")
);

export type RefNameText = typeof RefNameText.Type;

/**
 * One fact a decider weighs on Today, as a label and a value, with a link to
 * more when there is one. Never a diff, unless the ask's kind allows a finish.
 */
export const Evidence = Schema.Struct({
  href: Schema.optionalKey(Schema.NonEmptyString),
  label: Schema.NonEmptyString,
  value: Schema.String,
});

export type Evidence = typeof Evidence.Type;

/**
 * One file an ask or a proposal adds to the config folder: its path and its
 * text, as `openAsk` and `proposeAsk` carry them.
 */
export const ConfigFile = Schema.Struct({
  content: Schema.String,
  path: RepoPath,
});

export type ConfigFile = typeof ConfigFile.Type;

/** A count or span that must hold at least one: a cap, a budget, a race, a window. */
export const AtLeastOne = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** A count or span that may be zero but never less: a record's count, a delay. */
export const NoneOrMore = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Where in the tree something points, when it points at one line. */
export const At = Schema.Struct({
  line: AtLeastOne,
  path: RepoPath,
});

export type At = typeof At.Type;
