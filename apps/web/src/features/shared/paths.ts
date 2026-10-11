/**
 * The site's addresses, in a module with no view of its own, so a route or
 * a view links to a page without carrying that page's view.
 */
import type {
  AskId,
  DecisionId,
  Handle,
  ProjectName,
} from "@repo/protocol/ids";
import { Result } from "effect";

/** The front page: every open ask, across every project. */
export const ASKS_PATH = "/asks";

/** A signed-in reader's own page. */
export const HOME_PATH = "/home";

/** The docs' index, or one of its pages. */
export const docsPath = (page?: string) =>
  page === undefined ? "/docs" : `/docs/${page}`;

/** A project's page. */
export const projectPath = (project: ProjectName) => `/${project}`;

/** An ask's page. */
export const askPath = (project: ProjectName, ask: AskId) =>
  `/${project}/asks/${ask}`;

/** The page of the verdict on an ask's latest answer. */
export const answerPath = (project: ProjectName, ask: AskId) =>
  `/${project}/answers/${ask}`;

/** A person's page: `/people/<handle>` (a handle is URL-safe by its schema). */
export const personPath = (handle: Handle) => `/people/${handle}`;

/** A project's ledger. */
export const ledgerPath = (project: ProjectName) => `/${project}/ledger`;

/** A project's env shape. */
export const envPath = (project: ProjectName) => `/${project}/env`;

/** A decision's page. */
export const decisionPath = (project: ProjectName, decision: DecisionId) =>
  `/${project}/decisions/${decision}`;

/** `segment` decoded, or as it came when it does not decode. */
const decoded = (segment: string) =>
  Result.getOrElse(
    Result.try(() => decodeURIComponent(segment)),
    () => segment
  );

/** A pathname's segments, decoded, the empty ones dropped. */
export const segmentsOf = (pathname: string) =>
  pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map(decoded);
