import { legacyFetch } from "./legacy.ts";
import { API } from "./transport.ts";
import type { Transport } from "./transport.ts";

/** Whether the named service answers its health check. */
export const isHealthy = async (
  service: string,
  transport?: Transport
): Promise<boolean> => {
  try {
    await legacyFetch(`${API}/${service}/health`, transport);

    return true;
  } catch {
    return false;
  }
};
