/**
 * The docs on the web: the index, every page under Guides then Reference
 * with its summary, and one page, its Markdown under its title with the
 * pages listed in the inspector. Every word on them is `@repo/agent-kit`'s
 * (`docPages`); a view: pages in, markup out.
 */
import type { DocPage, DocPart } from "@repo/agent-kit/docs/index";

import { SiteMarkdown } from "../markdown/markdown.tsx";
import { AppLink } from "../shared/link.tsx";
import { docsPath } from "../shared/paths.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { docsMarkdownPath } from "./head.ts";

/** Each part's heading, in the order the index shows them. */
const PARTS = [
  { part: "guide", title: "Guides" },
  { part: "reference", title: "Reference" },
] as const satisfies readonly { part: DocPart; title: string }[];

const LINK =
  "decoration-rule hover:decoration-foreground underline underline-offset-4";

/** Only the page itself is current. */
const EXACT = { exact: true, includeSearch: false } as const;

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

/** The pages, for the inspector: the one being read is current. */
const Contents = ({ pages }: { readonly pages: readonly DocPage[] }) => (
  <nav aria-label="Docs">
    {PARTS.map(({ part, title }) => (
      <div className="mb-3" key={part}>
        <h3 className="text-label text-muted-foreground pb-1">{title}</h3>
        <ul className="flex flex-col gap-px">
          {pages
            .filter((page) => page.part === part)
            .map(({ slug, title: pageTitle }) => (
              <li key={slug}>
                <AppLink
                  activeOptions={EXACT}
                  className="text-ui hover:bg-surface [&[aria-current]]:bg-surface flex min-h-8 items-center px-2 no-underline [&[aria-current]]:font-semibold"
                  to={docsPath(slug)}
                >
                  {pageTitle}
                </AppLink>
              </li>
            ))}
        </ul>
      </div>
    ))}
  </nav>
);

/** A page's Markdown past its title and summary, which the page head shows. */
const bodyOf = ({ markdown, summary, title }: DocPage) =>
  markdown.slice(`# ${title}\n\n${summary}\n\n`.length);

export const DocsPageView = ({
  page,
  pages,
}: {
  readonly page: DocPage;
  readonly pages: readonly DocPage[];
}) => (
  <Workspace
    crumbs={[{ label: "Docs", to: docsPath() }, { label: page.title }]}
    facts={<Contents pages={pages} />}
    factsHeading="Docs"
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
