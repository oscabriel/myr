/**
 * The outbound map: what the Checker intercepts for each `@proxy`
 * item (the Checker hands each host to `interceptOutboundHttps`). A rule names a
 * host, the path and method a request must match, whether every request
 * is denied, the placeholder the process sees, and the item whose value
 * replaces it on the way out. Only `@sensitive` items hold values, so
 * `@proxy` on any other item maps to nothing.
 */
import type { EnvItem, EnvSchemaView } from "@repo/protocol/domain/env";
import type { EnvKey } from "@repo/protocol/ids";
import { Option, String } from "effect";

/** One host whose requests the platform intercepts for one item. */
export interface ProxyRule {
  /** Every request to the host is denied (`@proxy(block=true)`). */
  readonly block: boolean;
  /** A host as the schema writes it; a glob (`*.example.com`) stays one. */
  readonly host: string;
  /** The item whose value replaces the placeholder. */
  readonly key: EnvKey;
  /** The one method allowed; none allows any. */
  readonly method: Option.Option<string>;
  /** The path pattern allowed (`/api/**`); none allows any. */
  readonly path: Option.Option<string>;
  /** What the process sees in place of the value. */
  readonly placeholder: string;
}

/**
 * What unlanded code sees in place of an item's value: the item's own
 * `@placeholder`, or one made from its key alone (`__SENTRY_AUTH_TOKEN_PLACEHOLDER__`),
 * the same on every run and plainly not a real value. An empty
 * `@placeholder` counts as none, as in varlock's proxy: the gateway swaps
 * the placeholder for the value, and an empty one marks no place to swap.
 */
export const placeholderFor = (item: EnvItem): string =>
  Option.fromUndefinedOr(item.placeholder).pipe(
    Option.filter(String.isNonEmpty),
    Option.getOrElse(() => `__${item.key}_PLACEHOLDER__`)
  );

/** The rules for every `@sensitive` item's `@proxy`, one per domain, in the schema's order. */
export const proxyMap = (
  schema: Pick<EnvSchemaView, "items">
): readonly ProxyRule[] =>
  schema.items.flatMap((item) => {
    const { key, proxy, sensitive } = item;

    if (!sensitive || proxy === undefined) {
      return [];
    }

    const placeholder = placeholderFor(item);

    return proxy.domains.map((host) => ({
      block: proxy.block ?? false,
      host,
      key,
      method: Option.fromUndefinedOr(proxy.method),
      path: Option.fromUndefinedOr(proxy.path),
      placeholder,
    }));
  });
