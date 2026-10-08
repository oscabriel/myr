/**
 * The env shape page's address, on its own so the project page can link to
 * it without carrying the env shape's view.
 */
import type { ProjectName } from "@repo/protocol/ids";

export const envPath = (project: ProjectName) => `/${project}/env`;
