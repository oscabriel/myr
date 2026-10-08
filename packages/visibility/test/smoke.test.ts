import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import { Result, Schema } from "effect";

import manifest from "../package.json" with { type: "json" };
import { EnvSchemaParser } from "../src/env-schema.ts";
import { LayerRepos } from "../src/layer-repos.ts";
import { SealedValue, WriteOnlyValues } from "../src/vault.ts";

// The skeleton's test: the ports the visibility package builds against.
// The modules that fill them have their own tests beside this one.
describe("the package", () => {
  it("is @repo/visibility", () => {
    expect(manifest.name).toBe("@repo/visibility");
  });

  it("declares each port under a key of its own", () => {
    expect([
      EnvSchemaParser.key,
      LayerRepos.key,
      WriteOnlyValues.key,
    ]).toStrictEqual([
      "visibility/EnvSchemaParser",
      "visibility/LayerRepos",
      "visibility/WriteOnlyValues",
    ]);
  });

  // The private namespace is a RepoHost of its own, so code that
  // asks for the public one can never be handed the layers' repos.
  it("keeps the layers' repos behind a RepoHost of their own", () => {
    expect(LayerRepos.key).not.toBe(RepoHost.key);
    expectTypeOf<LayerRepos["Service"]>().toEqualTypeOf<RepoHost["Service"]>();
  });

  it("seals a value as base64 fields and a key version, never the value", () => {
    const sealed = {
      ciphertext: "c2VhbGVk",
      iv: "aXYtMTItYnl0ZXM=",
      keyVersion: 1,
      wrappedKey: "d3JhcHBlZA==",
    };

    expect(Schema.decodeSync(SealedValue)(sealed)).toStrictEqual(sealed);
    expect(
      Result.isFailure(
        Schema.decodeResult(SealedValue)({
          ...sealed,
          ciphertext: "not base64!",
        })
      )
    ).toBeTruthy();
    expect(Object.keys(SealedValue.fields).toSorted()).toStrictEqual([
      "ciphertext",
      "iv",
      "keyVersion",
      "wrappedKey",
    ]);
  });
});
