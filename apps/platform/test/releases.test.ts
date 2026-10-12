import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Handle } from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import { Context, Effect, Layer, Option, Schema } from "effect";

import { platform } from "../src/platform.ts";
import { ReleaseManifest } from "../src/releases.ts";
import { ReleaseReads, ReleaseStoreMemory } from "../src/releases/memory.ts";
import { MemorySessions } from "../src/sessions/memory.ts";
import { fakeEnv } from "./fake-env.ts";
import { noProjects, origin, served, toolCall, toolList } from "./harness.ts";

const linux = `${Brand.slug}-linux-x64`;

const darwin = `${Brand.slug}-darwin-arm64`;

const linuxBytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);

const darwinBytes = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 7, 0]);

const oldLinuxBytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 9]);

const linuxSha =
  "4f6a0b5c3e9d1a7b2c8e0f4d6a1b3c5e7f9a0b2c4d6e8f1a3b5c7d9e0f2a4b6c";

const darwinSha =
  "0e1d2c3b4a5968778695a4b3c2d1e0f0123456789abcdef0123456789abcdef0";

const oldLinuxSha =
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf";

const manifest = {
  latest: "0.1.0",
  versions: {
    "0.0.9": { assets: { [linux]: { bytes: 5, sha256: oldLinuxSha } } },
    "0.1.0": {
      assets: {
        [darwin]: { bytes: 6, sha256: darwinSha },
        [linux]: { bytes: 7, sha256: linuxSha },
      },
    },
  },
};

const script = (version: string) =>
  `#!/bin/sh\nset -eu\necho "installing ${Brand.cli} ${version}"\n`;

const files = {
  "releases/0.0.9/install.sh": script("0.0.9"),
  [`releases/0.0.9/${linux}`]: oldLinuxBytes,
  "releases/0.1.0/install.sh": script("0.1.0"),
  [`releases/0.1.0/${darwin}`]: darwinBytes,
  [`releases/0.1.0/${linux}`]: linuxBytes,
  "releases/manifest.json": JSON.stringify(manifest),
  "secrets/operator": "never served",
};

const sessions = MemorySessions.layer({ "alice-token": Handle.make("alice") });

const releasesServed = (
  stored: Readonly<Record<string, string | Uint8Array>>
) =>
  Effect.gen(function* () {
    const store = yield* Layer.build(ReleaseStoreMemory.layer(stored));

    const { fetch } = yield* served(
      Layer.mergeAll(noProjects, sessions, Layer.succeedContext(store))
    );

    return {
      fetch,
      reads: Context.get(store, ReleaseReads).keys,
      send: (path: string, init?: RequestInit) =>
        fetch(new Request(`${origin}${path}`, init)),
    };
  });

const textOf = (response: Response) => Effect.promise(() => response.text());

const headersOf = (reply: Response) => ({
  cache: reply.headers.get("cache-control"),
  etag: reply.headers.get("etag"),
  length: reply.headers.get("content-length"),
  location: reply.headers.get("location"),
  status: reply.status,
  type: reply.headers.get("content-type"),
});

const bytesOf = (response: Response) =>
  Effect.map(
    Effect.promise(() => response.arrayBuffer()),
    (buffer) => new Uint8Array(buffer)
  );

