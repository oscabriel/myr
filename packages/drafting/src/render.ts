// The model never writes the `.ask.ts` source: every string it gave enters the
// file through `JSON.stringify`, as a string literal. Only the test file is
// the model's own text.
import { Brand } from "@repo/brand";
import type { ConfigFile } from "@repo/protocol/domain/common";
import { RepoPath } from "@repo/protocol/ids";

import type { DraftedAsk } from "./drafted.ts";

const text = (value: string) => JSON.stringify(value);

const list = (values: readonly string[]) => `[${values.map(text).join(", ")}]`;

const kindHandle = { fix: "kinds.fix" } as const satisfies Record<
  DraftedAsk["kind"],
  string
>;

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

export const draftedFiles = (
  drafted: DraftedAsk
): readonly [ConfigFile, ConfigFile] => [
  {
    content: renderAskFile(drafted),
    path: RepoPath.make(`${Brand.configDir}/asks/${drafted.id}.ask.ts`),
  },
  { content: drafted.test.source, path: drafted.test.path },
];
