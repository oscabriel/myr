// The protocol's table is written by hand, so a Worker never imports a
// script; this holds it to its sources, the examples' folders and the import plan.
import { describe, expect, it } from "@effect/vitest";

import { examples } from "../../../scripts/lib/import/plan.ts";
import { EXAMPLES } from "../../../scripts/seed.ts";
import { legacyProjects } from "../../protocol/src/legacy.ts";

const seeded = EXAMPLES.map((folder) => {
  const key = folder.slice(folder.lastIndexOf("/") + 1);

  return { key, name: `oscabriel/${key}` };
});

const imports = examples.map(({ key, name }) => ({ key, name }));

describe("the projects made before owners", () => {
  it("are the two examples, then the import plan's, each by its key and its name", () => {
    expect(legacyProjects).toStrictEqual([...seeded, ...imports]);
  });

  it("are forty, each key and each name once", () => {
    expect(legacyProjects).toHaveLength(40);
    expect(new Set(legacyProjects.map(({ key }) => key)).size).toBe(40);
    expect(new Set(legacyProjects.map(({ name }) => name)).size).toBe(40);
  });
});
