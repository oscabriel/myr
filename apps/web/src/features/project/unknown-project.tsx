/**
 * The page for an address that names no project: the platform's own
 * refusal, `UnknownProject`, as `git` and the CLI would print it, then the
 * way onward. An address that cannot be a project's name at all says so in
 * a sentence.
 *
 * At a source namespace's address (`/github.com/pallets/click`) nobody has
 * imported yet, it offers the import instead: the form prefilled with the
 * URL the address rebuilds, the owner fixed to the namespace, and the name;
 * signed out, the way to sign in. Only the project's own address offers
 * it (its route passes who is importing); it never imports on its own.
 */
import {
  isSourceNamespace,
  ownerOf,
  ProjectName,
  shortNameOf,
} from "@repo/protocol/ids";
import type { SourceNamespace } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { Option, Schema } from "effect";

import { ImportForm } from "../import/import-form.tsx";
import type { Importer } from "../import/import-form.tsx";
import { sourceUrlOf } from "../import/prefill.ts";
import { EmptyState } from "../shared/empty.tsx";
import { AppLink } from "../shared/link.tsx";
import { ASKS_PATH } from "../shared/paths.ts";
import { RefusalView } from "../shared/refusal.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";

const decodeProject = Schema.decodeUnknownOption(ProjectName);

const LINK = "decoration-rule underline hover:decoration-current";

/** Where to go instead: every open ask. */
const Onward = () => (
  <div className="text-ui flex flex-wrap gap-x-4 gap-y-1">
    <AppLink className={LINK} to={ASKS_PATH}>
      Open asks
    </AppLink>
  </div>
);

/** The import a source namespace's address offers, nobody having made it. */
const ImportOffer = ({
  importer,
  owner,
  project,
}: {
  readonly project: ProjectName;
  readonly owner: SourceNamespace;
  readonly importer: Importer;
}) => (
  <Workspace
    crumbs={[{ label: project }]}
    meta={`Nobody has imported ${project} yet. Import it, and you become its decider.`}
    title="Not imported yet"
  >
    <ImportForm
      {...importer}
      fixedOwner={owner}
      here={`/${project}`}
      prefill={{ name: shortNameOf(project), owner, url: sourceUrlOf(project) }}
    />
  </Workspace>
);

export const UnknownProjectView = ({
  importer,
  name,
}: {
  readonly name: string;
  /**
   * Who would import it, at a source namespace's address: given only on
   * the project's own address, the one page that offers the import.
   */
  readonly importer?: Importer | undefined;
}) =>
  Option.match(decodeProject(name), {
    onNone: () => (
      <Workspace
        crumbs={[{ label: "No such project" }]}
        title="No such project"
      >
        <EmptyState
          onward={<Onward />}
          title="A project's name is lowercase words joined by single dashes, and this address names none."
        />
      </Workspace>
    ),
    onSome: (project) => {
      const owner = ownerOf(project);

      return importer !== undefined && isSourceNamespace(owner) ? (
        <ImportOffer importer={importer} owner={owner} project={project} />
      ) : (
        <Workspace crumbs={[{ label: project }]} title="No such project">
          <RefusalView refusals={[new UnknownProject({ project })]} />
          <Onward />
        </Workspace>
      );
    },
  });
