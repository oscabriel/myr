// Only `@sensitive` items hold values, so `@proxy` on any other item maps to nothing.
import type { EnvItem, EnvSchemaView } from "@repo/protocol/domain/env";
import type { EnvKey } from "@repo/protocol/ids";
import { Option, String } from "effect";

export interface ProxyRule {
  readonly block: boolean;
  readonly host: string;
  readonly key: EnvKey;
  readonly method: Option.Option<string>;
  readonly path: Option.Option<string>;
  readonly placeholder: string;
}

/**
 * An empty `@placeholder` counts as none, as in varlock's proxy: the gateway
 * swaps the placeholder for the value, and an empty one marks no place to swap.
 */
export const placeholderFor = (item: EnvItem): string =>
  Option.fromUndefinedOr(item.placeholder).pipe(
    Option.filter(String.isNonEmpty),
    Option.getOrElse(() => `__${item.key}_PLACEHOLDER__`)
  );

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
