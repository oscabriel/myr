/**
 * One page of the docs, and what every page is written from: the CLI's
 * commands and the two hosts' URLs. A page is a title, a one-line summary
 * and its body; its Markdown opens with the title and the summary.
 */
import { Brand } from "@repo/brand";

import type { CommandDoc } from "../command-doc.ts";
import { code, page } from "../text.ts";
import type { DocEntry, DocSlug } from "./entries.ts";

/** What every page is written from. */
export interface DocInput {
  readonly commands: readonly CommandDoc[];
  readonly platformUrl: string;
  readonly webUrl: string;
}

/** One page as the web serves it. */
export interface DocPage extends DocEntry {
  readonly markdown: string;
}

/** One page before it is written: its slug, and its body's lines from the input. */
export interface DocSource {
  readonly slug: DocSlug;
  readonly body: (input: DocInput) => readonly string[];
}

/** `source` written for `input`, under what names it. */
export const written = (
  entry: DocEntry,
  source: DocSource,
  input: DocInput
): DocPage => ({
  ...entry,
  markdown: page([
    `# ${entry.title}`,
    "",
    entry.summary,
    "",
    ...source.body(input),
  ]),
});

/** A command as typed, in a code span: `<cli> claim <ask> --project <project>`. */
export const cli = (words: string) => code(`${Brand.cli} ${words}`);

/** A block of shell commands. */
export const shell = (...lines: readonly string[]) => [
  "```sh",
  ...lines,
  "```",
];

/** A section's lines without its own `## ` heading, for a page that is that section. */
export const withoutHeading = (lines: readonly string[]) => {
  const [first, blank, ...rest] = lines;

  return first?.startsWith("## ") === true && blank === "" ? rest : lines;
};
