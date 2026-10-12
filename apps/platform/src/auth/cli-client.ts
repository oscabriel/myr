import { Brand } from "@repo/brand";

export const CLI_CLIENT_PATH = "/oauth/cli";

export const cliClientId = (origin: string) => `${origin}${CLI_CLIENT_PATH}`;

// RFC 8252: the provider matches loopback redirects without the port.
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
