import { API, legacyFetch } from "@burrow/kit";
import type { Transport } from "@burrow/kit";

/** A product as the catalog lists it. */
export interface Product {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
}

/** Reads the catalog. */
export interface CatalogClient {
  readonly category: (slug: string) => Promise<readonly Product[]>;
  readonly product: (id: string) => Promise<Product>;
}

const clientOver = (transport?: Transport): CatalogClient => ({
  category: async (slug) =>
    JSON.parse(
      await legacyFetch(
        `${API}/categories/${encodeURIComponent(slug)}`,
        transport
      )
    ),
  product: async (id) =>
    JSON.parse(
      await legacyFetch(`${API}/products/${encodeURIComponent(id)}`, transport)
    ),
});

// Made on first use.
let client: CatalogClient | undefined;

/** The catalog client, made on first use over the transport it was first given. */
export const catalog = (transport?: Transport): CatalogClient => {
  client ??= clientOver(transport);

  return client;
};
