/**
 * The docs' list of imported projects is a copy of the import script's
 * plan, kept in `@repo/agent-kit` (the web cannot import a script): each
 * project by its name and key, with its source, its licence and what it
 * is, in the plan's order.
 */
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
