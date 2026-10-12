import { commandDocs } from "@repo/agent-kit/command-doc";
import type { CommandDoc } from "@repo/agent-kit/command-doc";
import { Contracts } from "@repo/protocol/contracts";

export const commands: readonly CommandDoc[] = commandDocs(Contracts);
