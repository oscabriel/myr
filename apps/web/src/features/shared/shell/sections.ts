import { projectAddressOf } from "@repo/protocol/ids";
import { Option } from "effect";

import { segmentsOf } from "../paths.ts";

/** A project's eight tabs (ADR 0041), in the header's order. */
export type ProjectTab =
  | "asks"
  | "code"
  | "landings"
  | "overview"
  | "people"
  | "policy"
  | "proposals"
  | "visibility";

export interface Section {
  readonly label: string;
  readonly tab: ProjectTab;
  readonly to: string;
  /** A tab whose own page has not been built yet opens the region of Overview that holds it. */
  readonly hash?: string;
}

/**
 * Each tab opens a page inside the project's frame that exists today: Asks,
 * Proposals and People open their regions of Overview, Policy the policy at
 * the address it has always had, and Visibility the ledger. Starting a
 * proposal is a focused page of its own, so it is Contribute's, not a tab's.
 */
export const projectSections = (project: string): readonly Section[] => [
  { label: "Overview", tab: "overview", to: `/${project}` },
  { label: "Code", tab: "code", to: `/${project}/tree/main` },
  { hash: "open-asks", label: "Asks", tab: "asks", to: `/${project}` },
  { label: "Landings", tab: "landings", to: `/${project}/commits/main` },
  {
    hash: "proposals",
    label: "Proposals",
    tab: "proposals",
    to: `/${project}`,
  },
  { hash: "who-decides", label: "People", tab: "people", to: `/${project}` },
  { label: "Policy", tab: "policy", to: `/${project}/people` },
  { label: "Visibility", tab: "visibility", to: `/${project}/ledger` },
];

/** The tab each page of a project sits under, by its first segment. */
const TAB_OF = {
  answers: "landings",
  asks: "asks",
  blob: "code",
  commit: "landings",
  commits: "landings",
  decisions: "asks",
  env: "visibility",
  ledger: "visibility",
  people: "policy",
  proposals: "proposals",
  raw: "code",
  refs: "code",
  tree: "code",
  why: "code",
} as const satisfies Record<string, ProjectTab>;

/** A crumb names the page itself, which may be narrower than its tab. */
type PageSection =
  | "code"
  | "env"
  | "landings"
  | "ledger"
  | "overview"
  | "people"
  | "refs";

const PAGE_TO = (project: string) =>
  ({
    code: `/${project}/tree/main`,
    env: `/${project}/env`,
    landings: `/${project}/commits/main`,
    ledger: `/${project}/ledger`,
    overview: `/${project}`,
    people: `/${project}/people`,
    refs: `/${project}/refs`,
  }) as const satisfies Record<PageSection, string>;

const SECTION_OF = {
  answers: "overview",
  asks: "overview",
  blob: "code",
  commit: "landings",
  commits: "landings",
  env: "env",
  ledger: "ledger",
  people: "people",
  refs: "refs",
  tree: "code",
  why: "code",
} as const satisfies Record<string, PageSection>;

const SITE = new Set([
  "agents",
  "asks",
  "docs",
  "home",
  "import",
  "people",
  "today",
]);

const addressOf = (pathname: string) => {
  const segments = segmentsOf(pathname);
  const [first] = segments;

  return first === undefined || SITE.has(first)
    ? undefined
    : Option.getOrUndefined(projectAddressOf(segments));
};

export const projectOf = (pathname: string): string | undefined =>
  addressOf(pathname)?.spelled;

/** The tab a project's page sits under; Overview for the project's own address. */
export const projectTabOf = (pathname: string): ProjectTab | undefined => {
  const address = addressOf(pathname);

  if (address === undefined) {
    return undefined;
  }

  const [page] = address.rest;

  return page === undefined
    ? "overview"
    : Object.entries(TAB_OF).find(([segment]) => segment === page)?.[1];
};

/**
 * The pages under a project that its route draws in another shell: starting
 * a proposal is focused (`staticData.shell` is `focus`), so it has no header.
 */
const OUTSIDE_FRAME: readonly (readonly string[])[] = [["proposals", "new"]];

/** Whether a path is a project's page drawn in the project's frame, under its header. */
export const inProjectFrame = (pathname: string): boolean => {
  const address = addressOf(pathname);

  return (
    address !== undefined &&
    !OUTSIDE_FRAME.some(
      (page) =>
        page.length === address.rest.length &&
        page.every((segment, at) => address.rest[at] === segment)
    )
  );
};

