---
status: accepted
---

# Claims are exclusive by default and kept alive by pushes

An ask takes one claim at a time. A claim is a fork plus a scoped token, and only pushes keep it alive: after 2 idle hours the claimant is warned, and after 24 the claim lapses (`ClaimLapsed`). A full ask returns `AskFull` before any fork is made. Racing is opt-in, for kinds where parallel attempts are the point, such as hill-climbing or design asks.

## Considered Options

- **Three claims per ask, shown as "2 of 3 taken".** Duplicate work wastes newcomers' effort, and asks open to racing get swarmed, as bounty markets do.

## Consequences

The front page shows an ask as either claimed or open.

## Amended (2026-10-08)

- **Fork names carry their parts.** A claim's fork is `<project>--<ask>--<handle>` and a person's working fork `<project>--me--<handle>`, the handle in lowercase; a layer's repo is `<project>--<layer>`. A project name, an ask id and a layer's name are each lowercase words joined by single hyphens, so none can hold `--`, and a claim fork's, a working fork's or a layer repo's name splits back into its parts. `me` and `layer` are reserved ask ids, as are `open` and `flag`, which the CLI's `ask` subcommands take.
- **Making a claim's fork is safe to retry, and converges on one repo.** Ten claims at once against live Artifacts (Oct 7) were all ready within 9.9 s, so no pool of pre-made forks is needed. Under that load 4 of 10 fork calls first answered HTTP 500, then 409 "repo already exists" when retried under the same name, and each still ended as exactly one repo. So a 500 is read as "maybe made" and tried once more, and an already-exists on the claim's own name counts as made once that repo holds `main`. The name comes from the claim, so claiming again finds the same fork.
