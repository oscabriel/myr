/**
 * A person, by handle, linking to their page of credits. People appear by
 * handle and role only: nothing here ranks or scores them.
 */
import type { Handle } from "@repo/protocol/ids";

/** A person's page: `/people/<handle>` (a handle is URL-safe by its schema). */
export const personPath = (handle: Handle) => `/people/${handle}`;

export const HandleLink = ({ handle }: { readonly handle: Handle }) => (
  <a
    className="decoration-rule font-medium underline hover:decoration-current"
    href={personPath(handle)}
  >
    {handle}
  </a>
);
