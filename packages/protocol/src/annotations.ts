import { Context, Schema } from "effect";

/**
 * What every contract says about itself, beside its schemas. Each is set with
 * `.annotate(Key, value)` on `Rpc.make(…)` and read with `Context.get`; a
 * contract that sets none gets the defaults below.
 */

/** What a contract does, in one sentence, for every surface that lists it. */
export const Description = Context.Reference<string>("protocol/Description", {
  defaultValue: () => "",
});

/**
 * Who may call it: anyone, a signed-in person, or one of the project's
 * deciders. The handler checks `decider`; the annotation documents it.
 */
export const Audience = Context.Reference<"public" | "signedIn" | "decider">(
  "protocol/Audience",
  { defaultValue: () => "signedIn" }
);

/** Whether its response may be shown to anyone, or only to maintainers. */
export const Visibility = Context.Reference<"public" | "maintainers">(
  "protocol/Visibility",
  { defaultValue: () => "public" }
);

/** It only reads: it changes nothing. */
export const ReadOnly = Context.Reference<boolean>("protocol/ReadOnly", {
  defaultValue: () => false,
});

/** Calling it again with the same payload changes nothing more. */
export const Idempotent = Context.Reference<boolean>("protocol/Idempotent", {
  defaultValue: () => false,
});

/**
 * It can destroy something a person cannot get back. Set it on every
 * contract: every tool carries this value, so a destructive contract that
 * forgot it would tell an agent it is safe (`annotations.test.ts` holds this).
 */
export const Destructive = Context.Reference<boolean>("protocol/Destructive", {
  defaultValue: () => false,
});

/** A person approves it before it runs: the CLI asks for `--yes`. */
export const NeedsApproval = Context.Reference<boolean>(
  "protocol/NeedsApproval",
  { defaultValue: () => false }
);

/** The CLI command it becomes: its name, and the payload fields taken in order. */
export const Cli = Context.Reference<{
  readonly name?: string;
  readonly positional?: readonly string[];
}>("protocol/Cli", { defaultValue: () => ({}) });

/** Every surface a contract can be served on. */
export const SurfaceName = Schema.Literals(["rpc", "mcp", "cli", "web"]);

export type SurfaceName = typeof SurfaceName.Type;

/** The surfaces it is served on; every one by default. */
export const Surfaces = Context.Reference<readonly SurfaceName[]>(
  "protocol/Surfaces",
  { defaultValue: () => SurfaceName.literals }
);
