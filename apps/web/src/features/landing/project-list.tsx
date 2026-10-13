import { postureLabel } from "../project/posture-label.ts";
import { AppLink } from "../shared/link.tsx";
import { projectPath } from "../shared/paths.ts";
import { UnreachableNotice } from "../shared/pending.tsx";
import { PostureBadge } from "../shared/posture.tsx";
import { LandingProjects } from "./projects.ts";

/** The public projects as rows, each its name and posture, or a notice when the platform did not answer. */
export const ProjectList = ({
  projects,
}: {
  readonly projects: LandingProjects;
}) =>
  LandingProjects.match(projects, {
    Listed: ({ projects: listed }) => (
      <ul className="flex flex-col">
        {listed.map(({ posture, project }) => (
          <li
            className="border-rule flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b py-2.5"
            data-project={project}
            key={project}
          >
            <AppLink
              className="text-want font-medium no-underline hover:underline"
              to={projectPath(project)}
            >
              {project}
            </AppLink>
            <PostureBadge label={postureLabel(posture)} posture={posture} />
          </li>
        ))}
      </ul>
    ),
    Unreachable: () => <UnreachableNotice />,
  });
