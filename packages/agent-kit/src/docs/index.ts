/**
 * The docs: five guides written for people doing one job, then the
 * reference, read from the sources that define it. Each page is pure
 * Markdown for the CLI's commands and the two hosts' URLs; the web draws
 * it at `/docs/<slug>` and serves the text at `/docs/<slug>.md`.
 */
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

/** Every page, guides first, in the order the index lists them. */
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

/** Every page, written for `input`. */
export const docPages = (input: DocInput): readonly DocPage[] =>
  sources.flatMap((source) =>
    Option.toArray(
      Option.map(docEntry(source.slug), (entry) =>
        written(entry, source, input)
      )
    )
  );

/** The page at `slug`, written for `input`; none for a slug no page has. */
export const docPage = (
  input: DocInput,
  slug: string
): Option.Option<DocPage> =>
  Option.flatMap(
    Option.fromUndefinedOr(sources.find((source) => source.slug === slug)),
    (source) =>
      Option.map(docEntry(slug), (entry) => written(entry, source, input))
  );
