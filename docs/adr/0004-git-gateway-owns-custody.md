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

## Amended (2026-10-08)

What the gateway spike against live Artifacts (Oct 6–7) and the build since have shown:

- **A push lands whole or not at all.** Any refusal turns every ref in the push away. Custody judges twice: `admit` runs before forwarding, so a refused push never reaches storage, and `review` runs after storage took the push into the answerer's fork, which keeps the commit while git still shows the refusal.
- **Four headers are forwarded, and no credential.** The gateway passes only `accept`, `content-encoding`, `content-type` and `git-protocol` upstream; the upstream adapter adds the platform's own token.
- **Storage's rejections are translated by their text.** `stale ref` (Artifacts) and `incorrect old value provided` (git's receive-pack) become `StaleBase`, with `main` read from a fresh ref advertisement; `artifacts_git_receive_pack_busy` becomes `RepoBusy`, which is retryable. `fetch first` never reaches a server: git decides it on the client.
- **A direct push to a canonical `main` is `DirectPush`.** It is final, and its next step lists the asks. `StaleBase` read backwards there and `NoAsk` said nothing about why. The only direct push admitted is the initializer's first push to an empty project; after that, `main` moves only by a landing (ADR 0014).
- **Anonymous clones of public repos work** through the gateway, which holds the read token; Artifacts itself refuses anonymous reads.
- **Cost.** A push through the gateway took a median 0.355 s against 0.340 s direct (+4.6%, ten pushes each). Ten clones at once took +69% (2.0 s against 1.2 s wall time), most likely because each new isolate mints a token before its first upstream call; the two were not timed apart.
- **The fallback is not built.** There are no raw per-fork tokens and no `git-remote-<name>` helper. The push-event backstop is built: OnPush turns any move of a canonical `main` that the platform did not make into a `StrayPush` decision whose default is revert.
- Later stages of the gate answer after the push returns, not in its report-status (ADR 0015).
- **A fork takes branches only.** A claim fork or a working fork admits only `refs/heads/*`: custody refuses a push that creates, moves or deletes any other ref (a note, a tag, the platform's own refs) with `DirectPush`, whoever pushes, and the gate's parse stage agrees for a push the backstop sees. The platform's own fork writes, its verdict notes and the Lander's merge ref, reach storage directly and never pass custody.
