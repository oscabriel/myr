import type { EnvProxy } from "@repo/checks/check-runner";
import type { EnvKey } from "@repo/protocol/ids";
import { Context } from "effect";
import type { Effect, Redacted } from "effect";

export const REGISTRIES = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "repo.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "index.crates.io",
  "static.crates.io",
  "proxy.golang.org",
  "sum.golang.org",
] as const;

/** `*.example.com` matches any host under it, not the apex itself. */
export const allows = (allow: readonly string[], hostname: string): boolean => {
  const host = hostname.toLowerCase();

  return allow.some((entry) =>
    entry.startsWith("*.")
      ? host.endsWith(entry.slice(1).toLowerCase())
      : host === entry.toLowerCase()
  );
};

/** Names nothing real, so the container learns no remote's host or token. */
export const CLONE_HOST = "repo.checker.internal";

export const cloneUrlOf = (remote: string): string =>
  `https://${CLONE_HOST}${new URL(remote).pathname}`;

export interface CloneRoute {
  readonly host: string;
  readonly remote: string;
  readonly token: Redacted.Redacted;
}

export interface EnvSwap {
  readonly key: EnvKey;
  readonly placeholder: string;
  readonly value: Redacted.Redacted;
}

/** `values` is filled only for a job of landed code. */
export interface EnvRoute {
  readonly hosts: readonly string[];
  readonly rules: readonly EnvProxy[];
  readonly values: readonly EnvSwap[];
}

export class Network extends Context.Service<
  Network,
  {
    readonly routeClone: (route: CloneRoute) => Effect.Effect<void>;
    /** Closes the clone route too. `[]` turns the network off. */
    readonly allow: (hosts: readonly string[]) => Effect.Effect<void>;
    readonly routeEnv: (route: EnvRoute) => Effect.Effect<void>;
  }
>()("sandbox/Network") {}
