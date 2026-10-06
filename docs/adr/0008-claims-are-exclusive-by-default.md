---
status: accepted
---

# Claims are exclusive by default and kept alive by pushes

An ask takes one claim at a time. A claim is a fork plus a scoped token, and only pushes keep it alive: after 2 idle hours the claimant is warned, and after 24 the claim lapses (`ClaimLapsed`). A full ask returns `AskFull` before any fork is made. Racing is opt-in, for kinds where parallel attempts are the point, such as hill-climbing or design asks.

## Considered Options

- **Three claims per ask, shown as "2 of 3 taken".** Duplicate work wastes newcomers' effort, and asks open to racing get swarmed, as bounty markets do.

## Consequences

The front page shows an ask as either claimed or open.
