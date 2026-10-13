/**
 * A project's one line, read from its README on main: the first paragraph of
 * prose, its markup dropped, cut to the cap. A project's config has no field
 * for it, so the README is the one source. A list reads it with the count of
 * landings the project's record keeps, and keeps both until the next landing.
 */
import type { RepoHost, RepoNotFound } from "@repo/artifacts/repo-host";
import {
  PROJECT_DESCRIPTION_CAP,
  ProjectDescription,
} from "@repo/protocol/domain/front-page";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { ProjectName } from "@repo/protocol/ids";
import type { UnknownPath, UnknownRevision } from "@repo/protocol/refusal";
import {
  Array as Arr,
  Cause,
  Context,
  DateTime,
  Effect,
  Option,
  Schema,
} from "effect";

import { codeProjectOf, treeOf } from "./code.ts";
import type { CodeProject } from "./code.ts";
import { contentsOf } from "./code/file.ts";
import type { ProjectApi } from "./project.ts";

const FENCE = /^\s{0,3}(?:`{3,}|~{3,})/u;

const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/u;

const RULE = /^\s{0,3}(?:[=\-~^*#+_]\s*){3,}$/u;

const SETEXT = /^\s{0,3}(?:=+|-+)\s*$/u;

const INDENTED = /^(?: {4}|\t)/u;

const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s/u;

const TABLE = /^\s*\|/u;

const DEFINITION = /^\s{0,3}\[[^\]]+\]:\s/u;

const DIRECTIVE = /^\.\.(?:\s|$)/u;

const QUOTE = /^\s{0,3}>\s?/u;

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
  ["&apos;", "'"],
  ["&nbsp;", " "],
]);

const decodeDescription = Schema.decodeOption(ProjectDescription);

/** The blocks between blank lines, with fenced code and HTML comments left out. */
const blocksOf = (text: string): readonly (readonly string[])[] => {
  const blocks: string[][] = [];
  let current: string[] = [];
  let fenced = false;

  const close = () => {
    if (current.length > 0) {
      blocks.push(current);
    }

    current = [];
  };

  const uncommented = text.replaceAll(/<!--[\s\S]*?-->/gu, "");

  for (const line of uncommented.split(/\r?\n/u)) {
    if (FENCE.test(line)) {
      close();
      fenced = !fenced;
    } else if (!fenced) {
      if (line.trim() === "") {
        close();
      } else {
        current.push(line);
      }
    }
  }

  close();

  return blocks;
};

/** The block's lines of prose, its headings, rules and titles' underlines dropped. */
const proseOf = (block: readonly string[]): readonly string[] => {
  const [first = ""] = block;

  if (
    INDENTED.test(first) ||
    LIST_ITEM.test(first) ||
    TABLE.test(first) ||
    DIRECTIVE.test(first)
  ) {
    return [];
  }

  const kept: string[] = [];

  for (const line of block) {
    if (SETEXT.test(line) || RULE.test(line)) {
      // The line above an underline is a title.
      kept.pop();
    } else if (!HEADING.test(line) && !DEFINITION.test(line)) {
      kept.push(line.replace(QUOTE, ""));
    }
  }

  return kept;
};

const plainOf = (markup: string): string =>
  markup
    .replaceAll(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/gu, "")
    .replaceAll(/\[(?<text>[^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/gu, "$<text>")
    .replaceAll(/<[^>]*>/gu, " ")
    .replaceAll(/&(?:[a-z]+|#\d+);/gu, (entity) => ENTITIES.get(entity) ?? " ")
    .replaceAll(/\*\*|__|`+/gu, "")
    .replaceAll(/(?<lead>^|[\s(])[*_](?=\S)/gu, "$<lead>")
    .replaceAll(/(?<=\S)[*_](?=[\s).,;:!?]|$)/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** At most the cap, cut at a word with an ellipsis when it runs over. */
const capped = (line: string): string => {
  if (line.length <= PROJECT_DESCRIPTION_CAP) {
    return line;
  }

  const room = line.slice(0, PROJECT_DESCRIPTION_CAP);
  const word = room.lastIndexOf(" ");

  // With no space, drop the last character whole, never half of a surrogate pair or an emoji's sequence.
  const cut =
    word > 0
      ? room.slice(0, word)
      : room.slice(0, [...graphemes.segment(room)].at(-1)?.index ?? 0);

  return `${cut.replace(/[\s,;:.!?-]+$/u, "")}…`;
};

/** None when the README holds no paragraph of prose. */
export const descriptionOf = (
  readme: string
): Option.Option<ProjectDescription> => {
  for (const block of blocksOf(readme)) {
    const plain = plainOf(proseOf(block).join(" "));

    if (/[\p{L}\p{N}]/u.test(plain)) {
      return decodeDescription(capped(plain));
    }
  }

  return Option.none();
};

/**
 * What a list read of a landed project, and the landing it read at: the
 * description from the README on main, and how many landings the project's
 * record keeps. Both move only by a landing.
 */
export interface KeptDescription {
  readonly landedAt: DateTime.Utc;
  readonly landings: number;
  readonly description?: ProjectDescription;
}

/** Where a list reads a landed project: its main, and its record's count of landings. */
export interface LandedProject {
  readonly code: CodeProject;
  readonly landingCount: Effect.Effect<number>;
}

export const landedProjectOf = (
  api: ProjectApi,
  project: ProjectName
): LandedProject => ({
  code: codeProjectOf(api, project),
  landingCount: api.landingCount(),
});

export interface ProjectDescriptionsApi {
  readonly get: (
    projects: readonly ProjectName[]
  ) => Effect.Effect<ReadonlyMap<ProjectName, KeptDescription>>;
  readonly put: (
    entries: ReadonlyMap<ProjectName, KeptDescription>
  ) => Effect.Effect<void>;
}

/** The default keeps nothing, so every list reads each landed project's README. */
export const ProjectDescriptions = Context.Reference<ProjectDescriptionsApi>(
  "project/ProjectDescriptions",
  {
    defaultValue: () => ({
      get: () => Effect.succeed(new Map()),
      put: () => Effect.void,
    }),
  }
);

const READS_AT_ONCE = 8;

const orWarn = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  fallback: A,
  warning: string
): Effect.Effect<A, never, R> =>
  Effect.catchCause(effect, (cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.interrupt
      : Effect.as(Effect.logWarning(warning, cause), fallback)
  );

const readmeDescription = (
  code: CodeProject
): Effect.Effect<
  Option.Option<ProjectDescription>,
  UnknownRevision | UnknownPath | RepoNotFound,
  RepoHost
> =>
  Effect.gen(function* () {
    const { readme } = yield* treeOf(code, Option.none(), Option.none());

    if (readme === undefined) {
      return Option.none();
    }

    const contents = yield* contentsOf(code.repo, readme.sha);

    return Option.flatMap(
      Option.flatMap(contents, ({ text }) => text),
      descriptionOf
    );
  });

const sameLanding = (
  kept: KeptDescription,
  landedAt: DateTime.Utc | undefined
) => landedAt !== undefined && DateTime.Equivalence(kept.landedAt, landedAt);

const keptOf = (
  landedAt: DateTime.Utc,
  landings: number,
  description: Option.Option<ProjectDescription>
): KeptDescription =>
  Option.match(description, {
    onNone: () => ({ landedAt, landings }),
    onSome: (found) => ({ description: found, landedAt, landings }),
  });

const readLanded = (
  { code, landingCount }: LandedProject,
  landedAt: DateTime.Utc
) =>
  Effect.map(
    Effect.all([readmeDescription(code), landingCount]),
    ([description, landings]) => keptOf(landedAt, landings, description)
  );

const listedWith = (
  listing: ProjectListing,
  { description, landings }: KeptDescription
): ProjectListing =>
  description === undefined
    ? { ...listing, landings }
    : { ...listing, description, landings };

/**
 * Main and the count of landings move only by a landing, so what a list read
 * while a project's last landing stands is kept until the next one. A project
 * not yet landed has no main to read.
 */
export const withDescriptions = <E>(
  listed: readonly ProjectListing[],
  landedOf: (project: ProjectName) => Effect.Effect<LandedProject, E>
): Effect.Effect<readonly ProjectListing[], never, RepoHost> =>
  Effect.gen(function* () {
    const landed = listed.flatMap(({ landedAt, project }) =>
      landedAt === undefined ? [] : [{ landedAt, project }]
    );

    if (landed.length === 0) {
      return listed;
    }

    const store = yield* ProjectDescriptions;

    const kept = yield* orWarn(
      Effect.suspend(() =>
        store.get(Arr.dedupe(landed.map(({ project }) => project)))
      ),
      new Map<ProjectName, KeptDescription>(),
      "the kept descriptions were not read: every landed project is read"
    );

    const stale = landed.filter(({ landedAt, project }) => {
      const entry = kept.get(project);

      return entry === undefined || !sameLanding(entry, landedAt);
    });

    const read = yield* Effect.forEach(
      stale,
      ({ landedAt, project }) =>
        orWarn(
          Effect.suspend(() => landedOf(project)).pipe(
            Effect.flatMap((source) => readLanded(source, landedAt)),
            Effect.map((entry) => Option.some([project, entry] as const))
          ),
          Option.none(),
          `${project} was not read: it is listed with no description and no count of landings`
        ),
      { concurrency: READS_AT_ONCE }
    );

    const found = new Map<ProjectName, KeptDescription>(Arr.getSomes(read));

    if (found.size > 0) {
      yield* orWarn(
        Effect.suspend(() => store.put(found)),
        undefined,
        "the descriptions read were not kept"
      );
    }

    return listed.map((listing): ProjectListing => {
      const entry = found.get(listing.project) ?? kept.get(listing.project);

      return entry === undefined || !sameLanding(entry, listing.landedAt)
        ? listing
        : listedWith(listing, entry);
    });
  });