describe("the CLI's releases, served by the platform", () => {
  it.effect(
    "answers /install.sh to anyone with the latest release's script, cached for five minutes",
    () =>
      Effect.gen(function* () {
        const { send } = yield* releasesServed(files);

        const response = yield* send("/install.sh");

        expect({
          cache: response.headers.get("cache-control"),
          status: response.status,
          type: response.headers.get("content-type"),
        }).toStrictEqual({
          cache: "public, max-age=300",
          status: 200,
          type: "text/x-shellscript; charset=utf-8",
        });
        expect(yield* textOf(response)).toBe(script("0.1.0"));
      })
  );

  it.effect(
    "answers a version's binary as immutable bytes tagged with its sha256, and 304 to a client that holds them",
    () =>
      Effect.gen(function* () {
        const { send } = yield* releasesServed(files);

        const path = `/releases/0.1.0/${linux}`;

        const response = yield* send(path);

        expect({
          cache: response.headers.get("cache-control"),
          etag: response.headers.get("etag"),
          length: response.headers.get("content-length"),
          status: response.status,
          type: response.headers.get("content-type"),
        }).toStrictEqual({
          cache: "public, max-age=31536000, immutable",
          etag: `"${linuxSha}"`,
          length: "7",
          status: 200,
          type: "application/octet-stream",
        });
        expect(yield* bytesOf(response)).toStrictEqual(linuxBytes);

        const held = yield* send(path, {
          headers: { "if-none-match": `"${linuxSha}"` },
        });

        const heldWeakly = yield* send(path, {
          headers: { "if-none-match": `"${darwinSha}", W/"${linuxSha}"` },
        });

        const heldAny = yield* send(path, {
          headers: { "if-none-match": "*" },
        });

        const stale = yield* send(path, {
          headers: { "if-none-match": `"${oldLinuxSha}"` },
        });

        expect(
          [held, heldWeakly, heldAny, stale].map((each) => ({
            etag: each.headers.get("etag"),
            status: each.status,
          }))
        ).toStrictEqual([
          { etag: `"${linuxSha}"`, status: 304 },
          { etag: `"${linuxSha}"`, status: 304 },
          { etag: `"${linuxSha}"`, status: 304 },
          { etag: `"${linuxSha}"`, status: 200 },
        ]);
        expect(yield* textOf(held)).toBe("");
      })
  );

  it.effect(
    "sends latest to the newest release's file, a redirect kept five minutes",
    () =>
      Effect.gen(function* () {
        const { send } = yield* releasesServed(files);

        const replies = [
          yield* send(`/releases/latest/${linux}`),
          yield* send("/releases/latest/SHA256SUMS"),
        ];

        expect(
          replies.map((reply) => ({
            cache: reply.headers.get("cache-control"),
            location: reply.headers.get("location"),
            status: reply.status,
          }))
        ).toStrictEqual([
          {
            cache: "public, max-age=300",
            location: `/releases/0.1.0/${linux}`,
            status: 302,
          },
          {
            cache: "public, max-age=300",
            location: "/releases/0.1.0/SHA256SUMS",
            status: 302,
          },
        ]);
      })
  );

  it.effect(
    "answers the manifest as JSON, and a version's checksums as sha256sum prints them",
    () =>
      Effect.gen(function* () {
        const { send } = yield* releasesServed(files);

        const listed = yield* send("/releases/manifest.json");

        const sums = yield* send("/releases/0.1.0/SHA256SUMS");

        expect({
          cache: listed.headers.get("cache-control"),
          status: listed.status,
          type: listed.headers.get("content-type"),
        }).toStrictEqual({
          cache: "public, max-age=300",
          status: 200,
          type: "application/json",
        });
        expect(yield* Effect.promise(() => listed.json())).toStrictEqual(
          manifest
        );
        expect({
          cache: sums.headers.get("cache-control"),
          status: sums.status,
          type: sums.headers.get("content-type"),
        }).toStrictEqual({
          cache: "public, max-age=31536000, immutable",
          status: 200,
          type: "text/plain; charset=utf-8",
        });
        expect(yield* textOf(sums)).toBe(
          `${darwinSha}  ${darwin}\n${linuxSha}  ${linux}\n`
        );
      })
  );

  it.effect(
    "makes a version's checksums from its manifest, even when the manifest lists an uploaded SHA256SUMS",
    () =>
      Effect.gen(function* () {
        const listingSums = {
          ...manifest,
          versions: {
            ...manifest.versions,
            "0.1.0": {
              assets: {
                ...manifest.versions["0.1.0"].assets,
                SHA256SUMS: { bytes: 9, sha256: oldLinuxSha },
              },
            },
          },
        };

        const { reads, send } = yield* releasesServed({
          ...files,
          "releases/0.1.0/SHA256SUMS": "uploaded\n",
          "releases/manifest.json": JSON.stringify(listingSums),
        });

        const sums = yield* send("/releases/0.1.0/SHA256SUMS");

        expect({
          body: yield* textOf(sums),
          etag: sums.headers.get("etag"),
          status: sums.status,
          type: sums.headers.get("content-type"),
        }).toStrictEqual({
          body: `${darwinSha}  ${darwin}\n${linuxSha}  ${linux}\n`,
          etag: null,
          status: 200,
          type: "text/plain; charset=utf-8",
        });
        expect(yield* reads).toStrictEqual(["releases/manifest.json"]);
      })
  );

  it.effect(
    "answers 404 to a version, a file or a path it does not serve, and reads nothing outside releases/",
    () =>
      Effect.gen(function* () {
        const { reads, send } = yield* releasesServed(files);

        const paths = [
          `/releases/9.9.9/${linux}`,
          `/releases/0.0.9/${darwin}`,
          `/releases/0.1.0/${Brand.slug}-windows-x64`,
          "/releases/0.1.0/install.sh",
          "/releases/latest/manifest.json",
          "/releases/0.1.0/..%2F..%2Fsecrets%2Foperator",
          "/releases/..%2F..%2Fsecrets/operator",
          `/releases/..%2F..%2Fsecrets%2Foperator%23/${linux}`,
          `/releases/0.1.0%2F..%2F..%2Fsecrets/${linux}`,
          `/releases/../../secrets/operator`,
          `/releases/%2e%2e/${linux}`,
        ];

        const statuses = [];

        for (const path of paths) {
          statuses.push((yield* send(path)).status);
        }

        expect(statuses).toStrictEqual(paths.map(() => 404));
        expect(
          (yield* reads).filter(
            (key) => !key.startsWith("releases/") || key.includes("..")
          )
        ).toStrictEqual([]);
      })
  );

  it.effect("refuses to take anything: every other method is 405", () =>
    Effect.gen(function* () {
      const { reads, send } = yield* releasesServed(files);

      const replies = [
        yield* send("/install.sh", { body: "#!/bin/sh", method: "POST" }),
        yield* send(`/releases/0.1.0/${linux}`, {
          body: linuxBytes,
          method: "PUT",
        }),
        yield* send("/releases/manifest.json", { method: "DELETE" }),
      ];

      expect(
        replies.map((reply) => ({
          allow: reply.headers.get("allow"),
          status: reply.status,
        }))
      ).toStrictEqual(replies.map(() => ({ allow: "GET, HEAD", status: 405 })));
      expect(yield* reads).toStrictEqual([]);
    })
  );

  it.effect("answers HEAD as GET, without the body", () =>
    Effect.gen(function* () {
      const { send } = yield* releasesServed(files);

      const paths = [
        "/install.sh",
        `/releases/0.1.0/${linux}`,
        "/releases/manifest.json",
        "/releases/0.1.0/SHA256SUMS",
        `/releases/latest/${linux}`,
        `/releases/9.9.9/${linux}`,
      ];

      const asGot = [];

      const asHead = [];

      for (const path of paths) {
        const got = yield* send(path);

        const head = yield* send(path, { method: "HEAD" });

        asGot.push({ body: "", path, ...headersOf(got) });
        asHead.push({ body: yield* textOf(head), path, ...headersOf(head) });
      }

      expect(asHead).toStrictEqual(asGot);
      expect(asHead[1]?.length).toBe("7");
    })
  );

  it.effect(
    "needs no token, even a stale one, while every other route still answers 401",
    () =>
      Effect.gen(function* () {
        const { fetch, send } = yield* releasesServed(files);

        const stale = { headers: { authorization: "Bearer stale-token" } };

        const downloads = [
          yield* send("/install.sh", stale),
          yield* send("/releases/manifest.json", stale),
          yield* send(`/releases/latest/${linux}`, stale),
          yield* send(`/releases/0.1.0/${linux}`, stale),
          yield* send("/releases/0.1.0/SHA256SUMS", {
            headers: { authorization: "Basic c3RhbGU6dG9rZW4=" },
          }),
        ];

        const others = [
          yield* send("/install.sh.asc", stale),
          yield* send("/releases", stale),
          yield* send("/releases/0.1.0", stale),
          yield* send("/rpc", { ...stale, body: "{}", method: "POST" }),
          yield* fetch(toolList("stale-token")),
          yield* fetch(toolCall("listProjects", {})),
        ];

        expect(downloads.map(({ status }) => status)).toStrictEqual([
          200, 200, 302, 200, 200,
        ]);
        expect(others.map(({ status }) => status)).toStrictEqual(
          others.map(() => 401)
        );
      })
  );

  it.effect(
    "answers 503, kept nowhere, while the manifest is broken, and 404 before anything is released",
    () =>
      Effect.gen(function* () {
        const paths = [
          "/install.sh",
          "/releases/manifest.json",
          `/releases/latest/${linux}`,
          `/releases/0.1.0/${linux}`,
          "/releases/0.1.0/SHA256SUMS",
        ];

        const repliesTo = (
          stored: Readonly<Record<string, string | Uint8Array>>
        ) =>
          Effect.gen(function* () {
            const { send } = yield* releasesServed(stored);

            const replies = [];

            for (const path of paths) {
              const reply = yield* send(path);

              replies.push({
                cache: reply.headers.get("cache-control"),
                status: reply.status,
              });
            }

            return replies;
          });

        const unlisted = yield* repliesTo({
          ...files,
          "releases/manifest.json": JSON.stringify({
            ...manifest,
            latest: "0.2.0",
          }),
        });

        const truncated = yield* repliesTo({
          ...files,
          "releases/manifest.json": JSON.stringify(manifest).slice(0, 40),
        });

        const unreleased = yield* repliesTo({});

        expect({ truncated, unlisted, unreleased }).toStrictEqual({
          truncated: paths.map(() => ({ cache: "no-store", status: 503 })),
          unlisted: paths.map(() => ({ cache: "no-store", status: 503 })),
          unreleased: paths.map(() => ({ cache: "no-store", status: 404 })),
        });
      })
  );

  // `releases` is a name no project may take, so git's paths under it reach the gateway
  // and find no repo. The releases' own 404 has no body, so the text says the gateway
  // answered.
  it.effect(
    "leaves git's paths to the gateway, which knows no repo named releases",
    () =>
      Effect.gen(function* () {
        const { reads, send } = yield* releasesServed(files);

        const reserved = yield* send(
          "/releases/info/refs?service=git-receive-pack"
        );

        const push = yield* send("/datekit/info/refs?service=git-receive-pack");

        expect({
          push: {
            challenge: push.headers.get("www-authenticate"),
            status: push.status,
          },
          reserved: { status: reserved.status, text: yield* textOf(reserved) },
        }).toStrictEqual({
          push: { challenge: `Basic realm="${Brand.name}"`, status: 401 },
          reserved: { status: 404, text: "no repo releases\n" },
        });
        expect(yield* reads).toStrictEqual([]);
      })
  );
});

