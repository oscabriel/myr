// `domain/` imports only `effect` and sibling files, never the RPC stack, so
// the SDK and the rules sandbox can load it.
import { Schema } from "effect";

import { RepoPath } from "../ids.ts";

export const Glob = Schema.NonEmptyString.pipe(Schema.brand("Glob"));

export type Glob = typeof Glob.Type;

export const Command = Schema.NonEmptyString.pipe(Schema.brand("Command"));

export type Command = typeof Command.Type;

export const Hostname = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/u
    )
  ),
  Schema.brand("Hostname")
);

export type Hostname = typeof Hostname.Type;

export const JsonPath = Schema.NonEmptyString.pipe(Schema.brand("JsonPath"));

export type JsonPath = typeof JsonPath.Type;

// Not `Symbol`, which would shadow the global.
export const SymbolName = Schema.NonEmptyString.pipe(
  Schema.brand("SymbolName")
);

export type SymbolName = typeof SymbolName.Type;

export const RefNameText = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^refs\/(?!.*\.\.)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/u)
  ),
  Schema.brand("RefNameText")
);

export type RefNameText = typeof RefNameText.Type;

export const Evidence = Schema.Struct({
  href: Schema.optionalKey(Schema.NonEmptyString),
  label: Schema.NonEmptyString,
  value: Schema.String,
});

export type Evidence = typeof Evidence.Type;

export const ConfigFile = Schema.Struct({
  content: Schema.String,
  path: RepoPath,
});

export type ConfigFile = typeof ConfigFile.Type;

export const AtLeastOne = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const NoneOrMore = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const At = Schema.Struct({
  line: AtLeastOne,
  path: RepoPath,
});

export type At = typeof At.Type;
