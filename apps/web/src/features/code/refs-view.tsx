/**
 * A project's refs as a reader sees them: main at its landed commit, the
 * tags (newest first, as `listRefs` orders them, `TAGS_PAGE` a page), and
 * the forks: each claim's, linking the answer page of its ask, and each
 * person's working fork. Only what `listRefs` returns is shown, so the
 * platform's own refs never appear. The page says tags, never releases: a release is something else here.
 */
import type { RefsView as Refs } from "@repo/protocol/domain/code";

import { answerPath } from "../ask/ask-page.tsx";
import { ProjectNav } from "../project/project-nav.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { PageShell } from "../shared/layout.tsx";
import { Pager } from "./pager.tsx";
import { commitHref, shortSha, treeHref } from "./paths.ts";

/** How many tags a page lists. */
export const TAGS_PAGE = 100;

const LINK = "decoration-rule underline hover:decoration-current";

const ID = "font-mono text-[0.8125rem]";

const SECTION = "text-lg font-semibold tracking-[-0.01em]";

/** The refs page from the `from`th tag. */
const refsHref = (project: string, from: number) =>
  from > 0 ? `/${project}/refs?from=${from}` : `/${project}/refs`;

export const RefsView = ({
  from = 0,
  refs,
}: {
  /** The first tag this page lists. */
  readonly from?: number;
  readonly refs: Refs;
}) => {
  const { forks, landed, project, tags } = refs;
  const shown = tags.slice(from, from + TAGS_PAGE);
  const claims = forks.filter((fork) => fork.kind === "claim");
  const working = forks.filter((fork) => fork.kind === "working");

  return (
    <PageShell title={`${project}: refs`}>
      <ProjectNav current="refs" project={project} />
      <section
        aria-labelledby="main-ref"
        className="flex flex-col gap-2"
        data-ref="main"
      >
        <h2 className={SECTION} id="main-ref">
          main
        </h2>
        {landed === undefined ? (
          <EmptyState title="Nothing has landed on main yet." />
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
            <span>Landed at</span>
            <a
              className={`${ID} ${LINK}`}
              href={commitHref(project, landed)}
              title={landed}
            >
              {shortSha(landed)}
            </a>
            <a className={LINK} href={treeHref(project, "main")}>
              Browse files
            </a>
          </p>
        )}
      </section>
      <section aria-labelledby="tags" className="flex flex-col gap-2">
        <h2 className={SECTION} id="tags">
          Tags{" "}
          <span className="text-muted-foreground text-sm font-normal">
            {tags.length}
          </span>
        </h2>
        {tags.length === 0 ? (
          <EmptyState title="No tags." />
        ) : (
          <ol className="border-rule flex flex-col border-b">
            {shown.map((tag) => (
              <li
                className={`border-rule flex flex-wrap items-baseline justify-between gap-x-4 border-t py-2 ${ID}`}
                data-tag={tag.name}
                key={tag.name}
              >
                <a
                  className={`${LINK} [overflow-wrap:anywhere]`}
                  href={treeHref(project, tag.name)}
                >
                  {tag.name}
                </a>
                <a
                  className={`${LINK} text-muted-foreground`}
                  href={commitHref(project, tag.sha)}
                >
                  {shortSha(tag.sha)}
                </a>
              </li>
            ))}
          </ol>
        )}
        <Pager
          newer={
            from > 0
              ? refsHref(project, Math.max(0, from - TAGS_PAGE))
              : undefined
          }
          older={
            from + TAGS_PAGE < tags.length
              ? refsHref(project, from + TAGS_PAGE)
              : undefined
          }
        />
      </section>
      <section aria-labelledby="forks" className="flex flex-col gap-2">
        <h2 className={SECTION} id="forks">
          Forks
        </h2>
        {forks.length === 0 ? (
          <EmptyState title="No forks: nobody holds a claim or a working fork." />
        ) : (
          <ul className="border-rule flex flex-col border-b text-sm">
            {claims.map((fork) => (
              <li
                className="border-rule flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t py-2"
                data-fork={fork.repo}
                key={fork.repo}
              >
                <code className={`${ID} [overflow-wrap:anywhere]`}>
                  {fork.repo}
                </code>
                {fork.ask === undefined ? null : (
                  <a className={LINK} href={answerPath(project, fork.ask)}>
                    Answer to {fork.ask}
                  </a>
                )}
                <HandleLink handle={fork.handle} />
                {fork.state === undefined ? null : (
                  <span className="text-muted-foreground">
                    Claim {fork.state}
                  </span>
                )}
              </li>
            ))}
            {working.map((fork) => (
              <li
                className="border-rule flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t py-2"
                data-fork={fork.repo}
                key={fork.repo}
              >
                <code className={`${ID} [overflow-wrap:anywhere]`}>
                  {fork.repo}
                </code>
                <span>
                  Working fork of <HandleLink handle={fork.handle} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
};
