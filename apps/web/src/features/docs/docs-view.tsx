import type { DocPage, DocPart } from "@repo/agent-kit/docs/index";

import { SiteMarkdown } from "../markdown/markdown.tsx";
import { AppLink } from "../shared/link.tsx";
import { docsPath } from "../shared/paths.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { docsMarkdownPath } from "./head.ts";

const PARTS = [
  { part: "guide", title: "Guides" },
  { part: "reference", title: "Reference" },
] as const satisfies readonly { part: DocPart; title: string }[];

const LINK =
  "decoration-rule hover:decoration-foreground underline underline-offset-4";

export const DocsIndexView = ({
  pages,
}: {
  readonly pages: readonly DocPage[];
}) => (
  <Workspace title="Docs">
    {PARTS.map(({ part, title }) => (
      <section aria-labelledby={`docs-${part}`} className="mb-8" key={part}>
        <h2 className="text-title mb-3 font-semibold" id={`docs-${part}`}>
          {title}
        </h2>
        <ul className="border-rule divide-rule divide-y border-y">
          {pages
            .filter((page) => page.part === part)
            .map(({ slug, summary, title: pageTitle }) => (
              <li className="flex flex-col gap-0.5 py-3" key={slug}>
                <AppLink
                  className={`text-want font-medium ${LINK}`}
                  to={docsPath(slug)}
                >
                  {pageTitle}
                </AppLink>
                <p className="text-ui text-muted-foreground">{summary}</p>
              </li>
            ))}
        </ul>
      </section>
    ))}
  </Workspace>
);

const bodyOf = ({ markdown, summary, title }: DocPage) =>
  markdown.slice(`# ${title}\n\n${summary}\n\n`.length);

export const DocsPageView = ({ page }: { readonly page: DocPage }) => (
  <Workspace
    crumbs={[{ label: "Docs", to: docsPath() }, { label: page.title }]}
    meta={
      <>
        {page.summary} As Markdown:{" "}
        {/* A server route, not a page of the app. */}
        <a
          className={`text-foreground ${LINK}`}
          href={docsMarkdownPath(page.slug)}
        >
          {`${page.slug}.md`}
        </a>
      </>
    }
    title={page.title}
  >
    <SiteMarkdown source={bodyOf(page)} />
  </Workspace>
);
