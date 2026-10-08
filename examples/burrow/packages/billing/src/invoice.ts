import { API, legacyFetch } from "@burrow/kit";
import type { Transport } from "@burrow/kit";

/** One line of an invoice. */
export interface InvoiceLine {
  readonly cents: number;
  readonly item: string;
}

/** An invoice's lines, as billing stored them. */
export const invoiceLines = async (
  invoice: string,
  transport?: Transport
): Promise<readonly InvoiceLine[]> =>
  JSON.parse(
    await legacyFetch(
      `${API}/invoices/${encodeURIComponent(invoice)}`,
      transport
    )
  );

/** An invoice's total, in cents. */
export const invoiceTotal = (lines: readonly InvoiceLine[]) =>
  lines.reduce((sum, line) => sum + line.cents, 0);
