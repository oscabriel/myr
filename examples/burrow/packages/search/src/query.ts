import { API, legacyFetch } from "@burrow/kit";
import type { Transport } from "@burrow/kit";

/** A search result: what matched, and how well. */
export interface Hit {
  readonly id: string;
  readonly score: number;
}

// The query run last, for "search again".
let lastQuery = "";

/** Searches the index; the best hit comes first. */
export const search = async (
  query: string,
  transport?: Transport
): Promise<readonly Hit[]> => {
  lastQuery = query;

  const hits: readonly Hit[] = JSON.parse(
    await legacyFetch(`${API}/search?q=${encodeURIComponent(query)}`, transport)
  );

  return hits.toSorted((one, other) => other.score - one.score);
};

/** Runs the last query again. */
export const searchAgain = (transport?: Transport) =>
  search(lastQuery, transport);
