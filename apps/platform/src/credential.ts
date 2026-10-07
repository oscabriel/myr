import { bearerToken } from "@repo/protocol/authenticate";
import { Option, Schema } from "effect";

const BASIC = /^Basic (?<encoded>\S+)$/u;

const fromBase64 = Schema.decodeOption(Schema.StringFromBase64);

/** The password of `<user>:<password>`; the first colon ends the user name. */
const passwordOf = (pair: string) => {
  const colon = pair.indexOf(":");

  return colon === -1 || colon === pair.length - 1
    ? Option.none()
    : Option.some(pair.slice(colon + 1));
};

/**
 * The platform token a request carries, if it carries one: from
 * `Authorization: Bearer <token>` (the CLI, MCP clients), or as the password
 * of `Authorization: Basic base64(<user>:<token>)`, which is how git sends
 * the token it got from the credential helper. The user name is ignored.
 */
export const credentialOf = (headers: Headers): Option.Option<string> => {
  const authorization = headers.get("authorization") ?? undefined;

  return Option.orElse(bearerToken(authorization), () =>
    Option.fromNullishOr(BASIC.exec(authorization ?? "")?.groups?.encoded).pipe(
      Option.flatMap(fromBase64),
      Option.flatMap(passwordOf)
    )
  );
};
