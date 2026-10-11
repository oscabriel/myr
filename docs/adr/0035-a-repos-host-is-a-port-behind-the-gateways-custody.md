---
status: proposed
---

# A repo's host is a port behind the gateway's custody

One peer platform read in October 2026 splits hosting from viewing: a repository lives on a host chosen when it is made, a web view reads the whole network, and a second, read-only view of the same records exists, which proves the view is replaceable. Myr already has that shape without having said so: every repo is reached through `RepoHost`, one port with one contract every adapter passes (`packages/artifacts/test/repo-host-contract.ts`, Principle 6), and the gateway (ADR 0004) holds every credential, enforces custody and visibility, and refuses in git's own output.

The decision: the gateway's custody is all a host must honour. A host is whatever passes the `RepoHost` contract and takes its writes only from the gateway and the platform's own landings (ADR 0014); it holds no rule, no credential of its own that a client can reach, and no second way onto `main`. Adding a host (a second storage product, a self-hosted git server, a machine of the project's own) is one adapter in the owning package, not a rewrite of the platform, and the web, the CLI and MCP keep reading through the same contracts whichever host answers. Nothing is built for this now; the ADR exists so that nobody designs a second host as a second gateway.

## Considered Options

- **A host per project, chosen at creation, as the peer does.** The seam is the same; the choice is deferred until a second adapter exists, since a choice among one is noise in the init form.
- **Let a host enforce its own rules** (membership on the host, as the peer's host does). It would be a second rule engine beside the typed config folder on main, with the rules in a place a clone cannot read.

## Consequences

- A second host adapter must pass `repo-host-contract.ts` unchanged and must refuse any write that does not come through the gateway; a test for the second point joins the contract when the first such adapter lands.
- The visibility boundary stays the repo boundary (ADR 0007): a layer is a repo on a host, and a host sees nothing of what a layer means.
- Not built in the competition window; no dependency is added.
