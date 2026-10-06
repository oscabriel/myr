---
status: accepted
---

# Rules are read from the landed SHA stored in the Project DO; the ref is a mirror

The platform reads a project's rules only from the commit it last landed itself. That SHA lives in the Project Durable Object's row and is written in the same transaction as the landing record. The rules are the config folder, the judge closure and the env shape (ADR 0009). A landed ref in the repo mirrors the SHA for people and tools, and nothing reads it to make a decision. So neither an answer nor a stray push can change what judges it.

## Considered Options

- **Read rules from a landed ref pushed atomically with `main`.** This was the earlier design, and it made an atomic two-ref push a requirement of every landing. Artifacts' `readFile` accepts a commit ID as its `ref` ([Workers binding](https://developers.cloudflare.com/artifacts/api/workers-binding/)), so reading by SHA needs no second ref.
- **Read rules from the tip of `main`.** A push that reached `main` outside the gateway would then rewrite the rules that judge the next push.
