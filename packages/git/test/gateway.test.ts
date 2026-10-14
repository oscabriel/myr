import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CommitSha, RepoPath } from "@repo/protocol/ids";
import { OutOfScope, StaleBase, TouchedJudge } from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { git, gitOk } from "@repo/testkit/git";
import { Effect, Option, Ref } from "effect";

import { Custody } from "../src/custody.ts";
import { gitRoute } from "../src/gateway.ts";
import { admitAll, commit, world } from "./world.ts";

const refusing = (ref: string, refusals: readonly Refusal[]) =>
  Custody.of({
    admit: (_repo, commands) =>
      Effect.succeed(
        commands.some((command) => command.ref === ref) ? refusals : []
      ),
    review: () => Effect.succeed([]),
  });

const artifactsBusy = () =>
  new Response("0024\u0003artifacts_git_receive_pack_busy", {
    headers: { "content-type": "application/x-git-receive-pack-result" },
  });

const remoteLines = (stderr: string) =>
  stderr
    .split("\n")
    .filter((line) => line.startsWith("remote: "))
    .map((line) => line.trimEnd());

// A credential the client sends; the gateway must keep it from the upstream.
const asClient = ["-c", "http.extraHeader=Authorization: Bearer client-secret"];

const noise = (length: number) => {
  const digits: string[] = [];
  let state = 20_261_006;

  while (digits.length < length) {
    state = (state * 16_807) % 2_147_483_647;
    digits.push((state % 16).toString(16));
  }

  return digits.join("");
};

