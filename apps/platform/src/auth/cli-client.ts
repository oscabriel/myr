/**
 * The CLI's OAuth client: fixed and public. It signs in with PKCE only and
 * gets its code at a loopback redirect on whatever port it listens on (RFC
 * 8252: the provider matches loopback redirects without the port). Its
 * `client_id` is the URL of this Client ID Metadata Document, which the
 * platform serves itself, so nothing is registered at bootstrap.
 */
import { Brand } from "@repo/brand";

/** Where the platform serves the CLI's metadata document; its URL is the CLI's client id. */
export const CLI_CLIENT_PATH = "/oauth/cli";

/** The CLI's client id on the platform at `origin`. */
export const cliClientId = (origin: string) => `${origin}${CLI_CLIENT_PATH}`;

/** The CLI's Client ID Metadata Document, as the platform at `origin` serves it. */
export const cliClientMetadata = (origin: string) => ({
  client_id: cliClientId(origin),
  client_name: `${Brand.name} CLI`,
  grant_types: ["authorization_code", "refresh_token"] as const,
  redirect_uris: [
    "http://127.0.0.1/callback",
    "http://[::1]/callback",
  ] as const,
  response_types: ["code"] as const,
  token_endpoint_auth_method: "none" as const,
});
