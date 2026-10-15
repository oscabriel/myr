import { Brand } from "@repo/brand";

export const CLI_CLIENT_PATH = "/oauth/cli";

// Where a sign-in for `login --paste` ends: a page that shows the code, for a browser on another machine than the CLI.
export const CLI_CODE_PATH = "/oauth/cli/code";

export const cliClientId = (origin: string) => `${origin}${CLI_CLIENT_PATH}`;

// RFC 8252: the provider matches loopback redirects without the port. The
// code page is the platform's own: a code shown there is worth nothing
// without the verifier the CLI that asked for it holds (PKCE).
export const cliClientMetadata = (origin: string) => ({
  client_id: cliClientId(origin),
  client_name: `${Brand.name} CLI`,
  grant_types: ["authorization_code", "refresh_token"] as const,
  redirect_uris: [
    "http://127.0.0.1/callback",
    "http://[::1]/callback",
    `${origin}${CLI_CODE_PATH}`,
  ] as const,
  response_types: ["code"] as const,
  token_endpoint_auth_method: "none" as const,
});
