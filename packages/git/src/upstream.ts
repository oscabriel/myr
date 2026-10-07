import { RepoName } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import { Context, Data, Schema } from "effect";
import type { Effect } from "effect";

/** The two git services the gateway carries. */
export type Service = "git-upload-pack" | "git-receive-pack";

/**
 * One smart-HTTP exchange with the git server behind the gateway: a ref
 * advertisement (`GET info/refs?service=…`) or a service call (`POST
 * <service>`). The headers are the gateway's own pick of the client's; the
 * client's credentials are never among them.
 */
export type Exchange = Data.TaggedEnum<{
  Advertise: { readonly service: Service; readonly headers: Headers };
  Call: {
    readonly service: Service;
    readonly headers: Headers;
    readonly body: ReadableStream<Uint8Array>;
  };
}>;

export const Exchange = Data.taggedEnum<Exchange>();

/** The git server behind the gateway did not answer. */
export class UpstreamFailure extends Schema.TaggedError<UpstreamFailure>()(
  "UpstreamFailure",
  { reason: Schema.String, repo: RepoName }
) {}

/**
 * The git server the gateway forwards to, holding the platform's credentials:
 * Artifacts in production, `git http-backend` in tests.
 */
export class Upstream extends Context.Service<
  Upstream,
  {
    readonly exchange: (
      repo: RepoName,
      exchange: Exchange
    ) => Effect.Effect<Response, RepoNotFound | UpstreamFailure>;
  }
>()("git/Upstream") {}
