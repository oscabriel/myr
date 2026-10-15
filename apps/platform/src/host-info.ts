import { Context } from "effect";
import type { Option } from "effect";

export class HostInfo extends Context.Service<
  HostInfo,
  { readonly webUrl: Option.Option<string> }
>()("platform/HostInfo") {}
