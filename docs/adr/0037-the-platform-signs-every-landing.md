---
status: accepted
---

# The platform signs every landing

A landing is the platform's commit (ADR 0014), and "main moves only by a landing" is the product's first promise, but a clone cannot check it: the commits on `main` look like anyone's. One peer platform read in October 2026 signs the whole of a node's references each time they change, so anyone with a clone can verify every later update of the repository without the host. Myr needs less than that: one key, one kind of commit.

The decision: the platform signs each landing commit with one key held in the decoded env (`LANDING_SIGNING_KEY`, decoded once in the platform's env Layer, Principle 2), and publishes the public key at `/.well-known/` on the platform. `git log --show-signature` in a clone then proves offline that every commit on `main` is the platform's, and a commit on `main` without that signature is, by that fact, one the gate never saw. The web's Provenance block gains one entry, "Signature", naming the key. Nothing a contributor pushes is signed by the platform, and the platform never signs a fork's commits.

## Considered Options

- **Sign every ref, as the peer does.** It needs a signing identity per node and a protocol between nodes; Myr has one writer of `main` and one claim per fork.
- **Ask contributors to sign their commits.** It would add a key to every first claim, and it proves authorship, not that the gate ran. Author signatures can be kept when present, apart from this.
- **Keep the proof on the platform** (a verdict note per landing, which exists). It is a fetch away and the platform must be reachable to serve it; a signature is in the commit and needs nobody.

## Consequences

- A signing library the repo does not have (Ed25519 or OpenPGP signatures over git's commit buffer, verifiable by stock git) is a new dependency, and so needs the user's sign-off before any of this is built.
- `LANDING_SIGNING_KEY` joins `apps/platform`'s `.env.schema` as a sensitive value the user sets; a stage with no key refuses to start, as a bad env does today.
- A test holds that an unsigned push to `main` is still refused at the gateway (the signature proves a landing; it never admits one), and that the Lander's commit buffer verifies against the published key.
- Not built in the competition window.
