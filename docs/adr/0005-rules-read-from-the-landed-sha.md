---
status: accepted
---

# Rules are read from the landed SHA stored in the Project DO; the ref is a mirror

The platform reads a project's rules only from the commit it last landed itself. That SHA lives in the Project Durable Object's row and is written in the same transaction as the landing record. The rules are the config folder, the judge closure and the env shape (ADR 0009). A landed ref in the repo mirrors the SHA for people and tools, and nothing reads it to make a decision. So neither an answer nor a stray push can change what judges it.

## Considered Options

- **Read rules from a landed ref pushed atomically with `main`.** This was the earlier design, and it made an atomic two-ref push a requirement of every landing. Artifacts' `readFile` accepts a commit ID as its `ref` ([Workers binding](https://developers.cloudflare.com/artifacts/api/workers-binding/)), so reading by SHA needs no second ref.
- **Read rules from the tip of `main`.** A push that reached `main` outside the gateway would then rewrite the rules that judge the next push.

## Amended (2026-10-08)

The first spike against live Artifacts (Oct 6) settled the question this ADR turned on: Artifacts has no atomic multi-ref push. `git push --atomic` is refused ("the receiving end does not support --atomic push"), and its receive-pack advertises no `atomic` capability. So the landed SHA in the Project DO is the only truth. A landing pushes `main` alone, then the mirror ref and the verdict note each follow in a push of their own (ADR 0014), and either may trail `main` for a moment. Artifacts' Workers binding also resolves only short branch names and commit SHAs, never a custom ref, so the DO keeps the SHAs of the refs it writes.
