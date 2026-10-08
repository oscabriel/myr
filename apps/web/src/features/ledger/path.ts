/**
 * The ledger page's address, on its own so the project page can link to it
 * without carrying the ledger's view.
 */
import type { ProjectName } from "@repo/protocol/ids";

export const ledgerPath = (project: ProjectName) => `/${project}/ledger`;
