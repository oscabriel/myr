/**
 * The page for an address that names no ask, or no answer: a 404 whose body
 * is the refusal the platform gave (`UnknownProject`, `UnknownAsk`), as
 * `git push` printed it, so a person reads what an agent reads in Markdown,
 * then the way onward: the project, when the address names one, and the
 * open asks. The refusals travel from the server in a not-found's data,
 * encoded as `Refusals`; `NoSuchAsk` decodes them where they arrive
 * (AGENTS.md principle 2).
 */
import { ProjectName } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import { Option, Schema } from "effect";
import type { Array } from "effect";

import { EmptyState } from "../shared/empty.tsx";
import { PageShell } from "../shared/layout.tsx";
import { AppLink } from "../shared/link.tsx";
import { projectPath } from "../shared/paths.ts";
import { RefusalView } from "../shared/refusal.tsx";
import { Refusals } from "../shared/refusals.ts";

/** What a 404 says when the address could name no ask, so no refusal came back. */
export const NAMES_ONLY =
  "Nothing is at this address: a project's and an ask's names are lowercase words joined by single dashes.";

const LINK = "decoration-rule underline hover:decoration-current";

/** Where to go from a page that names nothing: the project, then every open ask. */
const Onward = ({ project }: { readonly project: ProjectName | undefined }) => (
  <nav aria-label="Onward" className="text-ui flex flex-wrap gap-x-5 gap-y-1">
    {project === undefined ? null : (
      <AppLink className={LINK} to={projectPath(project)}>
        {project}
      </AppLink>
    )}
    <AppLink className={LINK} to="/">
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
  /** The project the address names, when it could be one. */
  readonly project?: ProjectName | undefined;
  readonly refusals: Array.NonEmptyReadonlyArray<Refusal> | undefined;
  readonly title: string;
}) => (
  <PageShell title={title}>
    {refusals === undefined ? (
      <EmptyState title={nothing} />
    ) : (
      <RefusalView refusals={refusals} />
    )}
    <Onward project={project} />
  </PageShell>
);

const decodeRefusals = Schema.decodeUnknownOption(Refusals);

const decodeProject = Schema.decodeUnknownOption(ProjectName);

/**
 * A route's not-found page: the refusals its loader's not-found carried,
 * decoded; `nothing` when it carried none (the address could name no ask).
 * `project` is the address's own segment, linked only when a project could
 * have that name.
 */
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
