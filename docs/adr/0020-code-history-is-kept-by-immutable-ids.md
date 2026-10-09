---
status: accepted
---

# Code history is kept by immutable ids, in a bucket of its own

Why each line of a file is there, and a path's history, are what a walk of up to 200 first-parent commits computes, and a cold walk on a large import took tens of seconds in one isolate, then again in the next. What a walk computes from a commit is fixed for good by that commit's content, so the platform keeps it in an R2 bucket, `code-cache-<stage>` (binding `CODE_CACHE`, platform only), behind the `CodeStore` port in `@repo/project`. A key is `<repo>/<kind>/v<version>/<commit>/<scan>/<sha256(path)>`: the canonical repo only, `why` or `path-log`, the version of the algorithm that computed it, a commit id (never `main` or a tag's name, which resolve first), how many commits the walk scanned, and the path hashed to keep the key under R2's 1,024 bytes. A value holds ids and ranges encoded with Schema, never a file's text and never a landing: each view asks the project's record for its landings, so a new landing or an opening's ask shows at once.

## Considered Options

- **The Cache API.** It is per colo, so a reader in another colo pays the walk again, and every stage lives on `workers.dev`, where we assume `cache.put` keeps nothing.
- **Workers KV.** Its namespace id would be written per stage into `wrangler.jsonc`, and it is eventually consistent, where R2 is strongly consistent and its binding is only a bucket name.
- **The Project Durable Object's storage.** It would put every reader's lookup and put on the project's single-threaded object, beside its claims and landings.
- **The `evidence` bucket.** It keeps failing lanes' logs, another job with its own name.
- **Every tree in the store.** Tried live and reverted: each store call cost what a repo read does, so a repo's first view did three times the calls and took 32-38 s.
- **A per-commit path index.** Counted over local copies, building it reads every changed folder of every commit in the window, about three times the trees of one walk, and the first view would pay for it. Not built.

## Consequences

- Reads go isolate cache, then store, then walk; what a walk computes is put in both. A store that fails, or a value that no longer decodes, is a miss, never the read's failure, and the walk puts a good value back.
- A walk may start from what is kept at a first-parent ancestor up to 16 commits back, carrying line ranges forward through each diff, so a new landing on `main` costs a handful of reads. A result built forward that way keeps that ancestor's place in history, so past the 200-commit window it can differ from a walk started fresh; both are correct for the commits they name.
- A version moves whenever its algorithm changes, so an old value is never read as a new one, and nothing in the bucket ever goes stale.
- A store answers one Worker invocation a few dozen calls a second whatever is under way, so the number of calls is the cost. A file of at most 256 KiB is read whole at each commit (its git blob id is the SHA-1 of its bytes), one call a commit instead of its folders; a larger file, a folder or a missing path walks the folders. A commit that changes only a file's mode does not show in that file's history.
- A view's reads run in one repo session (`inRepoSession` in `@repo/artifacts`): the binding adapter opens one handle per repo for the session and releases it when the view ends. A call Artifacts refuses as rate limited is asked again with a growing wait, a few times, then fails the view, which keeps nothing.
- A cold view of a file with 200 commits of history still makes about 200 calls, 5-8 s in one invocation; a warm one answers in under a second. Going lower needs work that runs off the reader's request, such as an index built when something lands.
- Removing the store is a deletion: the port's default stores nothing, and every read still answers.
