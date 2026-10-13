import type { CommitSha, ProjectName } from "@repo/protocol/ids";
import type { AnyRouter, RegisteredRouter } from "@tanstack/react-router";
import { Link, useRouter } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import type { Components, ExtraProps } from "react-markdown";

import { literalPath } from "../shared/link.tsx";
import { rehypePluginsFor, remarkPlugins, sitePlugins } from "./pipeline.ts";

export interface RepoMarkdownProps {
  readonly at: CommitSha;
  readonly dir: string;
  readonly project: ProjectName;
  readonly source: string;
}

type AnchorProps = ComponentProps<"a"> & ExtraProps;

const isSameOrigin = (href: string) =>
  href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");

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
    // `href`, not `to`: the router parses a built href into path, query and
    // fragment, where `to` would keep `?raw=1#L3` inside the path.
    // `literalPath` escapes its `$` and braces, so a file's name is never a
    // param.
    <Link<RegisteredRouter, string, string> {...props} href={literalPath(href)}>
      {children}
    </Link>
  );
};

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

const PROSE_BASE = [
  "prose prose-tokens text-body max-w-[70ch] min-w-0",
  "prose-headings:font-semibold prose-headings:tracking-[-0.01em]",
  "prose-code:before:content-none prose-code:after:content-none prose-code:font-normal",
  "[&_:not(pre)>code]:bg-surface [&_:not(pre)>code]:text-mono [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px",
  "prose-pre:bg-surface prose-pre:text-foreground prose-pre:border prose-pre:border-rule prose-pre:rounded-none",
  "prose-pre:text-mono prose-pre:leading-terminal prose-pre:px-4 prose-pre:py-3",
  "prose-a:font-normal prose-a:decoration-input hover:prose-a:decoration-foreground",
  "prose-blockquote:font-normal prose-blockquote:not-italic",
  "[&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none",
  "prose-img:my-0 prose-img:inline-block prose-img:max-w-full",
  "prose-table:text-ui prose-th:font-semibold",
];

/** A page's own Markdown: its `#` is the page's one h1. */
const PROSE = [
  ...PROSE_BASE,
  "prose-h1:text-title prose-h1:mb-3 prose-h1:border-b prose-h1:border-rule prose-h1:pb-2",
  "prose-h2:text-title prose-h2:mt-8 prose-h2:mb-3",
  "prose-h3:text-want prose-h4:text-want",
].join(" ");

/** A README, its headings a level down (`rehypeShiftHeadings`), drawn as they were before the shift. */
const README_PROSE = [
  ...PROSE_BASE,
  "prose-h2:text-title prose-h2:mt-0 prose-h2:mb-3 prose-h2:border-b prose-h2:border-rule prose-h2:pb-2",
  "prose-h3:text-title prose-h3:mt-8 prose-h3:mb-3",
  "prose-h4:text-want prose-h5:text-want",
].join(" ");

export const RepoMarkdown = ({
  at,
  dir,
  project,
  source,
}: RepoMarkdownProps): ReactNode => (
  <div className={README_PROSE}>
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

export const SiteMarkdown = ({
  source,
}: {
  readonly source: string;
}): ReactNode => (
  <div className={PROSE}>
    <Markdown
      components={components}
      rehypePlugins={sitePlugins}
      remarkPlugins={remarkPlugins}
      urlTransform={defaultUrlTransform}
    >
      {source}
    </Markdown>
  </div>
);

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

export const isMarkdownPath = (path: string) => markdownExtension.test(path);
