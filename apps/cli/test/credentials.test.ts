import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Handle } from "@repo/protocol/ids";
import {
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
} from "effect";

import {
  Credentials,
  CredentialsFile,
  CredentialsUnwritable,
  gitHelperConfig,
} from "../src/credentials.ts";
import type { Profile } from "../src/credentials.ts";
import { oauthServer, refreshTokenOf, renewedTokenOf } from "./oauth-server.ts";

const SLUG = Brand.slug.toUpperCase();

const token = "tok-default-0123456789abcdefghijklmnopqrstuvwxyz";

const defaultProfile: Profile = {
  handle: Handle.make("oscar"),
  token: Redacted.make(token),
  url: "https://platform-dev.example.workers.dev",
};

const aliceProfile: Profile = {
  handle: Handle.make("alice"),
  token: Redacted.make("tok-alice-0123456789abcdefghijklmnopqrstuvwxyz"),
  url: "https://platform-dev-oscabriel.example.workers.dev",
};

const configHome = Effect.map(
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectoryScoped()),
  (dir) => ({ dir, env: { HOME: "/nonexistent", XDG_CONFIG_HOME: dir } })
);

const credentialsIn = (env: Record<string, string>) =>
  Effect.provide(
    Effect.service(Credentials),
    CredentialsFile.pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))
    )
  );

const seen = (profile: Option.Option<Profile>) =>
  Option.map(profile, ({ handle, token: secret, url }) => ({
    handle,
    token: Redacted.value(secret),
    url,
  }));