const bucketOf = (stored: Readonly<Record<string, string | Uint8Array>>) =>
  untouchable<R2Bucket>("RELEASES", {
    get: (key: string) =>
      Promise.resolve(
        Object.hasOwn(stored, key)
          ? untouchable<R2ObjectBody>("R2ObjectBody", {
              body: new Blob([stored[key] ?? ""]).stream(),
              size: new Blob([stored[key] ?? ""]).size,
            })
          : null
      ),
  });

describe("the Worker's releases, from its RELEASES bucket", () => {
  it.effect("serves the script and the binaries the bucket holds", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(
        platform({ ...fakeEnv(), RELEASES: bucketOf(files) })
      );

      const send = (path: string, init?: RequestInit) =>
        fetch(new Request(`${origin}${path}`, init));

      const installer = yield* send("/install.sh");

      const binary = yield* send(`/releases/0.1.0/${linux}`);

      const head = yield* send(`/releases/0.1.0/${darwin}`, {
        method: "HEAD",
      });

      expect(
        [installer, binary, head].map(({ headers, status }) => ({
          length: headers.get("content-length"),
          status,
        }))
      ).toStrictEqual([
        { length: String(script("0.1.0").length), status: 200 },
        { length: "7", status: 200 },
        { length: "6", status: 200 },
      ]);
      expect(yield* textOf(installer)).toBe(script("0.1.0"));
      expect(yield* bytesOf(binary)).toStrictEqual(linuxBytes);
      expect(yield* textOf(head)).toBe("");
    })
  );

  it.effect("answers 500, and serves nothing, when the bucket fails", () =>
    Effect.gen(function* () {
      const failing = untouchable<R2Bucket>("RELEASES", {
        get: () => Promise.reject(new Error("R2 is down")),
      });

      const { fetch } = yield* served(
        platform({ ...fakeEnv(), RELEASES: failing })
      );

      const reply = yield* fetch(new Request(`${origin}/install.sh`));

      expect({
        body: yield* textOf(reply),
        status: reply.status,
      }).toStrictEqual({ body: "", status: 500 });
    })
  );
});

