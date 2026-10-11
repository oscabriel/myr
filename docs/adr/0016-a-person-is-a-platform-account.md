---
status: accepted
---

# A person is a platform account, and nobody signs in with GitHub

A person is a handle in the platform's own accounts. They sign up and sign in with a handle and a password on the platform's own pages, and the platform is its own OAuth authorization server, for the CLI's login (PKCE) and for MCP clients. Google sign-in is an optional second way in, linked to a handle, and never the identity itself. There is no GitHub sign-in, no GitHub handle lookup and no GitHub key in any env. The product's point is to leave GitHub, so who a person is must not depend on it, and accounts that need no third party let every stage sign people in with nothing to register first.

## Considered Options

- **GitHub OAuth as the only sign-in.** This was the earlier plan. People would arrive with an account and a handle they already have, but every stage would need an OAuth app registered by hand, and identity on a platform built to replace GitHub would be GitHub's.
- **Named sessions alone:** a sensitive env value mapping bearer tokens to handles. It stays beside accounts, behind the same sessions port, for the operator and the demo's fictional people, who need several accountable identities without signing up one by one. It is not how real people join.
- **A portable identity behind the handle** (declined, October 2026). Two peer platforms point a handle at something no single host owns: one at a decentralised identifier held on a data server the person chooses, with a third-party client library and an OAuth flow to reach it; the other at a signing key per device, encoded as an identifier, with no account at all. Either would let a `Signed-off-by` trailer name an identity that outlives this platform. Declined for now: the first adds a dependency no `package.json` has and a sign-in redesign, and makes who a person is depend on a third party's account again, which this decision exists to avoid; the second is a key-management burden on every contributor before their first claim. If a second identity is ever added, it is a key the person holds, linked to their platform handle and verified by the platform, never an account at a third party. Re-adding either client needs the user's sign-off.

## Consequences

- Handles are the platform's own. Credit trailers, the vouch file (where a handle with no provider prefix is a platform handle) and fork names spell them, and two handles that differ only in case are one person.
- A password is HMAC'd with a pepper held as a Worker secret, then hashed with PBKDF2, so a copy of the accounts table alone is useless. `COOKIE_KEY` and `PASSWORD_PEPPER` are required on every stage, and changing the pepper makes every stored password fail.
- Agents have no identity of their own. An agent works through its person's token, and the harness it names is audit metadata that a landing discloses as `Assisted-by:`, never identity or credit.
- Importing a public repo from GitHub once, to start a project, is unaffected (ADR 0010).
- The web keeps the signed-in handle for display in a second `__Host-` cookie, HttpOnly, bound to the session token by its SHA-256 and set when the person signs in, so `/auth/whoami` answers with no platform call on each page. Signing out, or any `Unauthenticated` from the platform, clears both cookies. The handle only shapes what a page shows; every write still carries the token to the platform, which decides.
