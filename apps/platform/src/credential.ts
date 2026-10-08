import { parseAuditUser } from "@repo/protocol/audit";
import type { HarnessAudit } from "@repo/protocol/audit";
import { bearerToken } from "@repo/protocol/authenticate";
import { Option, Schema } from "effect";

const BASIC = /^Basic (?<encoded>\S+)$/u;

const fromBase64 = Schema.decodeOption(Schema.StringFromBase64);

/** The `<user>:<password>` pair of `Authorization: Basic base64(<user>:<password>)`. */
const basicPairOf = (headers: Headers): Option.Option<string> =>
  Option.fromNullishOr(
    BASIC.exec(headers.get("authorization") ?? "")?.groups?.encoded
  ).pipe(Option.flatMap(fromBase64));

/** The password of `<user>:<password>`; the first colon ends the user name. */
const passwordOf = (pair: string) => {
  const colon = pair.indexOf(":");

  return colon === -1 || colon === pair.length - 1
    ? Option.none()
    : Option.some(pair.slice(colon + 1));
};

/** The user name of `<user>:<password>`: all before the first colon. */
const userOf = (pair: string) => pair.slice(0, Math.max(pair.indexOf(":"), 0));

/**
 * The platform token a request carries, if it carries one: from
 * `Authorization: Bearer <token>` (the CLI, MCP clients), or as the password
 * of `Authorization: Basic base64(<user>:<token>)`, which is how git sends
 * the token it got from the credential helper. The user name is ignored.
 */
export const credentialOf = (headers: Headers): Option.Option<string> =>
  Option.orElse(bearerToken(headers.get("authorization") ?? undefined), () =>
    Option.flatMap(basicPairOf(headers), passwordOf)
  );

/**
 * The harness a push came through, as its credential helper's basic-auth
 * user name says (`audit;harness=pi&model=kimi-k3`, `@repo/protocol/audit`);
 * none for any other user name, or a bearer token. Audit metadata, never
 * identity: who pushes is the token's person (`credentialOf`).
 */
export const auditOf = (headers: Headers): Option.Option<HarnessAudit> =>
  Option.flatMap(basicPairOf(headers), (pair) => parseAuditUser(userOf(pair)));
