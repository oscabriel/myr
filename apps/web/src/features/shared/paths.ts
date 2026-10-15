import type {
  AskId,
  DecisionId,
  DiscussionId,
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

export const discussionsPath = (project: ProjectName) =>
  `/${project}/discussions`;

export const discussionPath = (
  project: ProjectName,
  discussion: DiscussionId
) => `/${project}/discussions/${discussion}`;

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

/** A project's policy page, which was `/people` until the People tab folded into it. */
export const policyPath = (project: ProjectName) => `/${project}/policy`;

/** A project's own Asks tab, beside the site's `/asks`. */
export const projectAsksPath = (project: ProjectName) => `/${project}/asks`;

/** The page of a project that moved to its policy page. */
export const MOVED_TO_POLICY = "people";

/** Where the old `/people` goes: the policy page, the query as it was spelled. */
export const policyHref = (project: string, search: string) =>
  `/${project}/policy${search}`;

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
