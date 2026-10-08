import { API, legacyFetch } from "@burrow/kit";
import type { Transport } from "@burrow/kit";

// Messages rendered since the process started, for the metrics endpoint.
let rendered = 0;

const SLOT = /\{\{(?<name>\w+)\}\}/gu;

/** Renders the named message template, filling each `{{slot}}` from `values`. */
export const render = async (
  template: string,
  values: ReadonlyMap<string, string>,
  transport?: Transport
): Promise<string> => {
  const text = await legacyFetch(
    `${API}/templates/${encodeURIComponent(template)}`,
    transport
  );

  rendered += 1;

  return text.replaceAll(
    SLOT,
    (slot: string, name: string) => values.get(name) ?? slot
  );
};

/** How many messages have been rendered. */
export const renderedCount = () => rendered;
