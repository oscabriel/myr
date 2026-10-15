import { Option } from "effect";

import { cliClientId } from "./cli-client.ts";

// Where the web serves its Client ID Metadata Document (apps/web's `/auth/client`).
export const WEB_CLIENT_PATH = "/auth/client";

export type FirstParty = "cli" | "web";

const originOf = Option.liftThrowable((url: string) => new URL(url).origin);

/**
 * Our own clients, told apart by their id alone: a client names itself in its
 * metadata, so a name proves nothing, but only this platform and its web serve
 * a document at these addresses.
 */
export const firstPartyOf = (
  clientId: string,
  origin: string,
  webUrl: Option.Option<string>
): FirstParty | undefined => {
  if (clientId === cliClientId(origin)) {
    return "cli";
  }

  const web = Option.flatMap(webUrl, originOf);

  return Option.isSome(web) && clientId === `${web.value}${WEB_CLIENT_PATH}`
    ? "web"
    : undefined;
};
