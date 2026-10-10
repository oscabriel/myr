---
status: accepted
---

# An import keeps its source, and a repeat by the initializer converges

An imported project (ADR 0010) is a copy of a public repo, read-only here and not run by its maintainers, and its own page said nothing of where it came from: the import's URL and branch arrived in `initProject` and were dropped once the tip was adopted. The project's row now keeps them as `importedFrom`, the shape `initProject` takes (`ImportSource`), and `projectPolicy` names them beside the policy, so the project's page, the CLI's `policy` and MCP show "Imported from" from one read. A project that started empty has no such field.

The thirty-eight imports already on a stage were made before the field existed, and the platform has no operator-only write to a project. Rather than add one, `initProject` converges: asked again by the project's initializer with an `import`, for a row whose adoption landed in the call that made it (its adoption landing's `landedAt` is the row's `createdAt`, where a first push lands later), it writes the source if the row keeps none, or answers as the first call did if the row keeps the same one. Any other repeat, by someone else, with another source, or for a project that started empty, is `ProjectExists` as before. `import-examples --sources` runs that call once per import the ledger records on the stage, listed by the platform or not.

## Considered Options

- **An operator-only `setSource` contract.** A second write path to a project's record, with its own audience and surface, for a one-time backfill of forty rows. Converging the write that exists keeps principle 8 (re-running an operation converges) and adds nothing to the public contract.
- **Look the name up in the docs' imported list on the web.** No backend change, but it covers only the curated imports, not a project someone imports with `init --import`, and the page would state a source the platform never recorded.
- **Keep the source on `ProjectListing`.** The listing is the front-page projection's, built from events; a project's own record is the right home, and the listing has no row for an import adopted before adoptions were heard.

## Consequences

- `ProjectRow` gains an optional field, decoded on read; a row without it still decodes, so no migration.
- `import-examples` treats a project the ledger records as this stage's import as known, whether or not the platform lists it, so the seventeen unlisted imports are never taken for new ones.
- A first push that lands in the same instant as its project's creation would read as an import's row; two separate calls never share an instant on a real clock, and tests move the clock between them.
