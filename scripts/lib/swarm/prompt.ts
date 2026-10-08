/**
 * The brief each contributor's harness starts with. It is zero-install: it
 * says only what a contributor gets from the ask's page and the project's
 * AGENTS.md (where their clone is, make the check pass, push, read the
 * verdict with `<cli> status`), and nothing about how the platform judges
 * an answer.
 */
import { Brand } from "@repo/brand";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";

/** The brief for one contributor's ask: the ask's page between what to do. */
export const brief = (input: {
  readonly ask: AskId;
  readonly project: ProjectName;
  readonly remote: string;
  readonly askMarkdown: string;
  readonly nudge: Option.Option<string>;
}): string =>
  [
    `You have claimed the ask \`${input.ask}\` in the project ${input.project}. Answer it.`,
    "",
    `The current directory is your clone of ${input.remote}, the fork your claim gave you. Push your answer there.`,
    "",
    "---",
    "",
    input.askMarkdown.trimEnd(),
    "",
    "---",
    "",
    "How to answer:",
    "",
    "1. Read the project's AGENTS.md, then the ask above.",
    `2. Change only files in the ask's territory, and make its check pass: \`${Brand.cli} check\` runs the project's checks here, before you push.`,
    "3. Commit, then `git push` to origin.",
    `4. Run \`${Brand.cli} status --project ${input.project}\` for the verdict. A refusal says what is wrong and what to run next: fix it, commit and push again.`,
    ...Option.match(input.nudge, {
      onNone: () => [],
      onSome: (nudge) => ["", `Note: ${nudge}`],
    }),
    "",
  ].join("\n");
