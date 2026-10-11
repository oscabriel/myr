/**
 * The gateway reads a project's address as the web does (ADR 0032): the
 * full name, `<owner>/<name>` or `<host>/<account>/<name>`, with a fork's
 * parts after it, and the key a project kept from before owners. Each
 * reaches the repo the project's key names in the store; an address no
 * project can have reaches none.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Fetch } from "@repo/artifacts/fetch";
import { ProjectName } from "@repo/protocol/ids";
import { gitOk } from "@repo/testkit/git";
import { aProject } from "@repo/testkit/scenarios";
import { Effect, Ref } from "effect";

import { WorkerFetch } from "../src/adapters/fetch.ts";
import { gatewayWorld, tokens } from "./gateway.fixtures.ts";

const scenario = aProject({ name: ProjectName.make("oscabriel/datekit") });

/** Bare repos in the store, by the names the platform keeps them under. */
const STORED = ["datekit", "click", "datekit--fix-week--alice"] as const;

/** A world whose store holds `STORED`, each an empty bare repo. */
const withStored = Effect.gen(function* () {
  const world = yield* gatewayWorld([scenario]);

  yield* Effect.forEach(
    STORED,
    (name) => gitOk(world.repos, "init", "--quiet", "--bare", `${name}.git`),
    { discard: true }
  );

  return world;
});

/**
 * The status of a clone's first request at `address`, as alice: a fork is
 * read only by its claimant, so the gateway asks anyone else to sign in
 * before it looks the repo up.
 */
const statusAt = (origin: string, address: string) =>
  Fetch.use(({ fetch }) =>
    fetch(
      new Request(
        `${origin}/${address}.git/info/refs?service=git-upload-pack`,
        { headers: { authorization: `Basic ${btoa(`x:${tokens.alice}`)}` } }
      )
    )
  ).pipe(
    Effect.map((response) => response.status),
    Effect.orDie,
    Effect.provide(WorkerFetch)
  );

describe("an address at the gateway", () => {
  it.live(
    "reaches the repo its project's key names, by full name, source path, legacy key or fork",
    () =>
      Effect.gen(function* () {
        const { origin, seen } = yield* withStored;

        const statuses = yield* Effect.forEach(
          [
            "oscabriel/datekit",
            "github.com/pallets/click",
            "datekit",
            "oscabriel/datekit--fix-week--alice",
          ],
          (address) => statusAt(origin, address)
        );

        const served = (yield* Ref.get(seen.upstream)).map(
          ({ path }) => path.split("/").at(-3) ?? path
        );

        expect(statuses).toStrictEqual([200, 200, 200, 200]);
        expect(served).toStrictEqual([
          "datekit.git",
          "click.git",
          "datekit.git",
          "datekit--fix-week--alice.git",
        ]);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "reaches nothing for an owner alone or a name under a page's word",
    () =>
      Effect.gen(function* () {
        const { origin } = yield* withStored;

        const statuses = yield* Effect.forEach(
          ["oscabriel", "docs/foo"],
          (address) => statusAt(origin, address)
        );

        expect(statuses).toStrictEqual([404, 404]);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );
});
