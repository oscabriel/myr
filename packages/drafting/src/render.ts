/**
 * The ask file, written by code from a draft's fields (W9-D13): the model
 * never writes the `.ask.ts` source, so it cannot put code there. Every
 * string it gave enters the file through `JSON.stringify`, as a string
 * literal, and a field it left out (or gave empty) is left out. Only the
 * test file is the model's own text.
 */
import { Brand } from "@repo/brand";
import type { ConfigFile } from "@repo/protocol/domain/common";
import { RepoPath } from "@repo/protocol/ids";

import type { DraftedAsk } from "./drafted.ts";

const text = (value: string) => JSON.stringify(value);

const list = (values: readonly string[]) => `[${values.map(text).join(", ")}]`;

/** Each drafted kind's handle in the rules package: W9 drafts `fix` only. */
const kindHandle = { fix: "kinds.fix" } as const satisfies Record<
  DraftedAsk["kind"],
  string
>;

/**
 * The `.ask.ts` source for a draft: the rules import by the CLI package's
 * name, then `kinds.fix.ask({ … })` with its keys sorted.
 */
export const renderAskFile = (drafted: DraftedAsk): string => {
  const fields: readonly (readonly [string, string | undefined])[] = [
    [
      "context",
      drafted.context === undefined || drafted.context.length === 0
        ? undefined
        : list(drafted.context),
    ],
    [
      "current",
      drafted.current === undefined ? undefined : text(drafted.current),
    ],
    [
      "outOfScope",
      drafted.outOfScope === undefined || drafted.outOfScope.length === 0
        ? undefined
        : list(drafted.outOfScope),
    ],
    ["path", text(drafted.test.path)],
    ["territory", `territory.paths(${drafted.territory.map(text).join(", ")})`],
    ["want", text(drafted.want)],
  ];

  return [
    `import { kinds, territory } from ${text(`${Brand.cliPackage}/rules`)};`,
    "",
    `export default ${kindHandle[drafted.kind]}.ask({`,
    ...fields.flatMap(([key, value]) =>
      value === undefined ? [] : [`  ${key}: ${value},`]
    ),
    "});",
    "",
  ].join("\n");
};

/**
 * A draft as a proposal's files: its ask file under the config folder's
 * `asks/`, named by its id (what `askIdOf` reads back), then its test.
 */
export const draftedFiles = (
  drafted: DraftedAsk
): readonly [ConfigFile, ConfigFile] => [
  {
    content: renderAskFile(drafted),
    path: RepoPath.make(`${Brand.configDir}/asks/${drafted.id}.ask.ts`),
  },
  { content: drafted.test.source, path: drafted.test.path },
];
