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
import type { AnyRouter, RegisteredRouter } from "@tanstack/react-router";
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
    // `href`, not `to`: the router parses a built href into path, query
    // and fragment, where `to` would keep `?raw=1#L3` inside the path. A
    // `string` target makes `to` optional in the Link's props.
    <Link<RegisteredRouter, string, string> {...props} href={href}>
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

/**
 * A README in the page's own type: body text at 16 px on a 70-character
 * measure, headings under the page's headline, code in the mono size on
 * the surface, links in ink. Colours come from the tokens
 * (`prose-tokens` in `styles.css`), so both schemes share these classes.
 */
const PROSE = [
  "prose prose-tokens text-body max-w-[70ch] min-w-0",
  // Headings on the scale: h1 and h2 at the title size, so the page's own
  // headline leads, the h1 ruled beneath; h3 and h4 at the want's size.
  "prose-headings:font-semibold prose-headings:tracking-[-0.01em]",
  "prose-h1:text-title prose-h1:mb-3 prose-h1:border-b prose-h1:border-rule prose-h1:pb-2",
  "prose-h2:text-title prose-h2:mt-8 prose-h2:mb-3",
  "prose-h3:text-want prose-h4:text-want",
  // Inline code: the mono face on a surface field, without backticks.
  "prose-code:before:content-none prose-code:after:content-none prose-code:font-normal",
  "[&_:not(pre)>code]:bg-surface [&_:not(pre)>code]:text-mono [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px",
  // A code block: a field on the surface, ruled in a hairline.
  "prose-pre:bg-surface prose-pre:text-foreground prose-pre:border prose-pre:border-rule prose-pre:rounded-none",
  "prose-pre:text-mono prose-pre:leading-terminal prose-pre:px-4 prose-pre:py-3",
  // Links: ink, underlined in a hairline that darkens under the pointer.
  "prose-a:font-normal prose-a:decoration-input hover:prose-a:decoration-foreground",
  // Quotes as plain indented text, without the plugin's quotation marks.
  "prose-blockquote:font-normal prose-blockquote:not-italic",
  "[&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none",
  // Images inside the measure, set in the line as a README sets them.
  "prose-img:my-0 prose-img:inline-block prose-img:max-w-full",
  "prose-table:text-ui prose-th:font-semibold",
].join(" ");

export const RepoMarkdown = ({
  at,
  dir,
  project,
  source,
}: RepoMarkdownProps): ReactNode => (
  <div className={PROSE}>
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
  <pre className="text-mono leading-terminal max-w-[70ch] overflow-x-auto font-mono whitespace-pre-wrap">
    {source}
  </pre>
);

const markdownExtension = /\.(?:markdown|md|mdown|mdwn|mkd|mkdn)$/iu;

/** Whether a file renders as Markdown (`RepoMarkdown`) or as text (`RepoText`), by its name. */
export const isMarkdownPath = (path: string) => markdownExtension.test(path);
