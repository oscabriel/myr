/**
 * The Checker's network: which hosts its container may reach, and the one
 * route its clone takes. The container starts with the internet off, so a
 * request leaves it only through an outbound entrypoint of this Worker
 * (`outbound.ts`): the clone route adds the job's read token on the Worker's
 * side and closes once setup starts, and every other host is refused unless
 * the current allow-list names it. Adapters: `checker/sdk.ts` over the container's outbound intercepts;
 * tests record the calls (`test/fake-box.ts`).
 */
import type { EnvProxy } from "@repo/checks/check-runner";
import type { EnvKey } from "@repo/protocol/ids";
import { Context } from "effect";
import type { Effect, Redacted } from "effect";

/**
 * The hosts setup may reach on every project, beyond the run block's
 * `setupEgress`: the public package registries and nothing else. The checks
 * themselves reach none of them.
 */
export const REGISTRIES = [
  // npm's registry: npm, pnpm and Bun install from it by default, and
  // corepack downloads pnpm from it.
  "registry.npmjs.org",
  // Yarn 1's registry, a mirror of npm's that `yarn install` uses.
  "registry.yarnpkg.com",
  // Yarn 2+'s home: corepack downloads Yarn itself from it.
  "repo.yarnpkg.com",
  // PyPI's index (the simple API pip and uv read).
  "pypi.org",
  // PyPI's package files, which the index links to.
  "files.pythonhosted.org",
  // crates.io's API, which redirects a crate download to the static host.
  "crates.io",
  // crates.io's sparse index, which cargo reads by default.
  "index.crates.io",
  // crates.io's crate files.
  "static.crates.io",
  // The Go module proxy, where `go mod download` fetches modules.
  "proxy.golang.org",
  // The Go checksum database, which verifies what the proxy served.
  "sum.golang.org",
] as const;

/**
 * Whether `allow` lets a request to `hostname` out: an exact name, or a
 * `*.example.com` entry for any host under it (not the apex itself).
 */
export const allows = (allow: readonly string[], hostname: string): boolean => {
  const host = hostname.toLowerCase();

  return allow.some((entry) =>
    entry.startsWith("*.")
      ? host.endsWith(entry.slice(1).toLowerCase())
      : host === entry.toLowerCase()
  );
};

/**
 * The host the container clones from. It names nothing real: the container
 * reaches it only because the clone route intercepts it, so the container
 * learns no remote's host and holds no token for one.
 */
export const CLONE_HOST = "repo.checker.internal";

/**
 * The URL the container clones `remote` from: the clone host, with the
 * remote's path and nothing else (no user, no token, no query).
 */
export const cloneUrlOf = (remote: string): string =>
  `https://${CLONE_HOST}${new URL(remote).pathname}`;

/**
 * Where the container's clone goes: requests to `host` reach the clone
 * gateway, which sends them on to `remote` with `token` added. The container
 * sees `host` and never the token.
 */
export interface CloneRoute {
  readonly host: string;
  readonly remote: string;
  readonly token: Redacted.Redacted;
}

/** A value the env gateway may swap in, with the placeholder it stands for. */
export interface EnvSwap {
  readonly key: EnvKey;
  readonly placeholder: string;
  readonly value: Redacted.Redacted;
}

/**
 * Where a job's `@proxy` hosts go (W6; VL §8.5): each of `hosts` to the env
 * gateway, which lets out only the requests `rules` allow and swaps a
 * placeholder for its value only when `values` holds it, which only a job of
 * landed code fills. Every host is HTTPS and named once.
 */
export interface EnvRoute {
  readonly hosts: readonly string[];
  readonly rules: readonly EnvProxy[];
  readonly values: readonly EnvSwap[];
}

export class Network extends Context.Service<
  Network,
  {
    /**
     * Routes the clone's host to the clone gateway for this job's remote,
     * until the first `allow`.
     */
    readonly routeClone: (route: CloneRoute) => Effect.Effect<void>;
    /**
     * Lets out requests to `hosts` and refuses every other, the clone host
     * included: the clone is done before setup starts, so its route closes
     * here. `[]` turns the network off.
     */
    readonly allow: (hosts: readonly string[]) => Effect.Effect<void>;
    /**
     * Routes each of `route.hosts` to the env gateway for the rest of the
     * job, in place of the egress gateway; every other host stays as
     * `allow` left it.
     */
    readonly routeEnv: (route: EnvRoute) => Effect.Effect<void>;
  }
>()("sandbox/Network") {}
