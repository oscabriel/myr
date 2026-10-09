---
status: accepted
---

# The web reads a project's code through public contracts the platform serves

The web's code browser (tree, file, raw bytes, log, commit, refs, and why each line is there) reads only through public, read-only contracts on `/rpc`. The platform Worker serves them over its existing `RepoHost` on the public Artifacts namespace. The logic lives in one host-free module, `@repo/project/code`, which the platform's handlers and the web's offline dev world both call. No payload names a repo. Each names a project, and the module reads that project's canonical repo only, never a fork or a layer. A revision is `main` (the project's landed SHA, from its record and never from a ref), a full commit SHA in the canonical repo, or a tag name matched exactly against the port's tag list, never joined into a ref path. Every answer names the commit it resolved, so any page becomes a permalink.

## Considered Options

- **An Artifacts binding on the web Worker.** It would save a hop, but the web would then hold storage. Today it holds a service binding and public vars only, and a type test keeps it that way. A second Worker reading repos would also put a second place in front of the visibility rule.
- **Highlighting on the server.** A cold highlight costs about 800 ms and some 730 bytes a line, and the grammars would add about 11 MB to the Worker. Pierre draws code in the browser instead, and the server sends a plain fallback: a table for a folder, and numbered lines with `#L<n>` anchors for a file.
- **Browsing forks.** Forks would need their own auth paths, and a layer repo must never be nameable. Claim forks are listed and link to their answer's page instead.

## Consequences

- Raw bytes (`GET /<project>/raw/<rev>/<path>`) carry `x-content-type-options: nosniff` and a sandboxing CSP (`default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox`) on every answer, refusals included. HTML and XML are served as plain text, and SVG as an image, which the sandbox keeps from running script. A read by commit SHA is cached as immutable. The web passes the route on untouched.
- Reads addressed by object id (trees, blobs, commits, a commit's changes, a file's why) are cached per isolate, keyed by the object's id. Only finished reads are kept, never one still under way, because Workers cancels a request whose client left without interrupting its fibers. `main` is resolved on every call.
- A README renders as GitHub-flavoured Markdown in one fixed plugin order, its relative links and images pointing into the repo at the SHA, then sanitized with GitHub's allow-list. The order is the security property, so it lives in one tested module.
- Why each line is there is a first-parent blame from the revision, up to 200 commits. A line whose commit is a platform landing names its ask, answer, people and verdict from the project's own record, so a trailer forged on an imported commit never reads as a landing.
- An ask's opening is a landing that answers no ask, so its landing names the ask it opened (`opened`, a migrate family's parent) and never `ask`, which credits, Today and the record read as an answer. The project derives `opened` from its record when it is read, so openings recorded before the field existed link their ask too, with nothing rewritten. Each read's results are kept beyond one isolate as ADR 0020 records.
- The port lists tags already peeled to their commits, since an annotated tag names a tag object a commit read cannot open.
- Artifacts' import brings no tags. An operator may backfill an imported repo's `refs/tags/*` from its source, through a short-lived write token minted over REST. This is the one write that skips the gateway, and it writes tags only, never `main`.
- Each read is an Artifacts operation, billed past a monthly allowance and limited to 2,000 a repo every 10 s. Every walk is capped: 50,000 paths, 200 commits scanned for a path's log or for why, 300 files and 2 MiB of text in a commit's diff, and 1 MiB per file.
