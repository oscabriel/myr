/**
 * A Markdown file from a project's repo, rendered: a README on the
 * project and tree pages, a `.md` file on the blob page. Its links and
 * images resolve against `dir` at the commit `at`, so they stay inside the
 * project at that commit.
 *
 * Stub: the source as text, in a `<pre>`, until the GFM pipeline lands
 * (issue 905 replaces this body; the props are final).
 */
import type { CommitSha, ProjectName } from "@repo/protocol/ids";
import type { ReactNode } from "react";

export interface RepoMarkdownProps {
  /** The commit the file was read at; links and images point there. */
  readonly at: CommitSha;
  /** The file's directory, relative to the repo root; `""` is the root. */
  readonly dir: string;
  readonly project: ProjectName;
  /** The file's text. */
  readonly source: string;
}

export const RepoMarkdown = ({ source }: RepoMarkdownProps): ReactNode => (
  <pre className="overflow-x-auto font-mono text-sm whitespace-pre-wrap">
    {source}
  </pre>
);
