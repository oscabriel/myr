import { Context, Schema } from "effect";

export const Description = Context.Reference<string>("protocol/Description", {
  defaultValue: () => "",
});

export const Audience = Context.Reference<"public" | "signedIn" | "decider">(
  "protocol/Audience",
  { defaultValue: () => "signedIn" }
);

export const Visibility = Context.Reference<"public" | "maintainers">(
  "protocol/Visibility",
  { defaultValue: () => "public" }
);

export const ReadOnly = Context.Reference<boolean>("protocol/ReadOnly", {
  defaultValue: () => false,
});

export const Idempotent = Context.Reference<boolean>("protocol/Idempotent", {
  defaultValue: () => false,
});

export const Destructive = Context.Reference<boolean>("protocol/Destructive", {
  defaultValue: () => false,
});

export const NeedsApproval = Context.Reference<boolean>(
  "protocol/NeedsApproval",
  { defaultValue: () => false }
);

/**
 * `formerFlags`: positionals that still parse as hidden flags of their own
 * name, so scripts that type them keep working for a release.
 */
export const Cli = Context.Reference<{
  readonly name?: string;
  readonly positional?: readonly string[];
  readonly formerFlags?: readonly string[];
}>("protocol/Cli", { defaultValue: () => ({}) });

export const SurfaceName = Schema.Literals(["rpc", "mcp", "cli", "web"]);

export type SurfaceName = typeof SurfaceName.Type;

export const Surfaces = Context.Reference<readonly SurfaceName[]>(
  "protocol/Surfaces",
  { defaultValue: () => SurfaceName.literals }
);
