/**
 * The import a source namespace's address offers when nobody has made the
 * project (`/github.com/pallets/click`): the form prefilled with the URL
 * the address rebuilds (read-only), the owner fixed to the namespace, and
 * the name; signed out, the way to sign in. It never imports on its own.
 * The route draws it in place of the not-found when `offerFor` names the
 * address's project. Props in, markup out.
 */
import {
  isSourceNamespace,
  ownerOf,
  ProjectName,
  shortNameOf,
} from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { Workspace } from "../shared/shell/workspace.tsx";
import { ImportForm } from "./import-form.tsx";
import type { Importer } from "./import-form.tsx";
import { sourceUrlOf } from "./prefill.ts";

const decodeProject = Schema.decodeUnknownOption(ProjectName);

/**
 * The project an address that names none offers to import: its name, when
 * its owner is a source namespace; none for a person's address and for
 * one that names no possible project.
 */
export const offerFor = (name: string): Option.Option<ProjectName> =>
  Option.filter(decodeProject(name), (project) =>
    isSourceNamespace(ownerOf(project))
  );

export const ImportOffer = ({
  importer,
  project,
}: {
  readonly project: ProjectName;
  readonly importer: Importer;
}) => {
  const owner = ownerOf(project);
  const fixedOwner = isSourceNamespace(owner) ? owner : undefined;

  return (
    <Workspace
      crumbs={[{ label: project }]}
      meta={`Nobody has imported ${project} yet. Import it, and you become its decider.`}
      title="Not imported yet"
    >
      <ImportForm
        {...importer}
        fixedOwner={fixedOwner}
        here={`/${project}`}
        prefill={{
          name: shortNameOf(project),
          owner: fixedOwner,
          url: sourceUrlOf(project),
        }}
      />
    </Workspace>
  );
};
