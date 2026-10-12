import { Array as Arr, Effect, Order } from "effect";

import { contentHash } from "./generated-file.ts";
import type { GeneratedFile } from "./generated-file.ts";
import { printJson } from "./text.ts";

export interface SkillEntry {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly content: string;
}

const DISCOVERY = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

const DESCRIBED = 1024;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

const cut = (description: string) => {
  if (description.length <= DESCRIBED) {
    return description;
  }

  let kept = "";

  for (const { segment } of graphemes.segment(description)) {
    if (kept.length + segment.length > DESCRIBED - 1) {
      break;
    }

    kept += segment;
  }

  return `${kept}…`;
};

const byName = Order.mapInput(Order.String, (entry: SkillEntry) => entry.name);

export const wellKnownSkills = (
  entries: readonly SkillEntry[]
): Effect.Effect<GeneratedFile> =>
  Effect.forEach(Arr.sort(entries, byName), (entry) =>
    contentHash(entry.content).pipe(
      Effect.map((digest) => ({
        description: cut(entry.description),
        digest,
        name: entry.name,
        type: "skill-md",
        url: entry.url,
      }))
    )
  ).pipe(
    Effect.map((skills) => ({
      content: printJson({ $schema: DISCOVERY, skills }),
      path: ".well-known/agent-skills/index.json",
    }))
  );
