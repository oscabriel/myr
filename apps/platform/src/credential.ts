import { parseAuditUser } from "@repo/protocol/audit";
import type { HarnessAudit } from "@repo/protocol/audit";
import { bearerToken } from "@repo/protocol/authenticate";
import { Option, Schema } from "effect";

const BASIC = /^Basic (?<encoded>\S+)$/u;

const fromBase64 = Schema.decodeOption(Schema.StringFromBase64);

const basicPairOf = (headers: Headers): Option.Option<string> =>
  Option.fromNullishOr(
    BASIC.exec(headers.get("authorization") ?? "")?.groups?.encoded
  ).pipe(Option.flatMap(fromBase64));

const passwordOf = (pair: string) => {
  const colon = pair.indexOf(":");

  return colon === -1 || colon === pair.length - 1
    ? Option.none()
    : Option.some(pair.slice(colon + 1));
};

const userOf = (pair: string) => pair.slice(0, Math.max(pair.indexOf(":"), 0));

export const credentialOf = (headers: Headers): Option.Option<string> =>
  Option.orElse(bearerToken(headers.get("authorization") ?? undefined), () =>
    Option.flatMap(basicPairOf(headers), passwordOf)
  );

export const auditOf = (headers: Headers): Option.Option<HarnessAudit> =>
  Option.flatMap(basicPairOf(headers), (pair) => parseAuditUser(userOf(pair)));
