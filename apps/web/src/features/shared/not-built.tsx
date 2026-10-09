/**
 * A project page whose route exists but whose view does not yet: the
 * project's nav and one line naming the build step that fills it. Every
 * W9 route renders this until its issue replaces the route's body, so
 * every typed link to it resolves meanwhile. Delete this file once no
 * route imports it.
 */
import { ProjectName } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { ProjectNav } from "../project/project-nav.tsx";
import type { ProjectTab } from "../project/project-nav.tsx";
import { UnknownProjectView } from "../project/unknown-project.tsx";
import { EmptyState } from "./empty.tsx";
import { PageShell } from "./layout.tsx";

const decodeProject = Schema.decodeUnknownOption(ProjectName);

export const NotBuilt = ({
  current,
  issue,
  project,
  title,
}: {
  readonly current?: ProjectTab | undefined;
  /** The build issue that builds the page, e.g. `"904"`. */
  readonly issue: string;
  /** The route's `$project`, as the address spells it. */
  readonly project: string;
  readonly title: string;
}) =>
  Option.match(decodeProject(project), {
    onNone: () => <UnknownProjectView name={project} />,
    onSome: (name) => (
      <PageShell title={title}>
        <ProjectNav current={current} project={name} />
        <div data-not-built={issue}>
          <EmptyState title={`This page is not built yet (${issue}).`} />
        </div>
      </PageShell>
    ),
  });
