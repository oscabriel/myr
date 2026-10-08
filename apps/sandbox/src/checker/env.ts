/**
 * A check job's env part, as the Checker applies it (W6; VL §8.4–8.5): which
 * `@proxy` hosts go to the env gateway, with which rules, and which values
 * the gateway may swap in. Pure: the Checker opens the route once egress is
 * off (`run.ts`), and the Durable Object reserves its hosts before the
 * catch-all intercept (`sdk.ts`).
 *
 * Only HTTPS is intercepted: Cloudflare adds a credential only to HTTPS
 * requests, since the outbound handler fetches with the scheme the container
 * used, and varlock injects only over verified TLS. A rule's host that is
 * not one is left out, with its reason.
 */
import type { CheckJob, EnvProxy } from "@repo/checks/check-runner";
import { Array, Option, Result } from "effect";

import { CLONE_HOST } from "./network.ts";
import type { EnvRoute, EnvSwap } from "./network.ts";

/** A rule's host the Checker does not intercept, and why. */
export interface Skipped {
  readonly host: string;
  readonly reason: string;
}

/** The job's env route, if it has one, and every host it leaves out. */
export interface EnvPlan {
  readonly route: Option.Option<EnvRoute>;
  readonly skipped: readonly Skipped[];
}

const HTTPS = "https://";

/**
 * The host the container's HTTPS intercept takes for a rule's `host`, as
 * the schema writes it: a bare host or glob (`sentry.io`, `*.example.com`,
 * `api.example.com:8443`), or one with `https://` before it, which is
 * dropped. Any other scheme, `*` (the catch-all, which the egress gateway
 * holds), and the clone route's host are none.
 */
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

/**
 * The values a landed job's gateway may swap in: each one whose key a rule
 * that is not `block` names, with that rule's placeholder, the one the
 * gateway swaps out of a request and scrubs back into a response. None in
 * any other job.
 */
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

/**
 * The job's env route: its rules whose host is intercepted, each with the
 * host the intercept takes; the hosts, each once; and the values a landed
 * job's gateway may swap in. None when no host is left, or when the job has
 * a sealed suite: sealed checks run with the network off (605, D17), and a
 * run with sealed files beside it has no landed value to swap anyway.
 */
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

  const hosts = Array.dedupe(rules.map(({ host }) => host));

  return {
    route:
      hosts.length > 0
        ? Option.some({ hosts, rules, values: swapsOf(job, rules) })
        : Option.none(),
    skipped,
  };
};
