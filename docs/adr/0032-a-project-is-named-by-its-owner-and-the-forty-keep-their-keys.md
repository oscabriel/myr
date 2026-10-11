---
status: accepted
---

# A project is named by its owner, and the forty keep their keys

A project's name was one lowercase word, `datekit`, and that word was its address on the web (`/datekit`), at the gateway (`datekit.git`), in every contract's `project` field, and inside the platform: the Durable Object's id, the Artifacts repo's name, the code cache's key and every projection row. One flat namespace cannot hold two people's `notes`, says nothing about who a project belongs to, and gives an imported repo an address that hides where it came from.

A project's name is now `<owner>/<name>`. An **owner** is a person's handle, lowercased (`oscabriel/datekit`), or a **source namespace**, the host and account a repo was imported from, from a fixed list of hosts (`github.com/pallets/click`, `codeberg.org/dnkl/fuzzel`). A name is a person or a source namespace, never both: handles hold no dot and hosts always do. Organisations will be a second kind of owner in the same place. The web serves a project at `/<owner>/<name>`, the gateway at `<platform>/<owner>/<name>.git` (a claim fork at `…/<name>--<ask>--<handle>.git`), the CLI's `--project` takes the full name, and every contract's `project` field carries it. `ProjectName` keeps its identifier and means the full name; `Owner` and `ShortName` are its parts; one parser in `packages/protocol/src/ids.ts` reads it and lowercases on the way in, and `packages/protocol/test/project-name.test.ts` holds it.

Inside the platform a project keeps a flat **key**: the Durable Object's id, the repo's name, the code cache's key and the projection columns. The key is a pure function of the name: the name with `/` replaced by `_` (`oscabriel_foo`, `github.com_pallets_click`), which no handle, host, account or short name contains, so it reverses. The forty projects made before this decision keep the keys they have (`datekit`, `click`): `packages/protocol/src/legacy.ts` lists each with its name, `keyOf` and `nameOfKey` consult it first, and `ProjectName`'s decode accepts a bare legacy key and gives its name. So a stored event, a projection row, a Durable Object's own id, an old clone's remote, `--project datekit` and MCP's `project: "datekit"` all read as `oscabriel/datekit`, and nothing stored is migrated. The web answers `/<legacy>` and every address under it with a 301 to the full name; the gateway serves `<legacy>.git` and its forks as aliases, with no redirect, since git follows one only on its first request. The table is a cartridge: re-key the forty and delete it.

Owning a namespace gives one right: to make projects in it. `initProject` refuses `NotYourNamespace` when the name's owner is neither the caller's handle nor the source namespace of the import's URL. Nothing else moves: deciders stay per path from the config folder, an import's importer stays its fallback decider, and `setEnv`, policy edits and custody are as they were. A namespace is not a policy right.

## Considered Options

- **Rename the Durable Objects and repos to the new keys.** A clean store, but a Durable Object cannot be renamed and an Artifacts repo cannot be moved: each of the forty would be copied, with its events and its storage, on two stages, days before the demo is recorded. The alias costs a table of forty lines.
- **A registry table (D1, or one Durable Object per owner) mapping each name to a key.** It would also serve uniqueness and a person's project list, but it is a second source of truth, consulted on every call, for a mapping that is pure for every project but forty. Uniqueness is the key's: two names never share one.
- **Keep flat names and add the owner as a field.** No address changes, but `/notes` still belongs to whoever took it first, and the user asked for `/owner/repo`.
- **Every import under the importer's handle** (Gitea's model). Honest about who brought it, but the address then hides the source, two people's imports of one repo get two addresses, and the host-path address (ADR 0033) would need a lookup by source. The source namespace is the address and the provenance at once; a person may still import under their own handle.
- **Give the owner policy rights** (decide everywhere, set env). Simpler to explain, but the platform's rights are per path in the config folder on `main`, where every reader can see them; a namespace right would be a second, invisible kind.

## Consequences

- `ProjectName`'s grammar widens; the short name allows `.` and `_` with single separators (`commander.js`), so an import keeps its own name. The first segment may not be a word the web serves its own pages at, and sign-up refuses those words as handles.
- `repoKind`, fork names, layer repos and the well-known skill's URL carry the key, so the forty's URLs there are unchanged.
- A projection row whose key decodes to no name (a torn-down throwaway) is skipped by the lists.
- The demo's recorded addresses and commands stay true through the alias.
