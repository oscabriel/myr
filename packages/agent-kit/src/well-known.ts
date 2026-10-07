/**
 * `/.well-known/agent-skills/index.json`: the skills index the `skills` CLI
 * reads (discovery schema 0.2.0), so `npx skills add <platform>` finds every
 * project's contribute skill. Each entry names a skill, says what it is for,
 * where its `SKILL.md` is served and the SHA-256 of that file's bytes.
 */
import { Array as Arr, Effect, Order } from "effect";

import { contentHash } from "./generated-file.ts";
import type { GeneratedFile } from "./generated-file.ts";
import { printJson } from "./text.ts";

/** One skill the index lists: its file's text, to digest, and where it is served. */
export interface SkillEntry {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly content: string;
}

const DISCOVERY = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

/** The most characters an entry's description may have. */
const DESCRIBED = 1024;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * A description cut to the limit with an ellipsis, whole characters only:
 * at most 1024 UTF-16 units, so at most 1024 characters however a reader
 * counts them.
 */
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

/** The index, its entries sorted by name. Its path is served from the platform's root. */
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
