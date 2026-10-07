import { describe, expect, it } from "@effect/vitest";
import {
  AskId,
  CommitSha,
  DecisionId,
  EnvKey,
  Handle,
  ProjectName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import {
  ImportFailed,
  NotDecider,
  UnknownProject,
} from "@repo/protocol/refusal";
import { Effect, Layer, Redacted, Stream } from "effect";

import { MemorySessions } from "../src/sessions/memory.ts";
import { Vacant } from "../src/vacant.ts";
import { rpcClient, served } from "./harness.ts";

const project = ProjectName.make("datekit");

const ask = AskId.make("iso-week");

const base = CommitSha.make("1111111111111111111111111111111111111111");

const head = CommitSha.make("3333333333333333333333333333333333333333");

const requestId = RequestId.make("answer-0001");

const unknown = new UnknownProject({ project });

/** The platform before any project exists, called over `/rpc` as alice. */
const asAlice = Effect.gen(function* () {
  const { handler } = yield* served(
    Layer.mergeAll(
      Vacant,
      MemorySessions.layer({ "alice-token": Handle.make("alice") })
    )
  );

  return yield* rpcClient(handler, "alice-token");
});

describe("the platform before any project exists", () => {
  it.effect("lists nothing: no projects, no open asks, no credits", () =>
    Effect.gen(function* () {
      const client = yield* asAlice;

      expect(yield* client.listProjects({})).toStrictEqual({ projects: [] });
      expect(yield* client.frontPage({})).toStrictEqual({ entries: [] });
      expect(
        yield* client.credits({ handle: Handle.make("alice") })
      ).toStrictEqual({ credits: [] });
      expect(yield* client.status({})).toStrictEqual({
        answers: [],
        claims: [],
      });
    })
  );

  it.effect("knows no project a read or a write names", () =>
    Effect.gen(function* () {
      const client = yield* asAlice;

      const refusals = yield* Effect.all([
        Effect.flip(client.listAsks({ project })),
        Effect.flip(client.showAsk({ ask, project })),
        Effect.flip(client.status({ project })),
        Effect.flip(client.verdict({ ask, project })),
        Effect.flip(client.landing({ project, sha: base })),
        Effect.flip(client.today({ project })),
        Effect.flip(client.ledger({ project })),
        Effect.flip(client.envShape({ project })),
        Effect.flip(
          client.openAsk({
            ask,
            files: [
              {
                content: "export default {};\n",
                path: RepoPath.make("config/asks/iso-week.ask.ts"),
              },
            ],
            project,
          })
        ),
        Effect.flip(client.proposeAsk({ project, want: "Parse ISO weeks." })),
        Effect.flip(
          client.flagAsk({ ask, project, reason: "The want names a file." })
        ),
        Effect.flip(
          client.decide({
            choice: "accept",
            decision: DecisionId.make("dec-000001"),
            project,
          })
        ),
        Effect.flip(client.claim({ ask, project })),
        Effect.flip(client.release({ ask, project })),
        Effect.flip(
          client.submitAnswer({ ask, base, head, project, requestId })
        ),
        Effect.flip(client.finish({ ask, base, head, project, requestId })),
        Effect.flip(
          client.land({ base, head, message: "Tidy", project, requestId })
        ),
        Effect.flip(client.fork({ project })),
        Effect.flip(
          client.vouch({
            handle: Handle.make("dave"),
            project,
            verdict: "vouch",
          })
        ),
        Effect.flip(
          client.setEnv({
            key: EnvKey.make("PAYMENTS_KEY"),
            project,
            value: Redacted.make("sk_live_0123456789abcdef0123456789"),
          })
        ),
      ]);

      expect(refusals).toStrictEqual(refusals.map(() => unknown));
      expect(refusals).toHaveLength(20);
    })
  );

  it.effect("decides nothing for a caller who names no project", () =>
    Effect.gen(function* () {
      const client = yield* asAlice;

      expect(yield* Effect.flip(client.today({}))).toStrictEqual(
        new NotDecider({})
      );
    })
  );

  it.effect("can't make a project yet", () =>
    Effect.gen(function* () {
      const client = yield* asAlice;

      expect(yield* Effect.flip(client.initProject({ project }))).toStrictEqual(
        new ImportFailed({ reason: "no platform behind this surface yet" })
      );
    })
  );

  it.effect("streams nothing to a watcher", () =>
    Effect.gen(function* () {
      const client = yield* asAlice;

      expect(yield* Stream.runCollect(client.watch({ project }))).toStrictEqual(
        []
      );
    })
  );
});
