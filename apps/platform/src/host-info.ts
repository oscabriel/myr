/**
 * What the platform's `/` says of its host beyond the request: where the
 * web app lives (`PUBLIC_WEB_URL`, none on a stage without one) and the
 * model that drafts asks (`DRAFT_MODEL`). `platformOn` provides it from
 * the decoded env; `surfaces.ts` re-exports it with the other services.
 */
import { Context } from "effect";
import type { Option } from "effect";

export class HostInfo extends Context.Service<
  HostInfo,
  {
    readonly webUrl: Option.Option<string>;
    readonly draftModel: string;
  }
>()("platform/HostInfo") {}
