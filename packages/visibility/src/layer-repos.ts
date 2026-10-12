// Code that asks for the public `RepoHost` is never handed this one, and no
// Worker that serves public pages binds it.
import type { RepoHost } from "@repo/artifacts/repo-host";
import { Context } from "effect";

export class LayerRepos extends Context.Service<
  LayerRepos,
  RepoHost["Service"]
>()("visibility/LayerRepos") {}
