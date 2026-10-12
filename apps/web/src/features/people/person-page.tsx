/**
 * Credit gates nothing and ranks no one: the page draws none of the read's
 * counts, orders by name, and adds nothing up.
 */
import { CreditRole } from "@repo/protocol/domain/credit";
import type { CreditSummary } from "@repo/protocol/domain/record";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import { Array, Order } from "effect";

import { EmptyState } from "../shared/empty.tsx";
import { PageShell } from "../shared/layout.tsx";
import { AppLink } from "../shared/link.tsx";
import { ASKS_PATH, projectPath } from "../shared/paths.ts";
import { MetaCode, MetaLine, Row, RowGroup } from "../shared/row.tsx";
import { projectSections } from "../shared/shell/sections.ts";
import { Workspace } from "../shared/shell/workspace.tsx";

export interface AreaCredit {
  readonly area: string;
  readonly roles: readonly CreditRole[];
}

export interface ProjectCredit {
  readonly areas: readonly AreaCredit[];
  readonly project: ProjectName;
}

const ROLE_WORD = {
  "Advised-by": "advised",
  "Asked-by": "asked",
  "Decided-by": "decided",
  "Finished-by": "finished",
  "Mentored-by": "mentored",
  "Released-by": "released",
  "Signed-off-by": "answered",
} as const satisfies Record<CreditRole, string>;

const SENTENCE_ORDER: readonly CreditRole[] = [
  "Signed-off-by",
  ...CreditRole.literals.filter((role) => role !== "Signed-off-by"),
];

const bySentence = Order.mapInput(Order.Number, (role: CreditRole) =>
  SENTENCE_ORDER.indexOf(role)
);

const listed = (words: readonly string[]) =>
  words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;

const whereOf = (project: string, area: string) =>
  area === "." || area === "" ? "the whole project" : `${project}/${area}`;

export const areaSentence = (
  project: string,
  area: string,
  roles: readonly CreditRole[]
) => {
  const words = Array.dedupe(Array.sort(roles, bySentence)).map(
    (role) => ROLE_WORD[role]
  );

  const sentence = `${listed(words)} in ${whereOf(project, area)}`;

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
};

const groupBy = <A,>(
  rows: readonly A[],
  key: (row: A) => string
): readonly Array.NonEmptyReadonlyArray<A>[] =>
  Object.entries(Array.groupBy(rows, key))
    .toSorted(([one], [other]) => one.localeCompare(other))
    .map(([, group]) => group);

export const creditsByProject = (
  credits: readonly CreditSummary[]
): readonly ProjectCredit[] =>
  groupBy(credits, ({ project }) => project).map((inProject) => ({
    areas: groupBy(inProject, ({ area }) => area).map((inArea) => ({
      area: Array.headNonEmpty(inArea).area,
      roles: Array.dedupe(
        Array.sort(
          inArea.map(({ role }) => role),
          bySentence
        )
      ),
    })),
    project: Array.headNonEmpty(inProject).project,
  }));

const landingsOf = (project: ProjectName) =>
  projectSections(project).find(({ tab }) => tab === "landings")?.to ??
  projectPath(project);

const Project = ({ credit }: { readonly credit: ProjectCredit }) => (
  <RowGroup
    label={credit.project}
    name={<AppLink to={projectPath(credit.project)}>{credit.project}</AppLink>}
    under="bar"
  >
    {credit.areas.map(({ area, roles }) => (
      <Row
        data={{ "data-area": area, "data-project": credit.project }}
        href={landingsOf(credit.project)}
        id={`${credit.project}/${area}`}
        key={area}
        meta={
          <MetaLine
            parts={roles.map((role) => (
              <MetaCode key={role}>{role}</MetaCode>
            ))}
          />
        }
        title={areaSentence(credit.project, area, roles)}
      />
    ))}
  </RowGroup>
);

export const PersonView = ({
  credits,
  handle,
}: {
  readonly credits: readonly CreditSummary[];
  readonly handle: Handle;
}) => {
  const projects = creditsByProject(credits);

  return (
    <Workspace
      meta={
        projects.length === 0
          ? undefined
          : `Credited on landings in ${listed(projects.map(({ project }) => project))}.`
      }
      title={handle}
    >
      {projects.length === 0 ? (
        <EmptyState
          onward={<AppLink to={ASKS_PATH}>Open asks</AppLink>}
          title="No credited landings yet."
        />
      ) : (
        <div className="flex flex-col gap-6" data-credits="">
          {projects.map((credit) => (
            <Project credit={credit} key={credit.project} />
          ))}
        </div>
      )}
      <p className="text-ui text-muted-foreground">
        Credit is the trailers on each landing; nothing here is a score.
      </p>
    </Workspace>
  );
};

export const NoSuchPersonView = () => (
  <PageShell title="No such person">
    <EmptyState
      onward={<AppLink to={ASKS_PATH}>Open asks</AppLink>}
      title="A handle is letters, digits and dashes, starting with a letter or digit, and this address names none."
    />
  </PageShell>
);
