import { Brand } from "@repo/brand";

import { code } from "../text.ts";
import type { DocSource } from "./page.ts";
import { cli } from "./page.ts";

const dir = Brand.configDir;

export const heldBackChecks: DocSource = {
  body: () => [
    "Everything a project ships is public. What a project may keep back is typed: declared in its config folder, counted in a ledger anyone can read, and summed up in a posture every list shows.",
    "",
    "## Layers",
    "",
    "A layer is a separate repo holding one audience's files (the maintainers, a security group, the claimants), laid over `main`'s paths only for the people who may read it. Nothing from a layer ever enters a public tree: the platform lands an answer's own tree, never the tree a layer's reader sees, and a push from a fork cannot carry a layer's paths. Every read of a layer is logged.",
    "",
    `Each layer says what everyone else learns of it, its disclosure: \`public\`, \`sealed\`, \`counted\`, \`declared\`, \`hidden\` or \`writeOnly\`. Layers are declared in ${code(`${dir}/visibility.ts`)}:`,
    "",
    "```ts",
    `import { flows, layer, sealedChecks, visibility } from "${Brand.cliPackage}/rules";`,
    "",
    "export default visibility({",
    "  checks: sealedChecks({",
    "    admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },",
    '    areas: { export: "src/format.ts", parser: "src/parse.ts" },',
    "  }),",
    "  flows: flows.noWriteDown(),",
    "  layers: {",
    '    maintainers: layer({ disclose: "sealed", holds: ["checks"], reason: "Held-back checks for export and parser" }),',
    "  },",
    '  notice: { narrowing: "7 days" },',
    "});",
    "```",
    "",
    "## Held-back checks",
    "",
    "A held-back check lives in the maintainers' layer and runs on every answer, after everything else is sealed off: no network, and the snapshot taken before its files are written. The answerer learns one bit per area (this area passed, or it failed) and nothing of the check itself. A new check joins the suite only after it passes `main` several times and fails on a known-bad tree.",
    "",
    "Each landing a held-back suite judged carries a `Held-back:` trailer with the suite's salted commitment, so anyone can later confirm which suite judged it once the checks are released.",
    "",
    "## Posture and the ledger",
    "",
    "The platform computes a project's posture from its visibility config as it stands: Open, Open with sealed evidence, Open on schedule, Open core, or Source available. A narrowing stands only once a maintainer accepts it and its notice has run out.",
    "",
    `The ledger is the public, append-only record of a project's layers, their counts, commitments, releases and posture changes. Its page is on the web under each project, and ${cli("ledger --project <owner>/<name>")} prints it. Content moves to a wider audience only by a release: a typed, credited landing that cannot be undone.`,
    "",
    "## The env shape and write-only values",
    "",
    `A project's environment is described by its committed ${code(".env.schema")}, in the format varlock reads. The platform parses it from the landed commit and never resolves it; the Environment on the project's Visibility tab and ${cli("env shape --project <owner>/<name>")} show it, and who set each value, never a value.`,
    "",
    `A maintainer sets a value for a \`@sensitive\` item from stdin: ${cli("env set <key> --project <owner>/<name>")}. Nobody can read it back. An answer's code sees a placeholder; for a \`@proxy\` item the platform swaps the placeholder for the real value on matching outbound HTTPS requests.`,
    "",
  ],
  slug: "held-back-checks",
};
