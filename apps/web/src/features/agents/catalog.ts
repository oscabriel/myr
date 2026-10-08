/**
 * The CLI's commands, from `@repo/agent-kit`'s one list (the contracts the
 * CLI projects, then the commands written by hand in it), so `llms.txt`
 * lists what the CLI has rather than a copy (issue 505).
 */
import { commandDocs } from "@repo/agent-kit/command-doc";
import type { CommandDoc } from "@repo/agent-kit/command-doc";
import { Contracts } from "@repo/protocol/contracts";

export const commands: readonly CommandDoc[] = commandDocs(Contracts);
