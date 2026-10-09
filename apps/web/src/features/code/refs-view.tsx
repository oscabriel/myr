/**
 * A project's refs as a reader sees them: main at its landed commit, the
 * tags (newest first, as `listRefs` orders them, `TAGS_PAGE` a page), and
 * the forks: each claim's, linking the answer page of its ask, and each
 * person's working fork. Only what `listRefs` returns is shown, so the
 * platform's own refs never appear. The page says tags, never releases: a release is something else here.
 *
 * A monorepo's tags version several packages (`@changesets/cli@2.27.1`):
 * when they hold more than one, a list of packages, each with its newest
 * tag and its count, sits above the tags, and `?package=` lists one
 * package's tags alone.
 */
import type { RefsView as Refs, TagRef } from "@repo/protocol/domain/code";
import { Schema } from "effect";

import { answerPath } from "../ask/ask-page.tsx";
import { ProjectNav } from "../project/project-nav.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { PageShell } from "../shared/layout.tsx";
import { Pager } from "./pager.tsx";
import { commitHref, shortSha, treeHref } from "./paths.ts";

/**
 * The package a tag versions, by the platform's rule (`packageOf` in
 * `@repo/project/code/refs`, which orders the tags; a test holds the two
 * equal): the name before its last `@` past the first character.
 */
export const packageOfTag = (tag: string): string | undefined => {
  const at = tag.lastIndexOf("@");

  return at > 0 ? tag.slice(0, at) : undefined;
};

/** A `?package=` from the address, decoded; none for anything but a name. */
export const packageParamOf = Schema.decodeUnknownOption(
  Schema.NonEmptyString.check(Schema.isMaxLength(255))
);

/** One package's tags: its name, its newest tag and how many it has. */
interface PackageRun {
  readonly count: number;
  readonly name: string;
  readonly newest: TagRef;
}

/**
 * The packages the tags version, in the order `listRefs` gives their
 * runs (most tags first), each with the first, so newest, of its tags.
 */
const packagesOf = (tags: readonly TagRef[]): readonly PackageRun[] => {
  const runs = new Map<string, PackageRun>();

  for (const tag of tags) {
    const name = packageOfTag(tag.name);

    if (name !== undefined) {
      const run = runs.get(name);

      runs.set(name, {
        count: (run?.count ?? 0) + 1,
        name,
        newest: run?.newest ?? tag,
      });
    }
  }

  return [...runs.values()];
};

/** How many tags a page lists. */
export const TAGS_PAGE = 100;

const LINK = "decoration-rule underline hover:decoration-current";

const ID = "font-mono text-[0.8125rem]";

const SECTION = "text-lg font-semibold tracking-[-0.01em]";

/** The refs page from the `from`th tag, of one package's tags or all. */
const refsHref = (project: string, from: number, only?: string) => {
  const search = [
    ...(only === undefined ? [] : [`package=${encodeURIComponent(only)}`]),
    ...(from > 0 ? [`from=${from}`] : []),
  ].join("&");

  return search === "" ? `/${project}/refs` : `/${project}/refs?${search}`;
};

const Packages = ({
  packages,
  project,
}: {
  readonly packages: readonly PackageRun[];
  readonly project: Refs["project"];
}) => (
  <section aria-labelledby="packages" className="flex flex-col gap-2">
    <h2 className={SECTION} id="packages">
      Packages{" "}
      <span className="text-muted-foreground text-sm font-normal">
        {packages.length}
      </span>
    </h2>
    <ul className="border-rule flex flex-col border-b">
      {packages.map(({ count, name, newest }) => (
        <li
          className={`border-rule flex flex-wrap items-baseline justify-between gap-x-4 border-t py-2 ${ID}`}
          data-package={name}
          key={name}
        >
          <a
            className={`${LINK} [overflow-wrap:anywhere]`}
            href={refsHref(project, 0, name)}
          >
            {name}
          </a>
          <span className="text-muted-foreground flex flex-wrap items-baseline gap-x-4">
            <a
              className={`${LINK} [overflow-wrap:anywhere]`}
              href={treeHref(project, newest.name)}
              title="Newest tag"
            >
              {newest.name}
            </a>
            <span title="Tags">{count}</span>
          </span>
        </li>
      ))}
    </ul>
  </section>
);

export const RefsView = ({
  from = 0,
  package: only,
  refs,
}: {
  /** The first tag this page lists. */
  readonly from?: number;
  /** The one package whose tags this page lists; all when none. */
  readonly package?: string | undefined;
  readonly refs: Refs;
}) => {
  const { forks, landed, project } = refs;
  const packages = packagesOf(refs.tags);

  const tags =
    only === undefined
      ? refs.tags
      : refs.tags.filter((tag) => packageOfTag(tag.name) === only);

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
      {only === undefined && packages.length > 1 ? (
        <Packages packages={packages} project={project} />
      ) : null}
      <section aria-labelledby="tags" className="flex flex-col gap-2">
        <h2 className={SECTION} id="tags">
          {only === undefined ? "Tags" : `Tags of ${only}`}{" "}
          <span className="text-muted-foreground text-sm font-normal">
            {tags.length}
          </span>
        </h2>
        {only === undefined ? null : (
          <p className="text-sm">
            <a className={LINK} href={refsHref(project, 0)}>
              All tags
            </a>
          </p>
        )}
        {tags.length === 0 ? (
          <EmptyState
            title={only === undefined ? "No tags." : `No tags for ${only}.`}
          />
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
              ? refsHref(project, Math.max(0, from - TAGS_PAGE), only)
              : undefined
          }
          older={
            from + TAGS_PAGE < tags.length
              ? refsHref(project, from + TAGS_PAGE, only)
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
