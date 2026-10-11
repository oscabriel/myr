/**
 * `/import`: the import form under the page's head, and beside it what an
 * import does and the same import as a command. A URL in the address
 * (`?url=`) fills the form. Props in, markup out: the route reads who is
 * signed in, sends the payload and goes to the project once it is made.
 */
import { CommandLine } from "../shared/command.tsx";
import { FactBlock } from "../shared/facts.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { ImportForm, importCommand } from "./import-form.tsx";
import type { Importer } from "./import-form.tsx";

/** What an import does, and the same import from a terminal. */
export const ImportFacts = () => (
  <>
    <FactBlock label="What an import does">
      <ul className="text-ui flex list-disc flex-col gap-1.5 pl-4">
        <li>
          The platform clones the repo once, over HTTPS. Later pushes to the
          source do not follow it.
        </li>
        <li>You become the project&apos;s decider.</li>
        <li>
          A repo with no config folder takes its checks from its CI and its test
          command.
        </li>
      </ul>
    </FactBlock>
    <FactBlock label="From a terminal">
      <CommandLine command={importCommand()} numbered />
    </FactBlock>
  </>
);

export const ImportView = ({
  url = "",
  here,
  ...importer
}: Importer & {
  /** The URL the address carries, to fill the form with. */
  readonly url?: string | undefined;
  /** The page's own address, where sign-in comes back to. */
  readonly here: string;
}) => (
  // Below the shell's width the form comes first, and what an import does
  // follows it, rather than standing between the reader and the form.
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
        // The name follows the URL until the person types one.
        prefill={url === "" ? undefined : { url }}
      />
      <div className="shell:hidden border-rule flex flex-col border-t pt-4">
        <ImportFacts />
      </div>
    </Workspace>
  </div>
);
