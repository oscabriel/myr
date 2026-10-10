/**
 * A person, by handle, linking to their page of credits. People appear by
 * handle and role only: nothing here ranks or scores them.
 */
import type { Handle } from "@repo/protocol/ids";

import { personPath } from "./paths.ts";

export const HandleLink = ({ handle }: { readonly handle: Handle }) => (
  <a
    className="decoration-rule font-medium underline hover:decoration-current"
    href={personPath(handle)}
  >
    {handle}
  </a>
);
