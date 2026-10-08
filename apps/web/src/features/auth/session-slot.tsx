/**
 * The header's session slot. A placeholder from issue 511: a link to sign
 * in. Issue 513 owns this file and replaces it with the signed-in handle and
 * sign-out, or this link.
 */
export const SessionSlot = () => (
  <a
    className="decoration-rule font-medium underline hover:decoration-current"
    href="/auth/signin"
  >
    Sign in
  </a>
);
