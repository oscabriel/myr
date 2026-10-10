/**
 * A person's page: their credit, read from the trailers on landed commits,
 * grouped by project and then by area, each role with how many landings
 * name them in it. Credit gates nothing and ranks no one (GLOSSARY.md
 * "Credit", "Record"), so the page orders by name, never by count, and adds
 * nothing up.
 */
import { CreditRole } from "@repo/protocol/domain/credit";
import type { CreditSummary } from "@repo/protocol/domain/record";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import { Array, Order } from "effect";

import { SECTION } from "../shared/classes.ts";
import { EmptyState } from "../shared/empty.tsx";
import { PageShell } from "../shared/layout.tsx";
import { projectPath } from "../shared/paths.ts";

/** One area of a project: each role a person holds there, with its count. */
export interface AreaCredit {
  readonly area: string;
  readonly roles: readonly {
    readonly count: number;
    readonly role: CreditRole;
  }[];
}

/** One project: the areas a person is credited in. */
export interface ProjectCredit {
  readonly areas: readonly AreaCredit[];
  readonly project: ProjectName;
}

const byRole = Order.mapInput(Order.Number, (role: CreditRole) =>
  CreditRole.literals.indexOf(role)
);

/** `rows` grouped by `key`, the groups in the order their keys sort. */
const groupBy = <A,>(
  rows: readonly A[],
  key: (row: A) => string
): readonly Array.NonEmptyReadonlyArray<A>[] =>
  Object.entries(Array.groupBy(rows, key))
    .toSorted(([one], [other]) => one.localeCompare(other))
    .map(([, group]) => group);

/**
 * A person's credit by project, then by area (each by name), each area's
 * roles in trailer order; a role listed twice in one area counts once, with
 * both counts.
 */
export const creditsByProject = (
  credits: readonly CreditSummary[]
): readonly ProjectCredit[] =>
  groupBy(credits, ({ project }) => project).map((inProject) => ({
    areas: groupBy(inProject, ({ area }) => area).map((inArea) => ({
      area: Array.headNonEmpty(inArea).area,
      roles: groupBy(inArea, ({ role }) => role)
        .map((rows) => ({
          count: rows.reduce((sum, row) => sum + row.count, 0),
          role: Array.headNonEmpty(rows).role,
        }))
        .toSorted((one, other) => byRole(one.role, other.role)),
    })),
    project: Array.headNonEmpty(inProject).project,
  }));

const Area = ({ area }: { readonly area: AreaCredit }) => (
  <section className="border-rule grid gap-x-6 gap-y-2 border-t py-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
    <h3 className="font-mono text-[0.8125rem] font-medium [overflow-wrap:anywhere]">
      {area.area}
    </h3>
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 font-mono text-[0.8125rem] leading-6">
      {area.roles.map(({ count, role }) => (
        <div className="col-span-2 grid grid-cols-subgrid" key={role}>
          <dt className="text-muted-foreground">{role}</dt>
          <dd>
            {count} {count === 1 ? "landing" : "landings"}
          </dd>
        </div>
      ))}
    </dl>
  </section>
);

export const PersonView = ({
  credits,
  handle,
}: {
  readonly credits: readonly CreditSummary[];
  readonly handle: Handle;
}) => (
  <PageShell title={handle}>
    <p className="text-muted-foreground max-w-[70ch]">
      Credit, as the trailers on landed commits name {handle}: by project, by
      area, and by role, with how many landings name them in each.
    </p>
    {credits.length === 0 ? (
      <EmptyState title="No credited landings yet." />
    ) : (
      creditsByProject(credits).map(({ areas, project }) => (
        <section
          aria-labelledby={`project-${project}`}
          className="flex flex-col gap-3"
          key={project}
        >
          <h2 className={SECTION} id={`project-${project}`}>
            <a
              className="decoration-rule underline hover:decoration-current"
              href={projectPath(project)}
            >
              {project}
            </a>
          </h2>
          <div className="border-rule flex flex-col border-b">
            {areas.map((area) => (
              <Area area={area} key={area.area} />
            ))}
          </div>
        </section>
      ))
    )}
  </PageShell>
);

/** The page for an address whose last part cannot be a handle. */
export const NoSuchPersonView = () => (
  <PageShell title="No such person">
    <EmptyState title="A handle is letters, digits and dashes, starting with a letter or digit, and this address names none." />
  </PageShell>
);
