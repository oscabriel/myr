---
status: accepted
---

# No inbound or two-way GitHub sync

A project can be imported from GitHub once, to start it. After that, nothing flows in from GitHub, and nothing syncs both ways. Inbound sync would be a second way onto `main` that skips the gate.

## Consequences

- Export is `git clone`. Code, asks and credit trailers leave with a clone, and verdicts need one more fetch of `refs/notes/*`. The README says so.
- An import can also be made from the web, at `/import`, and is still made once ([ADR 0033](0033-a-repo-is-imported-from-the-web-and-its-host-path-offers-the-import.md)).
- A one-way push mirror of `main` to GitHub is on the roadmap for after the competition, not in it.
