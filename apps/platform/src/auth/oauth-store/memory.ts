import { Layer, Schema } from "effect";

import { OAuthStore } from "../oauth-store.ts";
import type { OAuthStoreList } from "../oauth-store.ts";

const parseJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

// TTLs are not kept: a record lives until it is deleted.
const make = (): OAuthStore["Service"] => {
  const records = new Map<string, { metadata: unknown; value: string }>();

  return {
    delete: (key) => {
      records.delete(key);

      return Promise.resolve();
    },
    get: (key, options) => {
      const value = records.get(key)?.value;

      if (value === undefined) {
        return Promise.resolve(null);
      }

      return Promise.resolve(options === undefined ? value : parseJson(value));
    },
    list: (options) => {
      const keys = [...records.keys()]
        .filter((name) => name.startsWith(options?.prefix ?? ""))
        .toSorted()
        .map((name) => ({ metadata: records.get(name)?.metadata, name }));

      const listed: OAuthStoreList = { keys, list_complete: true };

      return Promise.resolve(listed);
    },
    put: (key, value, options) => {
      records.set(key, { metadata: options?.metadata, value });

      return Promise.resolve();
    },
  };
};

export const OAuthStoreMemory = {
  layer: Layer.sync(OAuthStore, make),
  make,
};
