/**
 * A Markdown file from a project's repo, rendered: a README on the
 * project and tree pages, a `.md` file on the blob page. Its links and
 * images resolve against `dir` at the commit `at`, so they stay inside the
 * project at that commit.
 *
 * react-markdown builds React elements (no `dangerouslySetInnerHTML`), so
 * the same component renders in the Worker and in the browser. What may
 * reach the page is decided by the plugin chain in `pipeline.ts`; this
 * file only draws the elements that come out of it.
 */
import type { CommitSha, ProjectName } from "@repo/protocol/ids";
import type { AnyRouter } from "@tanstack/react-router";
import { Link, useRouter } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import type { Components, ExtraProps } from "react-markdown";

import { rehypePluginsFor, remarkPlugins } from "./pipeline.ts";

export interface RepoMarkdownProps {
  /** The commit the file was read at; links and images point there. */
  readonly at: CommitSha;
  /** The file's directory, relative to the repo root; `""` is the root. */
  readonly dir: string;
  readonly project: ProjectName;
  /** The file's text. */
  readonly source: string;
}

type AnchorProps = ComponentProps<"a"> & ExtraProps;

/** A path on this origin (`/p/blob/…`), as `resolve.ts` leaves every in-project link. */
const isSameOrigin = (href: string) =>
  href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");

/**
 * A link inside the project: a router `Link` when a router is there (the
 * app), so it opens without a full load; a plain link when none is (a
 * view rendered on its own, as the pages' tests render it).
 */
const ProjectLink = ({
  children,
  href,
  // The sanitizer never lets a `target` through.
  target: _target,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { readonly href: string }) => {
  // Outside a router the context holds `null`, whatever the hook's type says.
  const router: AnyRouter | null | undefined = useRouter({ warn: false });

  return router === null || router === undefined ? (
    <a {...props} href={href}>
      {children}
    </a>
  ) : (
    <Link {...props} to={href}>
      {children}
    </Link>
  );
};

/** `a`: in-project links through the router; links that leave go with no referrer and no endorsement. */
const Anchor = ({ children, href, node: _node, ...props }: AnchorProps) => {
  if (href !== undefined && isSameOrigin(href)) {
    return (
      <ProjectLink {...props} href={href}>
        {children}
      </ProjectLink>
    );
  }

  if (href === undefined || href === "" || href.startsWith("#")) {
    return (
      <a {...props} href={href}>
        {children}
      </a>
    );
  }

  return (
    <a {...props} href={href} rel="nofollow noopener noreferrer">
      {children}
    </a>
  );
};

/** `img`: loaded when scrolled to, decoded off the main thread, and sent with no referrer. */
const Image = ({
  alt,
  node: _node,
  ...props
}: ComponentProps<"img"> & ExtraProps) => (
  <img
    {...props}
    alt={alt ?? ""}
    decoding="async"
    loading="lazy"
    referrerPolicy="no-referrer"
  />
);

const components: Components = { a: Anchor, img: Image };

export const RepoMarkdown = ({
  at,
  dir,
  project,
  source,
}: RepoMarkdownProps): ReactNode => (
  <div className="prose prose-sm dark:prose-invert max-w-none">
    <Markdown
      components={components}
      rehypePlugins={rehypePluginsFor({ dir, project, sha: at })}
      remarkPlugins={remarkPlugins}
      urlTransform={defaultUrlTransform}
    >
      {source}
    </Markdown>
  </div>
);

/** A README that is not Markdown (`README`, `README.txt`, `README.rst`): its text as written. */
export const RepoText = ({
  source,
}: {
  readonly source: string;
}): ReactNode => (
  <pre className="overflow-x-auto font-mono text-sm whitespace-pre-wrap">
    {source}
  </pre>
);

const markdownExtension = /\.(?:markdown|md|mdown|mdwn|mkd|mkdn)$/iu;

/** Whether a file renders as Markdown (`RepoMarkdown`) or as text (`RepoText`), by its name. */
export const isMarkdownPath = (path: string) => markdownExtension.test(path);