describe("stored credentials", () => {
  it.live(
    "are written to <config>/<slug>/credentials.json, readable by the owner alone, and read back",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { dir, env } = yield* configHome;
        const credentials = yield* credentialsIn(env);

        yield* credentials.put("default", defaultProfile);

        const file = path.join(dir, Brand.slug, "credentials.json");

        expect(yield* fs.exists(file)).toBeTruthy();

        const info = yield* fs.stat(file);

        expect(info.mode % 0o1000).toBe(0o600);
        expect(seen(yield* credentials.current)).toStrictEqual(
          seen(Option.some(defaultProfile))
        );
        expect(seen(yield* (yield* credentialsIn(env)).current)).toStrictEqual(
          seen(Option.some(defaultProfile))
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("give way to a token and url in the env", () =>
    Effect.gen(function* () {
      const { env } = yield* configHome;

      yield* (yield* credentialsIn(env)).put("default", defaultProfile);

      const fromEnv = yield* credentialsIn({
        ...env,
        [`${SLUG}_TOKEN`]: "tok-env-0123456789abcdefghijklmnopqrstuvwxyz",
        [`${SLUG}_URL`]: "https://platform-ci.example.workers.dev",
      });

      expect(seen(yield* fromEnv.current)).toStrictEqual(
        Option.some({
          handle: undefined,
          token: "tok-env-0123456789abcdefghijklmnopqrstuvwxyz",
          url: "https://platform-ci.example.workers.dev",
        })
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("are chosen by the profile the env names", () =>
    Effect.gen(function* () {
      const { env } = yield* configHome;
      const credentials = yield* credentialsIn(env);

      yield* credentials.put("default", defaultProfile);
      yield* credentials.put("alice", aliceProfile);

      const alice = yield* credentialsIn({
        ...env,
        [`${SLUG}_PROFILE`]: "alice",
      });

      expect(seen(yield* alice.current)).toStrictEqual(
        seen(Option.some(aliceProfile))
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("are found by the platform's host", () =>
    Effect.gen(function* () {
      const { env } = yield* configHome;
      const credentials = yield* credentialsIn(env);

      yield* credentials.put("default", defaultProfile);
      yield* credentials.put("alice", aliceProfile);

      expect(
        seen(
          yield* credentials.forHost(
            "platform-dev-oscabriel.example.workers.dev"
          )
        )
      ).toStrictEqual(seen(Option.some(aliceProfile)));
      expect(yield* credentials.forHost("elsewhere.example.com")).toStrictEqual(
        Option.none()
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("are removed by name, once", () =>
    Effect.gen(function* () {
      const { env } = yield* configHome;
      const credentials = yield* credentialsIn(env);

      yield* credentials.put("default", defaultProfile);

      expect(Option.isSome(yield* credentials.remove("default"))).toBeTruthy();
      expect(yield* credentials.remove("default")).toStrictEqual(Option.none());
      expect(yield* credentials.current).toStrictEqual(Option.none());
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("never show the token when printed or encoded", () =>
    Effect.gen(function* () {
      const { env } = yield* configHome;
      const credentials = yield* credentialsIn(env);

      yield* credentials.put("default", defaultProfile);

      const profile = yield* credentials.current;

      expect(Option.isSome(profile)).toBeTruthy();
      expect(String(profile)).not.toContain(token);
      expect(JSON.stringify(profile)).not.toContain(token);
      expect(JSON.stringify(Option.getOrUndefined(profile))).not.toContain(
        token
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "are never written over a file that can't be read, and read as none",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { dir, env } = yield* configHome;
        const file = path.join(dir, Brand.slug, "credentials.json");

        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "not json");

        const credentials = yield* credentialsIn(env);

        const put = yield* Effect.flip(
          credentials.put("default", defaultProfile)
        );

        expect(put).toStrictEqual(new CredentialsUnwritable({ path: file }));
        expect(yield* fs.readFileString(file)).toBe("not json");
        expect(yield* credentials.current).toStrictEqual(Option.none());
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

const kept = (profile: Option.Option<Profile>) =>
  Option.map(profile, ({ refreshToken, token: secret }) => ({
    refreshToken:
      refreshToken === undefined ? undefined : Redacted.value(refreshToken),
    token: Redacted.value(secret),
  }));

describe("a stored browser sign-in, near its token's lapse", () => {
  const signedIn = "tok-signed-in-0123456789abcdefghijklmnopqrstuvwxyz";

  const given = "refresh-given";

  // A profile as `login` keeps it, its token lapsing `in` milliseconds from now.
  const browserProfile = (url: string, lapsesIn: number) =>
    Effect.map(
      Effect.clockWith((clock) => clock.currentTimeMillis),
      (now): Profile => ({
        expiresAt: now + lapsesIn,
        handle: Handle.make("oscar"),
        refreshToken: Redacted.make(given),
        token: Redacted.make(signedIn),
        url,
      })
    );

  it.live(
    "is renewed by its refresh token when read, and the renewal is written back",
    () =>
      Effect.gen(function* () {
        const server = yield* oauthServer({ given, token: signedIn });
        const { env } = yield* configHome;
        const credentials = yield* credentialsIn(env);

        yield* credentials.put(
          "default",
          yield* browserProfile(server.origin, 30_000)
        );

        const read = yield* credentials.current;
        const again = yield* (yield* credentialsIn(env)).current;

        const renewed = {
          refreshToken: refreshTokenOf(1),
          token: renewedTokenOf(signedIn, 0),
        };

        expect({
          again: kept(again),
          asked: (yield* server.renewals).map((form) => ({ ...form })),
          read: kept(read),
        }).toStrictEqual({
          again: Option.some(renewed),
          asked: [
            {
              client_id: `${server.origin}/oauth/cli`,
              grant_type: "refresh_token",
              refresh_token: given,
            },
          ],
          read: Option.some(renewed),
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("is renewed when git's helper finds it by host, too", () =>
    Effect.gen(function* () {
      const server = yield* oauthServer({ given, token: signedIn });
      const { env } = yield* configHome;
      const credentials = yield* credentialsIn(env);

      yield* credentials.put("alice", yield* browserProfile(server.origin, 0));

      expect(
        kept(yield* credentials.forHost(new URL(server.origin).host))
      ).toStrictEqual(
        Option.some({
          refreshToken: refreshTokenOf(1),
          token: renewedTokenOf(signedIn, 0),
        })
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("is left alone while its token has more than a minute to live", () =>
    Effect.gen(function* () {
      const server = yield* oauthServer({ given, token: signedIn });
      const { env } = yield* configHome;
      const credentials = yield* credentialsIn(env);

      yield* credentials.put(
        "default",
        yield* browserProfile(server.origin, 10 * 60_000)
      );

      expect(kept(yield* credentials.current)).toStrictEqual(
        Option.some({ refreshToken: given, token: signedIn })
      );
      expect(yield* server.renewals).toStrictEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "keeps its token when the platform refuses the renewal, so the call it carries is refused as signed out",
    () =>
      Effect.gen(function* () {
        const server = yield* oauthServer({
          given,
          refuseRenewals: true,
          token: signedIn,
        });

        const { env } = yield* configHome;
        const credentials = yield* credentialsIn(env);

        yield* credentials.put(
          "default",
          yield* browserProfile(server.origin, 0)
        );

        expect(kept(yield* credentials.current)).toStrictEqual(
          Option.some({ refreshToken: given, token: signedIn })
        );
        expect(yield* server.renewals).toHaveLength(1);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "never renews a token given by hand, which has no refresh token",
    () =>
      Effect.gen(function* () {
        const { env } = yield* configHome;
        const credentials = yield* credentialsIn(env);

        yield* credentials.put("default", defaultProfile);

        expect(seen(yield* credentials.current)).toStrictEqual(
          seen(Option.some(defaultProfile))
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("git's credential helper config", () => {
  it("names this CLI's helper for the platform's url alone, after clearing any other, with the repo path", () => {
    const url = "https://platform-dev.example.workers.dev";

    expect(gitHelperConfig(url)).toStrictEqual([
      [
        "git",
        "config",
        "--global",
        "--replace-all",
        `credential.${url}.helper`,
        "",
      ],
      [
        "git",
        "config",
        "--global",
        "--add",
        `credential.${url}.helper`,
        Brand.slug,
      ],
      ["git", "config", "--global", `credential.${url}.useHttpPath`, "true"],
    ]);
  });
});
