import { FactBlock } from "../shared/facts.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { ImportForm } from "./import-form.tsx";
import type { Importer } from "./import-form.tsx";

export const ImportFacts = () => (
  <FactBlock label="What an import does">
    <ul className="text-ui flex list-disc flex-col gap-1.5 pl-4">
      <li>
        The platform clones the repo once, over HTTPS. Later pushes to the
        source do not follow it.
      </li>
      <li>You become the project&apos;s maintainer.</li>
      <li>
        A repo with no config folder takes its checks from its CI and its test
        command.
      </li>
    </ul>
  </FactBlock>
);

export const ImportView = ({
  url = "",
  here,
  ...importer
}: Importer & {
  readonly url?: string | undefined;
  readonly here: string;
}) => (
  <div className="contents [&_[data-facts=inline]]:hidden">
    <Workspace
      crumbs={[{ label: "Import a repo" }]}
      facts={<ImportFacts />}
      factsHeading="Importing"
      meta="Any public git repo becomes a project here, with its history."
      title="Import a repo"
    >
      <ImportForm
        {...importer}
        here={here}
        prefill={url === "" ? undefined : { url }}
      />
      <div className="border-rule flex flex-col border-t pt-4">
        <ImportFacts />
      </div>
    </Workspace>
  </div>
);
