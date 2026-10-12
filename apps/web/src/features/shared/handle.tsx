import type { Handle } from "@repo/protocol/ids";

import { AppLink } from "./link.tsx";
import { personPath } from "./paths.ts";

export const HandleLink = ({ handle }: { readonly handle: Handle }) => (
  <AppLink
    className="decoration-rule font-medium underline hover:decoration-current"
    to={personPath(handle)}
  >
    {handle}
  </AppLink>
);
