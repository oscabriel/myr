---
status: accepted
---

# Provenance: copy with attribution

Code from other projects enters as ports: it is copied with attribution into our own files, and from then on it is ours to change. The repo has its own history from the first commit. It is not a fork, a template or a vendor commit of another project, and it holds no third-party prose or artwork. `PROVENANCE.md`, `LICENSES/` and `UPSTREAM.md` record every port: its source, commit, licence and our changes. Upstream `main` is never synced in. The competition's [Official Rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf) (§4) require "Entrant's own original content and creation" with no "third-party copyrighted material or artwork without the copyright holder's permission", and originality is half the score (§6). So credited plumbing is fine, and the centre of the product must be ours.

## Considered Options

- **Fork or template Rat Stack.** A fork carries several hundred commits of someone else's history. A template marks the repo "generated from" its source and brings about 85k lines.
- **A 25% derived and 15% near-verbatim ceiling.** That was sized for adopting a whole stack, not for grafting plumbing.

## Consequences

- Derived lines stay under 15% of the codebase and near-verbatim lines under 10%, with a target of about 5%. `scripts/provenance.ts` measures both.
- Planned ports:
  - from [Rat Stack](https://github.com/joelhooks/rat-stack) at `fba26d8` (MIT): the CLI and MCP projections (ADR 0003), `no-module-level-mutable-state`, the debt ledger, and `vendor-agent-sources.sh`;
  - from t3code (MIT), via Rat Stack: `no-manual-effect-runtime-in-tests`;
  - from [anti-slop](https://github.com/dmmulroy/anti-slop) at `c44ef22` (MIT): its oxlint plugins, installed by its own vendoring script.
- Ideas taken without code, such as cf's merged command catalog, are credited in `PROVENANCE.md` as ideas.
- Credits live in the README and `PROVENANCE.md`, not on screen in the demo.
