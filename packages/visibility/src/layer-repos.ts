/**
 * The private namespace's repos: every project's layer repos,
 * `<project>--<layer>`, behind a `RepoHost` of their own. The platform binds
 * it over `ARTIFACTS_PRIVATE`; code that asks for the public `RepoHost` is
 * never handed it, and no Worker that serves public pages binds it.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import { Context } from "effect";

export class LayerRepos extends Context.Service<
  LayerRepos,
  RepoHost["Service"]
>()("visibility/LayerRepos") {}
