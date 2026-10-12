import { Brand } from "@repo/brand";

import type { CommandDoc } from "../command-doc.ts";
import { code, page } from "../text.ts";
import type { DocEntry, DocSlug } from "./entries.ts";

export interface DocInput {
  readonly commands: readonly CommandDoc[];
  readonly platformUrl: string;
  readonly webUrl: string;
}

export interface DocPage extends DocEntry {
  readonly markdown: string;
}

export interface DocSource {
  readonly slug: DocSlug;
  readonly body: (input: DocInput) => readonly string[];
}

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

export const cli = (words: string) => code(`${Brand.cli} ${words}`);

export const shell = (...lines: readonly string[]) => [
  "```sh",
  ...lines,
  "```",
];

export const withoutHeading = (lines: readonly string[]) => {
  const [first, blank, ...rest] = lines;

  return first?.startsWith("## ") === true && blank === "" ? rest : lines;
};
