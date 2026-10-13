import { ProjectList } from "../landing/project-list.tsx";
import type { LandingProjects } from "../landing/projects.ts";
import { Workspace } from "../shared/shell/workspace.tsx";

export const EXPLORE_TITLE = "Explore";

export const EXPLORE_LEDE =
  "Every public project, the ones taking the most answers first.";

/** Until Explore has its own cards, the public project list, so the top bar's link is one of the web's own pages. */
export const ExploreView = ({
  projects,
}: {
  readonly projects: LandingProjects;
}) => (
  <Workspace
    crumbs={[{ label: EXPLORE_TITLE }]}
    meta={EXPLORE_LEDE}
    title={EXPLORE_TITLE}
    variant="list"
  >
    <ProjectList projects={projects} />
  </Workspace>
);
