import { describe, expect, it } from "@effect/vitest";

import { examples } from "../../../scripts/lib/import/plan.ts";
import { importedProjects } from "../../agent-kit/src/docs/imported.ts";

describe("the docs' imported projects", () => {
  it("are the import plan's, by name and key, with their sources and licences", () => {
    expect(importedProjects).toStrictEqual(
      examples.map(({ key, kind, licence, name, url }) => ({
        key,
        kind,
        licence,
        name,
        url,
      }))
    );
  });
});
