import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { Option, Schema } from "effect";
import type { Array } from "effect";

import { EmptyState } from "../shared/empty.tsx";
import { AppLink } from "../shared/link.tsx";
import { ASKS_PATH, projectPath } from "../shared/paths.ts";
import { RefusalView } from "../shared/refusal.tsx";
import { Refusals } from "../shared/refusals.ts";
import type { Crumb } from "../shared/shell/sections.ts";
import { Workspace } from "../shared/shell/workspace.tsx";

export const NAMES_ONLY =
  "Nothing is at this address: a project's and an ask's names are lowercase words joined by single dashes.";

const LINK = "decoration-rule underline hover:decoration-current";

const isUnknownProject = Schema.is(UnknownProject);

const Onward = ({ project }: { readonly project: ProjectName | undefined }) => (
  <nav aria-label="Onward" className="text-ui flex flex-wrap gap-x-5 gap-y-1">
    {project === undefined ? null : (
      <AppLink className={LINK} to={projectPath(project)}>
        {project}
      </AppLink>
    )}
    <AppLink className={LINK} to={ASKS_PATH}>
      Open asks
    </AppLink>
  </nav>
);

export const NotFoundView = ({
  nothing = NAMES_ONLY,
  project,
  refusals,
  title,
}: {
  readonly nothing?: string;
  readonly project?: ProjectName | undefined;
  readonly refusals: Array.NonEmptyReadonlyArray<Refusal> | undefined;
  readonly title: string;
}) => {
  const known = refusals?.some(isUnknownProject) === true ? undefined : project;

  const crumbs: readonly Crumb[] =
    known === undefined
      ? [{ label: "Asks", to: ASKS_PATH }, { label: title }]
      : [
          { label: known, to: projectPath(known) },
          { label: "Asks", to: projectPath(known) },
          { label: title },
        ];

  return (
    <Workspace crumbs={crumbs} title={title}>
      {refusals === undefined ? (
        <EmptyState title={nothing} />
      ) : (
        <RefusalView refusals={refusals} />
      )}
      <Onward project={known} />
    </Workspace>
  );
};

const decodeRefusals = Schema.decodeUnknownOption(Refusals);

const decodeProject = Schema.decodeUnknownOption(ProjectName);

export const NoSuchAsk = ({
  data,
  nothing = NAMES_ONLY,
  project,
}: {
  readonly data?: unknown;
  readonly nothing?: string;
  readonly project?: string | undefined;
}) => (
  <NotFoundView
    nothing={nothing}
    project={Option.getOrUndefined(decodeProject(project))}
    refusals={Option.getOrUndefined(decodeRefusals(data))}
    title="No such ask"
  />
);