const sectionOf = (pathname: string): PageSection | undefined => {
  const address = addressOf(pathname);

  if (address === undefined) {
    return undefined;
  }

  const [page] = address.rest;

  return page === undefined
    ? "overview"
    : Object.entries(SECTION_OF).find(([segment]) => segment === page)?.[1];
};

export interface Crumb {
  readonly label: string;
  readonly mono?: boolean;
  readonly to?: string;
}

const SECTION_LABEL = {
  code: "Code",
  env: "Env shape",
  landings: "Landings",
  ledger: "Ledger",
  overview: "Asks",
  people: "Policy",
  refs: "Refs",
} as const satisfies Record<PageSection, string>;

const sectionCrumb = (
  project: string,
  tab: PageSection,
  below: boolean
): Crumb => {
  const label = SECTION_LABEL[tab];

  return below ? { label, to: PAGE_TO(project)[tab] } : { label };
};

const projectCrumbs = (
  project: string,
  tab: PageSection,
  below: boolean
): readonly Crumb[] => [
  { label: project, to: `/${project}` },
  sectionCrumb(project, tab, below),
];

const pathCrumbs = (project: string, path: string): readonly Crumb[] =>
  path === ""
    ? projectCrumbs(project, "code", false)
    : [...projectCrumbs(project, "code", true), { label: path, mono: true }];

const SITE_CRUMBS = {
  agents: () => [{ label: "For agents" }],
  asks: () => [{ label: "Asks" }],
  docs: (page: string | undefined) =>
    page === undefined
      ? [{ label: "Docs" }]
      : [{ label: "Docs", to: "/docs" }, { label: page }],
  home: () => [{ label: "Home" }],
  people: (handle: string | undefined) => [{ label: handle ?? "People" }],
  today: () => [{ label: "Today" }],
} as const satisfies Record<
  string,
  (second: string | undefined) => readonly Crumb[]
>;

const SUBJECT_CRUMBS = {
  answers: (project: string, ask: string) => [
    ...projectCrumbs(project, "overview", true),
    { label: ask, mono: true, to: `/${project}/asks/${ask}` },
    { label: "Answer" },
  ],
  asks: (project: string, ask: string) => [
    ...projectCrumbs(project, "overview", true),
    { label: ask, mono: true },
  ],
  blob: (project: string, _rev: string, path: string) =>
    pathCrumbs(project, path),
  commit: (project: string, sha: string) => [
    ...projectCrumbs(project, "landings", true),
    { label: sha.slice(0, 7), mono: true },
  ],
  decisions: (project: string, decision: string) => [
    { label: project, to: `/${project}` },
    { label: "Today", to: "/today" },
    { label: decision, mono: true },
  ],
  proposals: (project: string, proposal: string) => [
    ...projectCrumbs(project, "overview", true),
    proposal === "new" ? { label: "Propose" } : { label: proposal, mono: true },
  ],
  tree: (project: string, _rev: string, path: string) =>
    pathCrumbs(project, path),
  why: (project: string, _rev: string, path: string) =>
    pathCrumbs(project, path),
} as const satisfies Record<
  string,
  (project: string, third: string, rest: string) => readonly Crumb[]
>;

export const crumbsFor = (pathname: string): readonly Crumb[] => {
  const [first, second] = segmentsOf(pathname);

  if (first === undefined) {
    return [{ label: "Asks" }];
  }

  const site = Object.entries(SITE_CRUMBS).find(([name]) => name === first);

  if (site !== undefined) {
    return site[1](second);
  }

  const address = addressOf(pathname);

  if (address === undefined) {
    return [{ label: first }];
  }

  const project = address.spelled;
  const [page, third, ...rest] = address.rest;

  const subject = Object.entries(SUBJECT_CRUMBS).find(
    ([name]) => name === page
  );

  if (subject !== undefined && third !== undefined) {
    return subject[1](project, third, rest.join("/"));
  }

  const tab = sectionOf(pathname);

  return tab === undefined
    ? [
        { label: project, to: `/${project}` },
        { label: rest.at(-1) ?? third ?? page ?? project },
      ]
    : projectCrumbs(project, tab, false);
};
