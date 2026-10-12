---
status: accepted
---

# A stale answer names who moved each conflicting path

When an answer's merge onto main conflicts, `StaleBase` named the paths and nothing more, so whoever rebased had to dig through main's log to learn whose change they were resolving against. Now it carries `movedBy` as well, an optional field that is never empty. For each conflicting path the platform landed, it names the landing that last changed that path: its commit (`landing`), the person accountable for it (`author`), and the ask it answered or opened (`ask`, absent for a decider's own landing). The renderer puts each one after its path: `src/parse.ts (last changed by alice in bb5da9e, for parse-iso)`.

The merge step finds them (`packages/project/src/answer-runs/movers.ts`), after the Lander has said the merge conflicts:

- A three-way merge conflicts in a path only where main changed it since the answer's base. So the step walks main's first-parent line back from the main it merged onto, through `RepoHost` (the code reads' own tree lookups, shared as one view), and stops at the base or after `MOVER_SCAN` commits (50). For each path it takes the newest commit whose entry differs from its parent's.
- It asks the project's record for those commits' landings (`AnswerQueue.landings`, which the Workflow reaches through the project's Durable Object), and names a path only when its commit is a landing there. A trailer in a commit never reads as one, as on the code pages.
- The step reports the names in `MergeConflict`, and the landing lifecycle copies them onto the refusal, so the transition stays pure. A merge step recorded before this change has no `movedBy`, and still decodes.
- The walk never fails the merge: a repo it cannot read, or anything else that goes wrong, leaves `movedBy` out and logs why.

## Considered Options

- **The Lander reads `Ask:` trailers and the author line from `git log` in its container.** One `git log` where the clone already is. But there are three Lander adapters to teach it, its wire would grow, and the names would rest on trailers rather than the record.
- **The project's Durable Object walks the history in `advanceAnswer`.** It already holds the record, but the walk's reads would run under the project's one lock and stall every other call to the project.
- **Every landing since the base that changed each path.** More complete, but the list has no bound. The newest is the version on main that the rebase meets, and `myr why` gives each line's landing.

## Consequences

- A conflict now costs one first-parent log read of up to 51 commits, plus each conflicting path's entry at each commit since the base. A clean merge costs nothing more.
- Everything `movedBy` names is already public: the paths in `conflicts`, and the landings' commits, authors and asks on main. It reaches the verdict note on the answer's head, `myr status`, MCP and the web, which write it through the one renderer.
- The decider's `land` names movers the same way, through the same step.
