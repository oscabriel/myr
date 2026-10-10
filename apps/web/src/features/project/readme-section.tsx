/**
 * A README (or any Markdown file) under its own name, rendered on the
 * project's prose: a project's home shows its root README below its asks,
 * and a folder or a Markdown file shows its own.
 */
import type { FileView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";

import { dirOf } from "../code/paths.ts";
import { RepoMarkdown } from "../markdown/markdown.tsx";

export const ReadmeSection = ({
  file,
  project,
}: {
  readonly file: FileView;
  readonly project: ProjectName;
}) => (
  <section
    aria-label={file.path}
    className="border-rule flex min-w-0 flex-col gap-3 border-t pt-4"
    data-readme={file.path}
  >
    <h2 className="text-muted-foreground text-mono font-mono font-medium">
      {file.path.split("/").at(-1)}
    </h2>
    {file.text === undefined ? (
      <p className="text-muted-foreground text-ui">
        This file is too large to show here.
      </p>
    ) : (
      <RepoMarkdown
        at={file.at}
        dir={dirOf(file.path)}
        project={project}
        source={file.text}
      />
    )}
  </section>
);
