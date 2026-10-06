---
status: accepted
---

# A git gateway owns custody, and refusals arrive in git's own output

Every git request goes through a gateway Worker that proxies git's smart HTTP protocol to Cloudflare Artifacts and holds every Artifacts token. Before it forwards a push, it reads the ref update commands and can refuse them with git's own `ng <ref> <reason>` lines, so a refusal shows up in the pusher's `git push` output with nothing installed. Holding custody in one place also gives us protected refs, claim-scoped tokens, anonymous public clones, push detection at the moment of the push, and reads limited by visibility (ADR 0007).

## Considered Options

- **Flag stray pushes afterwards and revert them.** This was the earlier design. It stays as a backstop: an Artifacts events trigger starts a Workflow for any push that reaches storage without passing the gateway.
- **A client-side `git-remote-<name>` helper that rewrites push results.** It needs an install on every machine and is not authoritative, since a plain `git push` skips it. It is deferred, and it returns only if the gateway cannot be built.

## Consequences

- For an answer, the gateway forwards the push to the answerer's own fork, then rewrites git's report-status with the verdict of the cheap stages of the gate (ADR 0006).
- A git credential helper ships so that tokens stay out of remote URLs.
- If the gateway cannot be built, the fallback is raw per-fork tokens plus the push-event backstop, and the `git-remote-<name>` helper returns to put refusals in push output.
