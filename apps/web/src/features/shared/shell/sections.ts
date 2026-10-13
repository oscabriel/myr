import { projectAddressOf } from "@repo/protocol/ids";
import { Option } from "effect";

import { segmentsOf } from "../paths.ts";

export type ProjectTab =
  | "code"
  | "env"
  | "landings"
  | "ledger"
  | "overview"
  | "people"
  | "refs";

export interface Section {
  readonly label: string;
  readonly tab: ProjectTab;
  readonly to: string;
}

export const projectSections = (project: string): readonly Section[] => [
  { label: "Asks", tab: "overview", to: `/${project}` },
  { label: "Code", tab: "code", to: `/${project}/tree/main` },
  { label: "Landings", tab: "landings", to: `/${project}/commits/main` },
  { label: "Refs", tab: "refs", to: `/${project}/refs` },
  { label: "Policy", tab: "people", to: `/${project}/people` },
  { label: "Ledger", tab: "ledger", to: `/${project}/ledger` },
  { label: "Env shape", tab: "env", to: `/${project}/env` },
];

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
} as const satisfies Record<string, ProjectTab>;

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

const sectionOf = (pathname: string): ProjectTab | undefined => {
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
} as const satisfies Record<ProjectTab, string>;

const sectionCrumb = (
  project: string,
  tab: ProjectTab,
  below: boolean
): Crumb => {
  const label = SECTION_LABEL[tab];
  const section = projectSections(project).find((each) => each.tab === tab);

  return below && section !== undefined ? { label, to: section.to } : { label };
};

const projectCrumbs = (
  project: string,
  tab: ProjectTab,
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
