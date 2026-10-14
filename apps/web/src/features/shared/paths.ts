import type {
  AskId,
  DecisionId,
  Handle,
  ProjectName,
} from "@repo/protocol/ids";
import { Result } from "effect";

export const ASKS_PATH = "/asks";

export const IMPORT_PATH = "/import";

export const EXPLORE_PATH = "/explore";

/** Every way to reach the platform; the old `/agents` redirects here. */
export const INSTALL_PATH = "/install";

/** A reader's own page: the decisions waiting on them, their claims, the asks to take next. */
export const INBOX_PATH = "/inbox";

export const PRIVACY_PATH = "/privacy";

/** A reader's own choices, kept in their browser (ADR 0042). */
export const SETTINGS_PATH = "/settings";

export const TERMS_PATH = "/terms";

/** The guided walkthrough: the loop in six steps on an example project. */
export const TOUR_PATH = "/tour";

/** The landing's "Landing now", which the tour's "see it live" opens. */
export const LANDING_NOW_ANCHOR = "landing-now";

export const docsPath = (page?: string) =>
  page === undefined ? "/docs" : `/docs/${page}`;

export const projectPath = (project: ProjectName) => `/${project}`;

export const askPath = (project: ProjectName, ask: AskId) =>
  `/${project}/asks/${ask}`;

export const answerPath = (project: ProjectName, ask: AskId) =>
  `/${project}/answers/${ask}`;

/** A handle is URL-safe by its schema. */
export const personPath = (handle: Handle) => `/people/${handle}`;

/** A project's Visibility tab (ADR 0041), and the regions on it a link may open. */
export const visibilityPath = (project: ProjectName) =>
  `/${project}/visibility`;

export const LEDGER_ANCHOR = "ledger";

export const ENVIRONMENT_ANCHOR = "environment";

/** Each page of a project that folded into its Visibility tab, and the region it opens there. */
export const MOVED_TO_VISIBILITY: ReadonlyMap<string, string> = new Map([
  ["env", ENVIRONMENT_ANCHOR],
  ["ledger", LEDGER_ANCHOR],
]);

/** Where an old page's address goes: the tab, the query as it was spelled, then the region. */
export const visibilityHref = (
  project: string,
  anchor: string,
  search: string
) => `/${project}/visibility${search}#${anchor}`;

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
