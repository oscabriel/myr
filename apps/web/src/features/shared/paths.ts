import type {
  AskId,
  DecisionId,
  Handle,
  ProjectName,
} from "@repo/protocol/ids";
import { Result } from "effect";

export const ASKS_PATH = "/asks";

export const HOME_PATH = "/home";

export const IMPORT_PATH = "/import";

export const docsPath = (page?: string) =>
  page === undefined ? "/docs" : `/docs/${page}`;

export const projectPath = (project: ProjectName) => `/${project}`;

export const askPath = (project: ProjectName, ask: AskId) =>
  `/${project}/asks/${ask}`;

export const answerPath = (project: ProjectName, ask: AskId) =>
  `/${project}/answers/${ask}`;

/** A handle is URL-safe by its schema. */
export const personPath = (handle: Handle) => `/people/${handle}`;

export const ledgerPath = (project: ProjectName) => `/${project}/ledger`;

export const envPath = (project: ProjectName) => `/${project}/env`;

export const decisionPath = (project: ProjectName, decision: DecisionId) =>
  `/${project}/decisions/${decision}`;

const decoded = (segment: string) =>
  Result.getOrElse(
    Result.try(() => decodeURIComponent(segment)),
    () => segment
  );

export const segmentsOf = (pathname: string) =>
  pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map(decoded);
