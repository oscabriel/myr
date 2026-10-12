import { RepoName } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import { Context, Data, Schema } from "effect";
import type { Effect } from "effect";

export type Service = "git-upload-pack" | "git-receive-pack";

/** The client's credentials are never among the headers. */
export type Exchange = Data.TaggedEnum<{
  Advertise: { readonly service: Service; readonly headers: Headers };
  Call: {
    readonly service: Service;
    readonly headers: Headers;
    readonly body: ReadableStream<Uint8Array>;
  };
}>;

export const Exchange = Data.taggedEnum<Exchange>();

export class UpstreamFailure extends Schema.TaggedError<UpstreamFailure>()(
  "UpstreamFailure",
  { reason: Schema.String, repo: RepoName }
) {}

export class Upstream extends Context.Service<
  Upstream,
  {
    readonly exchange: (
      repo: RepoName,
      exchange: Exchange
    ) => Effect.Effect<Response, RepoNotFound | UpstreamFailure>;
  }
>()("git/Upstream") {}