const holding = (
  name: string,
  asset: { readonly bytes: number | string; readonly sha256: string }
) => ({
  latest: "0.1.0",
  versions: { "0.1.0": { assets: { [name]: asset } } },
});

describe("the release manifest", () => {
  const decode = Schema.decodeUnknownOption(ReleaseManifest);

  it("decodes what the release script writes", () => {
    expect(decode(manifest)).toStrictEqual(Option.some(manifest));
  });

  it("refuses a digest that is not 64 lowercase hex digits", () => {
    expect(
      [linuxSha.toUpperCase(), linuxSha.slice(1), `${linuxSha.slice(1)}g`].map(
        (sha256) => decode(holding(linux, { bytes: 7, sha256 }))
      )
    ).toStrictEqual([Option.none(), Option.none(), Option.none()]);
  });

  it("refuses a size that is not a whole count of bytes", () => {
    expect(
      [1.5, -1, "7", Number.POSITIVE_INFINITY].map((bytes) =>
        decode(holding(linux, { bytes, sha256: linuxSha }))
      )
    ).toStrictEqual([
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
    ]);
  });

  it("refuses a latest it does not list", () => {
    expect(decode({ ...manifest, latest: "0.2.0" })).toStrictEqual(
      Option.none()
    );
  });

  it("refuses a version or a file name that could leave its folder", () => {
    const asset = { bytes: 7, sha256: linuxSha };

    expect([
      decode({
        latest: "0.1.0",
        versions: { "../x": { assets: {} }, "0.1.0": { assets: {} } },
      }),
      decode({ latest: "..", versions: { "..": { assets: {} } } }),
      decode({ latest: "0.1", versions: { "0.1": { assets: {} } } }),
      decode(holding("a/b", asset)),
      decode(holding("..", asset)),
    ]).toStrictEqual([
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
    ]);
  });
});
