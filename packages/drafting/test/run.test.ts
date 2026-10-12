import { describe, expect, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import { DraftResult } from "@repo/project/draft-runs";
import type { DraftContextData } from "@repo/project/draft-runs";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import { PublicPolicy } from "@repo/protocol/domain/policy";
import { ProposalId } from "@repo/protocol/ids";
import { IncompleteBrief } from "@repo/protocol/refusal";
import { aProject } from "@repo/testkit/scenarios";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer, Ref, Schema, Struct } from "effect";

import { DrafterMemory, DraftsAsked } from "../src/drafter/memory.ts";
import { DraftModel, runDraft } from "../src/run.ts";
import type { DraftSteps } from "../src/run.ts";

const scenario = aProject();

const proposal = ProposalId.make("prop-000001");

const withoutFix = Schema.decodeSync(PublicPolicy)(
  Schema.encodeSync(PublicPolicy)({
    ...Struct.omit(scenario.policy, ["asks", "functions", "visibility"]),
    kinds: scenario.policy.kinds.filter(({ name }) => name !== "fix"),
  })
);

const context: DraftContextData = {
  at: scenario.landed,
  paths: [],
  policy: withoutFix,
  project: scenario.project,
  proposal,
  round: 1,
  want: "Parse an ISO week date such as 2026-W41",
};

describe(runDraft, () => {
  it.effect(
    "settles Failed with IncompleteBrief, and never asks the drafter, when the project has no fix kind",
    () =>
      Effect.gen(function* () {
        const names = yield* Ref.make<readonly string[]>([]);

        const settled = yield* Ref.make<
          readonly (readonly [number, DraftResult])[]
        >([]);

        const steps: DraftSteps = {
          step: (name, _schema, effect) =>
            Effect.andThen(
              Ref.update(names, (all) => [...all, name]),
              effect
            ),
        };

        const api = untouchable<ProjectApi>("the project", {
          draftContext: () => Effect.succeed(context),
          draftSettled: (_proposal, round, result) =>
            Ref.update(settled, (all) => [...all, [round, result] as const]),
        });

        yield* runDraft(
          { project: scenario.project, proposal, round: 1 },
          steps
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Projects, {
                create: () => Effect.die("no project is made"),
                get: () => Effect.succeed(api),
              }),
              Layer.succeed(
                RepoHost,
                untouchable<RepoHost["Service"]>("RepoHost")
              ),
              Layer.succeed(DraftModel, "@cf/test/model")
            )
          )
        );

        expect({
          asked: yield* DraftsAsked.use(({ inputs }) => inputs),
          names: yield* Ref.get(names),
          settled: yield* Ref.get(settled),
        }).toStrictEqual({
          asked: [],
          names: ["context", "settle"],
          settled: [
            [
              1,
              DraftResult.cases.Failed.make({
                attempts: 1,
                model: "@cf/test/model",
                refusal: new IncompleteBrief({ missing: ["kinds.fix"] }),
              }),
            ],
          ],
        });
      }).pipe(Effect.provide(DrafterMemory([])))
  );
});
