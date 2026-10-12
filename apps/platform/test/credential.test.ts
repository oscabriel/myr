import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { credentialOf } from "../src/credential.ts";

const token = "alice-token-0123456789abcdef01234567";

const authorized = (authorization: string) => new Headers({ authorization });

const basic = (user: string, password: string) =>
  `Basic ${btoa(`${user}:${password}`)}`;

describe("the credential a request carries", () => {
  it("is a bearer token", () => {
    expect(credentialOf(authorized(`Bearer ${token}`))).toStrictEqual(
      Option.some(token)
    );
  });

  it("is git's basic-auth password, whatever the user name", () => {
    expect(credentialOf(authorized(basic("alice", token)))).toStrictEqual(
      Option.some(token)
    );
    expect(
      credentialOf(authorized(basic("x-access-token", token)))
    ).toStrictEqual(Option.some(token));
  });

  it("keeps a colon inside the password", () => {
    expect(credentialOf(authorized(basic("alice", "a:b")))).toStrictEqual(
      Option.some("a:b")
    );
  });

  it("is none when the header is absent", () => {
    expect(credentialOf(new Headers())).toStrictEqual(Option.none());
  });

  it("is none when the header is malformed", () => {
    expect(credentialOf(authorized("Bearer"))).toStrictEqual(Option.none());
    expect(credentialOf(authorized("Basic not*base64"))).toStrictEqual(
      Option.none()
    );
    expect(credentialOf(authorized(`Basic ${btoa("no-colon")}`))).toStrictEqual(
      Option.none()
    );
    expect(credentialOf(authorized(basic("alice", "")))).toStrictEqual(
      Option.none()
    );
    expect(credentialOf(authorized(`Token ${token}`))).toStrictEqual(
      Option.none()
    );
  });
});
