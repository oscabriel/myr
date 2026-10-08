import { API, legacyFetch } from "@burrow/kit";
import type { Transport } from "@burrow/kit";

// US cents per unit of each currency, fetched on first use and kept.
let rates: ReadonlyMap<string, number> | undefined;

const ratesFrom = async (transport?: Transport) => {
  rates ??= new Map(
    Object.entries(JSON.parse(await legacyFetch(`${API}/rates`, transport)))
  );

  return rates;
};

/** An amount in `currency`, in US cents, rounded to the cent. */
export const toUsdCents = async (
  amount: number,
  currency: string,
  transport?: Transport
): Promise<number> => {
  const table = await ratesFrom(transport);
  const rate = table.get(currency);

  if (rate === undefined) {
    throw new Error(`no rate for ${currency}`);
  }

  return Math.round(amount * rate);
};
