import { postureLabel } from "../project/posture-label.ts";
import { AppLink } from "../shared/link.tsx";
import { StateMarkIcon } from "../shared/marks.tsx";
import { projectPath } from "../shared/paths.ts";
import { UnreachableNotice } from "../shared/pending.tsx";
import { PostureBadge } from "../shared/posture.tsx";
import { When } from "../shared/time.tsx";
import { LandingNow } from "./landing-now.ts";

const openAsksIn = (count: number) =>
  `${count} open ${count === 1 ? "ask" : "asks"}`;

/** The projects that landed last, each its name, posture and open asks, and when; or why there are none. */
export const LandingNowList = ({
  landings,
}: {
  readonly landings: LandingNow;
}) =>
  LandingNow.match(landings, {
    Listed: ({ now, projects }) =>
      projects.length === 0 ? (
        <p className="text-body text-muted-foreground">
          Nothing has landed on a public project yet.
        </p>
      ) : (
        <ul className="border-rule flex flex-col border-t">
          {projects.map(({ landedAt, openAsks, posture, project }) => (
            <li
              className="border-rule tablet:flex-nowrap flex min-h-16 flex-wrap items-center gap-x-4 gap-y-1 border-b py-2.5"
              data-project={project}
              key={project}
            >
              <StateMarkIcon mark="landed" />
              <div className="flex min-w-48 flex-1 flex-col gap-0.5">
                <AppLink
                  className="text-want truncate font-medium no-underline hover:underline"
                  to={projectPath(project)}
                >
                  {project}
                </AppLink>
                <p className="text-ui text-muted-foreground">
                  {openAsksIn(openAsks)}
                </p>
              </div>
              <PostureBadge label={postureLabel(posture)} posture={posture} />
              <p className="text-ui tablet:w-32 tablet:text-right shrink-0 tabular-nums">
                <span className="text-landed font-medium">Landed</span>{" "}
                <span className="text-muted-foreground">
                  {landedAt === undefined ? null : (
                    <When at={landedAt} now={now} />
                  )}
                </span>
              </p>
            </li>
          ))}
        </ul>
      ),
    Unreachable: () => <UnreachableNotice />,
  });
