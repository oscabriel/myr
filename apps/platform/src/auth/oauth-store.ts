/**
 * Where the OAuth provider keeps clients, grants and tokens: `OAUTH_KV` on
 * Cloudflare, `/memory` in tests. The shape is only the calls the provider
 * makes (1.2.1: `get` as text or JSON, `put` with a TTL and metadata,
 * `delete`, `list` by prefix), so a `KVNamespace` is one as it is. Tokens,
 * codes and secrets are stored there only as hashes, and props encrypted.
 */
import { Context } from "effect";
import type { Schema } from "effect";

/** One page of keys under a prefix, as KV lists them. */
export interface OAuthStoreList {
  readonly cursor?: string;
  readonly keys: readonly {
    readonly metadata?: unknown;
    readonly name: string;
  }[];
  readonly list_complete: boolean;
}

export class OAuthStore extends Context.Service<
  OAuthStore,
  {
    readonly delete: (key: string) => Promise<void>;
    readonly get: (
      key: string,
      options?: { readonly type: "json" }
    ) => Promise<Schema.Json>;
    readonly list: (options?: {
      readonly cursor?: string;
      readonly limit?: number;
      readonly prefix?: string;
    }) => Promise<OAuthStoreList>;
    readonly put: (
      key: string,
      value: string,
      options?: {
        readonly expiration?: number;
        readonly expirationTtl?: number;
        readonly metadata?: unknown;
      }
    ) => Promise<void>;
  }
>()("platform/OAuthStore") {}
