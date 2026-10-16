// The engine refuses an instance id past 100 characters, and starting an id that
// exists changes nothing.
import { describe, expect, it } from "@effect/vitest";
import { AnswerRuns } from "@repo/project/answer-runs";
import type { AnswerQueue } from "@repo/project/answer-runs";
import {
  CommitSha,
  LayerName,
  ProjectName,
  RequestId,
} from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect } from "effect";

import { AnswerRunsWorkflow } from "../src/adapters/answer-runs-workflow.ts";
import type { AnswerWorkflow } from "../src/adapters/answer-runs-workflow.ts";
import { AdmissionParams, admissionId } from "../src/answer-runs.ts";

const INSTANCE_ID = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/u;

describe("an admission's instance", () => {
  it("is the project, layer and head, whole, when they fit", () => {
    expect(
      admissionId(
        AdmissionParams.make({
          head: CommitSha.make("a".repeat(40)),
          layer: LayerName.make("maintainers"),
          project: ProjectName.make("alice/datekit"),
        })
      )
    ).toBe(`admit-alice__datekit-maintainers-${"a".repeat(40)}`);
  });

  it("keeps each pushed head its own instance under a long project and layer name, within the engine's 100 characters", () => {
    const project = ProjectName.make(
      `alice/${"a-long-project-name".repeat(3)}x`
    );

    const layer = LayerName.make("maintainers-of-the-sealed-suites");

    const heads = [
      CommitSha.make(`${"1".repeat(39)}a`),
      CommitSha.make(`${"1".repeat(39)}b`),
    ];

    const ids = heads.map((head) =>
      admissionId(AdmissionParams.make({ head, layer, project }))
    );

    expect({
      distinct: new Set(ids).size,
      fit: ids.every((id) => id.length <= 100 && INSTANCE_ID.test(id)),
      named: heads.every((head, at) => (ids[at] ?? "").endsWith(`-${head}`)),
    }).toStrictEqual({ distinct: 2, fit: true, named: true });
  });
});

describe("an answer's run on the Workflow binding", () => {
  it.effect(
    "disposes what the binding gives back: a new run, and a taken run's instance and status",
    () =>
      Effect.gen(function* () {
        const disposals: string[] = [];
        const started = new Set<string>();

        // The runtime gives each object an RPC call returns a disposer of its
        // own, which holds the far side's call open until it is called.
        const disposable = <X extends object>(value: X, name: string): X =>
          Object.defineProperty(value, Symbol.dispose, {
            enumerable: false,
            value: () => {
              disposals.push(name);
            },
          });

        const workflow: AnswerWorkflow = {
          create: ({ id }) => {
            if (started.has(id)) {
              return Promise.reject(new Error("the id is taken"));
            }

            started.add(id);

            return Promise.resolve(disposable({ id }, "create"));
          },
          get: (id) =>
            Promise.resolve(
              disposable(
                {
                  id,
                  restart: () => Promise.resolve(),
                  status: () =>
                    Promise.resolve(
                      disposable({ status: "complete" as const }, "status")
                    ),
                },
                "get"
              )
            ),
        };

        const runs = yield* AnswerRuns.pipe(
          Effect.provide(
            AnswerRunsWorkflow(workflow, ProjectName.make("alice/datekit"))
          )
        );

        const requestId = RequestId.make("request-0001");
        const queue = untouchable<AnswerQueue>("AnswerQueue");

        yield* runs.start(requestId, queue);
        yield* runs.start(requestId, queue);

        expect(disposals).toStrictEqual(["create", "status", "get"]);
      })
  );
});
