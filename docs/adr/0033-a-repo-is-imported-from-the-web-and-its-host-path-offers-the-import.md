---
status: accepted
---

# A repo is imported from the web, and its host path offers the import

An import (ADR 0010, ADR 0031) could be made only from the CLI, `init --project <p> --import <url>`, by someone signed in there. The platform's point is that any public repo can be brought over and worked on through the gate, and that path asked a newcomer to install a CLI first.

`/import` is a page for a signed-in reader. It takes a public HTTPS clone URL, an optional branch, the owner (a choice among the namespaces the reader may write to: their own handle, and the URL's source namespace when its host is on the list, which is then the default) and the name, prefilled from the URL's last segment. It calls the one existing contract, `initProject` with `import`, which gains the web as a surface; the platform clones any public git URL through Artifacts, so no host's API is called. A refused import reads as its refusal, with its next step.

A **host path**, `/<host>/<account>/<repo>` on the web (a trailing `.git` is stripped), is a project's address when one exists at that name (ADR 0032). When none does, the page offers the import: the same form, prefilled with the URL rebuilt from the address and the owner fixed to the source namespace; signed out, it shows the sign-in link. It never imports on a GET: a crawler following `/github.com/x/y` makes nothing. A project someone imported under their own handle is not found from its host path: there is no index by source, and the address at the source namespace stays free for a copy at its source path.

## Considered Options

- **Import on arrival at the host path.** The address the user asked for, `myr.technology/github.com/<owner>/<repo>`, would then "just work", but any link, prefetch or crawler would create projects, and a project needs a person who answers for it. The offer keeps the person's press.
- **Connect GitHub and pick from a list** (the bulk import GitHub and GitLab offer). It needs OAuth scopes and a host's API per host; the clone URL covers every host at once, codeberg's included. Out until someone asks for it.
- **A mirror that keeps following the source.** Declined again (ADR 0010): inbound sync is a second way onto `main` that skips the gate.
- **Find a project by `importedFrom` from its host path.** It would show a handle-owned copy at `/github.com/x/y`, but then two readers would reach different projects through one address depending on who imported first, and the index is a projection the platform does not keep.

## Consequences

- `servedOn.initProject` includes the web; the contract's payload is unchanged.
- A new refusal, `NotYourNamespace` (ADR 0032), can come back to the page.
- An import still brings no tags (ADR 0019); the operator's backfill stands.
- The import page is its own chunk, so the root's preloads do not grow.
