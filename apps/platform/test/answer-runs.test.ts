/**
 * The instance ids the `Answer` Workflow's runs take. The engine refuses an
 * id past 100 characters, and starting an id that exists changes nothing, so
 * two runs that must both happen need two ids however long their names are.
 */
import { describe, expect, it } from "@effect/vitest";
import { CommitSha, LayerName, ProjectName } from "@repo/protocol/ids";

import { AdmissionParams, admissionId } from "../src/answer-runs.ts";

/** What the engine takes as an instance id. */
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
    ).toBe(`admit-alice_datekit-maintainers-${"a".repeat(40)}`);
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