describe("the gateway between git and its upstream", () => {
  it.live(
    "clones and fetches, keeping the client's credentials to itself",
    () =>
      Effect.gen(function* () {
        const { root, seed, upstream, url } = yield* world(admitAll);
        const clone = `${root}/clone`;

        yield* gitOk(root, ...asClient, "clone", "--quiet", url, clone);

        expect(yield* gitOk(clone, "rev-parse", "HEAD")).toBe(
          yield* gitOk(seed, "rev-parse", "HEAD")
        );

        const second = yield* commit(seed, "second", { "b.txt": "b\n" });

        yield* gitOk(seed, "push", "--quiet", upstream, "HEAD:refs/heads/main");
        yield* gitOk(clone, ...asClient, "fetch", "--quiet");

        expect(yield* gitOk(clone, "rev-parse", "origin/main")).toBe(second);
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );

  it.live(
    "forwards a push custody admits, and the upstream takes it",
    () =>
      Effect.gen(function* () {
        const { root, upstream, url } = yield* world(admitAll);
        const clone = `${root}/clone`;

        yield* gitOk(root, "clone", "--quiet", url, clone);

        const answer = yield* commit(clone, "answer", { "b.txt": "b\n" });

        const pushed = yield* git(
          clone,
          "push",
          "origin",
          "HEAD:refs/heads/answer"
        );

        expect(pushed.exitCode).toBe(0);
        expect(yield* gitOk(upstream, "rev-parse", "refs/heads/answer")).toBe(
          answer
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );

  it.live(
    "forwards a push larger than git's post buffer, sent as a probe and then in chunks",
    () =>
      Effect.gen(function* () {
        const { root, upstream, url } = yield* world(admitAll);
        const clone = `${root}/clone`;

        yield* gitOk(root, "clone", "--quiet", url, clone);

        const answer = yield* commit(clone, "large", {
          "large.bin": noise(300_000),
        });

        const pushed = yield* git(
          clone,
          // git's smallest post buffer; a larger request is probed with an
          // empty one first, then streamed chunked.
          "-c",
          "http.postBuffer=65520",
          "push",
          "origin",
          "HEAD:refs/heads/large"
        );

        expect(pushed.exitCode).toBe(0);
        expect(yield* gitOk(upstream, "rev-parse", "refs/heads/large")).toBe(
          answer
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );

  it.live(
    "refuses a push before forwarding it, in git's own output",
    () =>
      Effect.gen(function* () {
        const stale = new StaleBase({
          base: CommitSha.make("1".repeat(40)),
          conflicts: [],
          main: CommitSha.make("2".repeat(40)),
        });

        const { root, upstream, url } = yield* world(
          refusing("refs/heads/main", [stale])
        );

        const clone = `${root}/clone`;

        yield* gitOk(root, "clone", "--quiet", url, clone);
        yield* commit(clone, "answer", { "b.txt": "b\n" });

        const before = yield* gitOk(upstream, "rev-parse", "main");
        const pushed = yield* git(clone, "push", "origin", "HEAD:main");

        expect(pushed.exitCode).toBe(1);
        expect(remoteLines(pushed.stderr)).toStrictEqual([
          "remote: StaleBase: main moved to 2222222, past your base 1111111, while this answer was checked; push again and the platform merges it onto the moved main",
          `remote:   next: git push ${Brand.slug} HEAD:main`,
          "remote:   retryable: yes",
        ]);
        expect(pushed.stderr).toContain(
          " ! [remote rejected] HEAD -> main (StaleBase)"
        );
        expect(yield* gitOk(upstream, "rev-parse", "main")).toBe(before);
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );

  it.live(
    "turns a whole push away when custody refuses one of its refs",
    () =>
      Effect.gen(function* () {
        const path = RepoPath.make("src/a.ts");

        const { root, upstream, url } = yield* world(
          refusing("refs/heads/main", [
            new OutOfScope({ paths: [path] }),
            new TouchedJudge({ paths: [path] }),
          ])
        );

        const clone = `${root}/clone`;

        yield* gitOk(root, "clone", "--quiet", url, clone);
        yield* commit(clone, "answer", { "b.txt": "b\n" });

        const before = yield* gitOk(upstream, "rev-parse", "main");

        const pushed = yield* git(
          clone,
          "push",
          "origin",
          "HEAD:main",
          "HEAD:refs/heads/answer"
        );

        expect(pushed.exitCode).toBe(1);
        expect(pushed.stderr).toContain(
          " ! [remote rejected] HEAD -> main (OutOfScope and 1 more)"
        );
        expect(pushed.stderr).toContain(
          " ! [remote rejected] HEAD -> answer (OutOfScope and 1 more)"
        );
        expect(yield* gitOk(upstream, "rev-parse", "main")).toBe(before);
        expect(
          (yield* git(upstream, "rev-parse", "--verify", "--quiet", "answer"))
            .exitCode
        ).toBe(1);
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );

  it.live(
    "refuses a push after the upstream took it, when custody's review says so",
    () =>
      Effect.gen(function* () {
        const outOfScope = new OutOfScope({
          paths: [RepoPath.make("src/a.ts")],
        });

        const { root, upstream, url } = yield* world(
          Custody.of({
            admit: () => Effect.succeed([]),
            review: () => Effect.succeed([outOfScope]),
          })
        );

        const clone = `${root}/clone`;

        yield* gitOk(root, "clone", "--quiet", url, clone);

        const answer = yield* commit(clone, "answer", { "b.txt": "b\n" });

        const pushed = yield* git(
          clone,
          "push",
          "origin",
          "HEAD:refs/heads/answer"
        );

        expect(pushed.exitCode).toBe(1);
        expect(remoteLines(pushed.stderr)).toContain(
          "remote: OutOfScope: changes paths outside the ask's territory: src/a.ts; put those files back, or flag the ask if the want needs them"
        );
        expect(pushed.stderr).toContain(
          " ! [remote rejected] HEAD -> answer (OutOfScope)"
        );
        expect(yield* gitOk(upstream, "rev-parse", "answer")).toBe(answer);
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );

  it.live(
    "names a ref the upstream found moved under the push StaleBase",
    () =>
      Effect.gen(function* () {
        const moved = yield* Ref.make(Option.none<string>());

        const { root, upstream, url } = yield* world(admitAll, (repos) =>
          Effect.gen(function* () {
            const tip = yield* commit(repos.seed, "moved", { "c.txt": "c\n" });

            yield* gitOk(
              repos.seed,
              "push",
              "--quiet",
              repos.upstream,
              "HEAD:refs/heads/main"
            );
            yield* Ref.set(moved, Option.some(tip));

            return Option.none();
          })
        );

        const clone = `${root}/clone`;

        yield* gitOk(root, "clone", "--quiet", url, clone);

        const base = yield* gitOk(clone, "rev-parse", "HEAD");

        yield* commit(clone, "answer", { "b.txt": "b\n" });

        const pushed = yield* git(clone, "push", "origin", "HEAD:main");
        const tip = Option.getOrThrow(yield* Ref.get(moved));

        expect(pushed.exitCode).toBe(1);
        expect(remoteLines(pushed.stderr).slice(-3)).toStrictEqual([
          `remote: StaleBase: main moved to ${tip.slice(0, 7)}, past your base ${base.slice(0, 7)}, while this answer was checked; push again and the platform merges it onto the moved main`,
          `remote:   next: git push ${Brand.slug} HEAD:main`,
          "remote:   retryable: yes",
        ]);
        expect(pushed.stderr).toContain(
          " ! [remote rejected] HEAD -> main (StaleBase)"
        );
        expect(yield* gitOk(upstream, "rev-parse", "main")).toBe(tip);
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );

  it.live(
    "names Artifacts' busy refusal RepoBusy",
    () =>
      Effect.gen(function* () {
        const { root, url } = yield* world(admitAll, () =>
          Effect.succeedSome(artifactsBusy())
        );

        const clone = `${root}/clone`;

        yield* gitOk(root, "clone", "--quiet", url, clone);
        yield* commit(clone, "answer", { "b.txt": "b\n" });

        const pushed = yield* git(
          clone,
          "push",
          "origin",
          "HEAD:refs/heads/answer"
        );

        expect(pushed.exitCode).toBe(1);
        expect(remoteLines(pushed.stderr)).toStrictEqual([
          "remote: RepoBusy: the repo was busy with another push",
          "remote:   next: git push",
          "remote:   retryable: yes",
        ]);
        expect(pushed.stderr).toContain(
          " ! [remote rejected] HEAD -> answer (RepoBusy)"
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );
});

describe(gitRoute, () => {
  it("reads a repo and git's endpoint from a smart HTTP path, and nothing else", () => {
    expect(
      [
        "/datekit.git/info/refs",
        "/datekit/git-upload-pack",
        "/datekit--parse-iso--alice.git/git-receive-pack",
        "/oscabriel/datekit.git/info/refs",
        "/github.com/pallets/click.git/info/refs",
        "/alice/notes--fix-week--bob.git/git-receive-pack",
        "/datekit.git/HEAD",
        "/a/b/c/d.git/info/refs",
        "/rpc",
      ].map(gitRoute)
    ).toStrictEqual([
      Option.some({
        endpoint: "info/refs",
        name: "datekit",
        repo: Option.some("datekit"),
      }),
      Option.some({
        endpoint: "git-upload-pack",
        name: "datekit",
        repo: Option.some("datekit"),
      }),
      Option.some({
        endpoint: "git-receive-pack",
        name: "datekit--parse-iso--alice",
        repo: Option.some("datekit--parse-iso--alice"),
      }),
      Option.some({
        endpoint: "info/refs",
        name: "oscabriel/datekit",
        repo: Option.some("datekit"),
      }),
      Option.some({
        endpoint: "info/refs",
        name: "github.com/pallets/click",
        repo: Option.some("click"),
      }),
      Option.some({
        endpoint: "git-receive-pack",
        name: "alice/notes--fix-week--bob",
        repo: Option.some("alice__notes--fix-week--bob"),
      }),
      Option.none(),
      Option.none(),
      Option.none(),
    ]);
  });

  // A one-segment address is a legacy key; any other bare word is no project's.
  it("names no repo for an address no project can have", () => {
    expect(gitRoute("/demo.git/info/refs")).toStrictEqual(
      Option.some({ endpoint: "info/refs", name: "demo", repo: Option.none() })
    );
  });
});
