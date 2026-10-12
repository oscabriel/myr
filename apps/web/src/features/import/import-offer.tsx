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
      meta={`Nobody has imported ${project} yet. Import it, and you become its maintainer.`}
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
