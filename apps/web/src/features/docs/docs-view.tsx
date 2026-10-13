import type { DocPage, DocPart } from "@repo/agent-kit/docs/index";
import { cn } from "cn";
import { Check, Copy, FileText } from "lucide-react";

import { Button, buttonVariants } from "../../components/ui/button.tsx";
import { SiteMarkdown } from "../markdown/markdown.tsx";
import { useCopy } from "../shared/copy-action.tsx";
import { AppLink } from "../shared/link.tsx";
import { docsPath } from "../shared/paths.ts";
import { ContextBar } from "../shared/shell/context-bar.tsx";
import { GUTTER } from "../shared/shell/gutter.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { docBody, docHeadings } from "./article.ts";
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

const PART_TITLE = {
  guide: "Guides",
  reference: "Reference",
} as const satisfies Record<DocPart, string>;

const CONTENTS_LINK =
  "text-ui text-muted-foreground hover:text-foreground flex min-h-8 items-center py-1 no-underline transition-colors duration-[120ms]";

/** Merged, so the outline's control border wins over the base's transparent one. */
const MARKDOWN_LINK = cn(
  buttonVariants({ variant: "outline" }),
  "justify-start no-underline"
);

const CopyMarkdown = ({ markdown }: { readonly markdown: string }) => {
  const { copied, copy } = useCopy(markdown);

  return (
    <Button
      className="justify-start"
      onClick={copy}
      type="button"
      variant="outline"
    >
      {copied ? (
        <Check aria-hidden="true" strokeWidth={1.75} />
      ) : (
        <Copy aria-hidden="true" strokeWidth={1.75} />
      )}
      <span aria-live="polite">{copied ? "Copied" : "Copy as Markdown"}</span>
    </Button>
  );
};

/** The page's headings and its Markdown, beside the article from `columns`, under it below. */
const OnThisPage = ({ page }: { readonly page: DocPage }) => {
  const headings = docHeadings(page);

  return (
    <aside
      aria-label="On this page"
      className="border-rule columns:sticky columns:top-[calc(var(--top-bar)+1.5rem)] columns:self-start columns:border-t-0 columns:pt-0 columns:mt-0 mt-8 flex min-w-0 flex-col gap-6 border-t pt-6"
      data-column="toc"
    >
      {headings.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <h2 className="text-ui font-semibold">On this page</h2>
          <ul className="flex flex-col">
            {headings.map(({ id, text }) => (
              <li key={id}>
                {/* An anchor in this page, not a page of its own. */}
                <a className={CONTENTS_LINK} href={`#${id}`}>
                  {text}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <CopyMarkdown markdown={page.markdown} />
        {/* A server route, not a page of the app. */}
        <a className={MARKDOWN_LINK} href={docsMarkdownPath(page.slug)}>
          <FileText aria-hidden="true" strokeWidth={1.75} />
          View as .md
        </a>
      </div>
    </aside>
  );
};

/**
 * The docs shell's main column: the article at the measure, then "On this
 * page", which stands to its right from `columns`.
 */
export const DocsPageView = ({ page }: { readonly page: DocPage }) => (
  <main
    className="flex min-w-0 flex-1 flex-col outline-none"
    data-scroll-restoration-id="main"
    id="main"
    tabIndex={-1}
  >
    <ContextBar
      crumbs={[
        { label: "Docs", to: docsPath() },
        { label: PART_TITLE[page.part] },
        { label: page.title },
      ]}
    />
    <div
      className={`columns:grid columns:grid-cols-[minmax(0,1fr)_var(--column-docs-toc)] columns:gap-x-14 flex flex-col pt-6 pb-16 ${GUTTER}`}
    >
      <article className="max-w-(--measure) min-w-0" data-doc={page.slug}>
        <h1 className="text-headline text-balance break-words">{page.title}</h1>
        <p className="text-want mt-3 mb-6 font-normal">{page.summary}</p>
        <SiteMarkdown source={docBody(page)} />
      </article>
      <OnThisPage page={page} />
    </div>
  </main>
);
