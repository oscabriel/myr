/**
 * Where a reader can be: the site's sections, a project's, and the trail of
 * crumbs from the site to the page at an address. The rail, the top bar,
 * the bottom bar, the section row and the context bar all read them here,
 * so one address names one place everywhere.
 */
import { projectAddressOf } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { Option } from "effect";

import { segmentsOf } from "../paths.ts";

/** Which of a project's pages is being read. */
export type ProjectTab =
  | "code"
  | "env"
  | "landings"
  | "ledger"
  | "overview"
  | "people"
  | "refs";

/** One of a project's sections: its word, its page, and the tab it is. */
export interface Section {
  readonly label: string;
  readonly tab: ProjectTab;
  readonly to: string;
}

/**
 * A project's sections (`project` as the address names it), in the order
 * every list of them shows. The project's
 * home is its asks; its `people` page is its policy (who decides, vouches,
 * budgets), and reads so, at the address it has always had.
 */
export const projectSections = (project: string): readonly Section[] => [
  { label: "Asks", tab: "overview", to: `/${project}` },
  { label: "Code", tab: "code", to: `/${project}/tree/main` },
  { label: "Landings", tab: "landings", to: `/${project}/commits/main` },
  { label: "Refs", tab: "refs", to: `/${project}/refs` },
  { label: "Policy", tab: "people", to: `/${project}/people` },
  { label: "Ledger", tab: "ledger", to: `/${project}/ledger` },
  { label: "Env shape", tab: "env", to: `/${project}/env` },
];

/** The first segment of each of a project's pages, by the section it sits in. */
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

/** The site's own first segments: every other one starts a project's address. */
const SITE = new Set([
  "agents",
  "asks",
  "docs",
  "home",
  "import",
  "people",
  "today",
]);

/**
 * The project an address is in, as the address spells it, and the
 * segments of its page after the name; none on the site's own pages. The
 * name is read by the protocol's one reader of addresses, so
 * `/oscabriel/datekit/ledger` and `/github.com/pallets/click/tree/main` (or
 * the router's own `/github.com%2Fpallets/click/…`) each find theirs.
 */
const addressOf = (pathname: string) => {
  const segments = segmentsOf(pathname);
  const [first] = segments;

  return first === undefined || SITE.has(first)
    ? undefined
    : Option.getOrUndefined(projectAddressOf(segments));
};

/** The project an address is in; none on the site's own pages. */
export const projectOf = (pathname: string): string | undefined =>
  addressOf(pathname)?.spelled;

/** The project section an address sits in; none for a page under none (a decision, a proposal). */
export const sectionOf = (pathname: string): ProjectTab | undefined => {
  const address = addressOf(pathname);

  if (address === undefined) {
    return undefined;
  }

  const [page] = address.rest;

  return page === undefined
    ? "overview"
    : Object.entries(SECTION_OF).find(([segment]) => segment === page)?.[1];
};

/** One step of the trail to a page: its word, its page (none for the page itself), and whether it is an id. */
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

/** A section's crumb, linked to its page when a page sits below it. */
const sectionCrumb = (
  project: string,
  tab: ProjectTab,
  below: boolean
): Crumb => {
  const label = SECTION_LABEL[tab];
  const section = projectSections(project).find((each) => each.tab === tab);

  return below && section !== undefined ? { label, to: section.to } : { label };
};

/** A project's crumb, then its section's. */
const projectCrumbs = (
  project: string,
  tab: ProjectTab,
  below: boolean
): readonly Crumb[] => [
  { label: project, to: `/${project}` },
  sectionCrumb(project, tab, below),
];

/** A code page's trail: Code, then the path in hand (none at the root). */
const pathCrumbs = (project: string, path: string): readonly Crumb[] =>
  path === ""
    ? projectCrumbs(project, "code", false)
    : [...projectCrumbs(project, "code", true), { label: path, mono: true }];

/** The site's own pages' trails, by first segment. */
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

/** A project's subject pages' trails (an ask, an answer, a commit, a path…), by second segment. */
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

/**
 * The trail from the site to the page at `pathname`: the project first, then
 * its section, then the thing in hand (an ask, a commit, a path), each a
 * link but the last. A page that knows better gives `Workspace` its own.
 */
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

/** A posture in one short word for the rail, beside its mark; the full label is its title. */
export const POSTURE_WORD = {
  open: "Open",
  openCore: "Core",
  openOnSchedule: "Scheduled",
  openWithSealedEvidence: "Sealed",
  sourceAvailable: "Source",
} as const satisfies Record<Posture, string>;
