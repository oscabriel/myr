---
status: accepted
---

# The visibility boundary is the repo boundary

Git cannot hide part of a repo: whoever can fetch a commit can fetch every object in its tree. So each audience's files form a layer that lives in its own repo, and the platform composes layers over `main` only where the reader may see them. One flow rule holds: no write down. Content reaches a wider audience only through a credited release, and nothing from a layer enters a public tree.

## Considered Options

- **Private branches or folders in one repo.** Git's object reachability would leak them to anyone who can clone.
- **Fully hidden project layers.** Every project layer is declared publicly instead. Only personal layers may be hidden, because invisible gates destroy contributors' trust.

## Consequences

- The platform lands the answer's tree, never the composed tree, and snapshots before held-back files are written.
- Public-serving Workers have no binding to the private namespace. A type test checks that the web Worker's generated env has no `ARTIFACTS_PRIVATE`.
- A push that would put a layer path into a public tree is refused as `PrivatePathInPublicTree`.
