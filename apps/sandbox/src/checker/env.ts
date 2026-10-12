// Only HTTPS is intercepted: the outbound handler fetches with the scheme the
// container used, and varlock injects only over verified TLS.
import type { CheckJob, EnvProxy } from "@repo/checks/check-runner";
import { Array, Option, Result } from "effect";

import { CLONE_HOST } from "./network.ts";
import type { EnvRoute, EnvSwap } from "./network.ts";

export interface Skipped {
  readonly host: string;
  readonly reason: string;
}

export interface EnvPlan {
  readonly route: Option.Option<EnvRoute>;
  readonly skipped: readonly Skipped[];
}

const HTTPS = "https://";

/** The intercept table holds 64 hosts; the clone route and catch-all take two, a few stay spare. */
const MAX_PROXY_HOSTS = 60;

const TOO_MANY = `the container intercepts at most ${MAX_PROXY_HOSTS} proxy hosts beside the clone route and the catch-all`;

const interceptHost = (host: string): Result.Result<string, string> => {
  const written = host.trim().toLowerCase();

  if (written.startsWith("http://")) {
    return Result.fail(
      "HTTPS only: a placeholder is swapped only on HTTPS, so an http:// host is not intercepted"
    );
  }

  const bare = written.startsWith(HTTPS)
    ? written.slice(HTTPS.length).replace(/\/.*$/u, "")
    : written;

  if (bare.includes("://") || bare.includes("/") || bare === "") {
    return Result.fail("HTTPS only: not a host");
  }

  if (bare === "*") {
    return Result.fail("`*` would take every host from the egress gateway");
  }

  if (bare === CLONE_HOST) {
    return Result.fail("the clone route's host is the Checker's own");
  }

  return Result.succeed(bare);
};

const swapsOf = (
  job: CheckJob,
  rules: readonly EnvProxy[]
): readonly EnvSwap[] => {
  if (job.landed !== true) {
    return [];
  }

  const sent = rules.filter(({ block }) => !block);

  return (job.values ?? []).flatMap(({ key, value }) => {
    const rule = sent.find((each) => each.key === key);

    return rule === undefined
      ? []
      : [{ key, placeholder: rule.placeholder, value }];
  });
};

export const envPlanOf = (job: CheckJob): EnvPlan => {
  if (job.heldBack !== undefined) {
    return {
      route: Option.none(),
      skipped: job.proxies.map(({ host }) => ({
        host,
        reason: "a sealed suite runs with the network off",
      })),
    };
  }

  const [rules, skipped] = Array.partition(job.proxies, (rule) =>
    Result.match(interceptHost(rule.host), {
      onFailure: (reason): Result.Result<EnvProxy, Skipped> =>
        Result.fail({ host: rule.host, reason }),
      onSuccess: (host) => Result.succeed({ ...rule, host }),
    })
  );

  const all = Array.dedupe(rules.map(({ host }) => host));
  const hosts = all.slice(0, MAX_PROXY_HOSTS);
  const routed = rules.filter(({ host }) => hosts.includes(host));

  const crowded = all
    .slice(MAX_PROXY_HOSTS)
    .map((host): Skipped => ({ host, reason: TOO_MANY }));

  return {
    route:
      hosts.length > 0
        ? Option.some({
            hosts,
            rules: routed,
            values: swapsOf(job, routed),
          })
        : Option.none(),
    skipped: [...skipped, ...crowded],
  };
};
