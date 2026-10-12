import { Option } from "effect";

import { answerAnAsk } from "./answer-an-ask.ts";
import { connectAnAgent } from "./connect-an-agent.ts";
import { docEntry } from "./entries.ts";
import { heldBackChecks } from "./held-back-checks.ts";
import type { DocInput, DocPage, DocSource } from "./page.ts";
import { written } from "./page.ts";
import {
  commandsPage,
  eventsPage,
  gitPage,
  importedPage,
  landingPage,
  mcpPage,
  refusalsPage,
} from "./reference.ts";
import { runAProject } from "./run-a-project.ts";
import { startHere } from "./start-here.ts";

export { docEntries, docEntry } from "./entries.ts";

export type { DocEntry, DocPart, DocSlug } from "./entries.ts";

export type { DocInput, DocPage } from "./page.ts";

const sources: readonly DocSource[] = [
  startHere,
  answerAnAsk,
  runAProject,
  heldBackChecks,
  connectAnAgent,
  commandsPage,
  refusalsPage,
  gitPage,
  landingPage,
  eventsPage,
  mcpPage,
  importedPage,
];

export const docPages = (input: DocInput): readonly DocPage[] =>
  sources.flatMap((source) =>
    Option.toArray(
      Option.map(docEntry(source.slug), (entry) =>
        written(entry, source, input)
      )
    )
  );

export const docPage = (
  input: DocInput,
  slug: string
): Option.Option<DocPage> =>
  Option.flatMap(
    Option.fromUndefinedOr(sources.find((source) => source.slug === slug)),
    (source) =>
      Option.map(docEntry(slug), (entry) => written(entry, source, input))
  );
