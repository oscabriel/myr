import { packageOf } from "@repo/protocol/domain/code";
import type {
  ForkRef,
  RefsView as Refs,
  TagRef,
} from "@repo/protocol/domain/code";
import { defaultStringifySearch } from "@tanstack/react-router";
import { Option } from "effect";
import type { ReactNode } from "react";

import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { FactBlock } from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { answerPath, personPath } from "../shared/paths.ts";
import {
  CLAIM_STATES,
  MetaCode,
  MetaLine,
  Row,
  RowGroup,
  RowList,
} from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { Pager } from "./pager.tsx";
import { commitHref, shortSha, treeHref } from "./paths.ts";

interface PackageRun {
  readonly count: number;
  readonly name: string;
  readonly newest: TagRef;
}

const packagesOf = (tags: readonly TagRef[]): readonly PackageRun[] => {
  const runs = new Map<string, PackageRun>();

  for (const tag of tags) {
    const name = Option.getOrUndefined(packageOf(tag.name));

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

export const TAGS_PAGE = 100;

const refsPath = (project: string) => `/${project}/refs`;

/**
 * The router writes the search, so a name it would read back as JSON (a package
 * called `2048`) is quoted.
 */
const refsHref = (project: string, from: number, only?: string) =>
  `${refsPath(project)}${defaultStringifySearch({
    package: only,
    from: from > 0 ? from : undefined,
  })}`;

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const META_LINK =
  "decoration-rule relative z-10 underline hover:decoration-current";

const CommitLink = ({
  project,
  sha,
}: {
  readonly project: Refs["project"];
  readonly sha: string;
}) => (
  <AppLink
    className={`text-mono font-mono ${META_LINK}`}
    title={sha}
    to={commitHref(project, sha)}
  >
    {shortSha(sha)}
  </AppLink>
);

const Person = ({ handle }: { readonly handle: ForkRef["handle"] }) => (
  <span className="relative z-10">
    <HandleLink handle={handle} />
  </span>
);

const Group = ({
  children,
  counts,
  empty,
  facts,
  name,
}: {
  readonly name: string;
  readonly counts?: string;
  readonly facts?: ReactNode;
  readonly empty?: string | undefined;
  readonly children: ReactNode;
}) => (
  <div className="flex min-w-0 flex-col gap-3">
    <RowGroup
      {...(counts === undefined ? {} : { counts })}
      facts={facts}
      label={name}
      name={name}
      under="bar"
    >
      {children}
    </RowGroup>
    {empty === undefined ? null : <EmptyState title={empty} />}
  </div>
);

const MainRow = ({ refs }: { readonly refs: Refs }) => {
  const { landed, project } = refs;

  return landed === undefined ? (
    <section aria-label="main" className="flex flex-col" data-ref="main">
      <EmptyState title="Nothing has landed on main yet." />
    </section>
  ) : (
    <RowList label="main">
      <Row
        action={
          <AppLink
            className={`text-ui shrink-0 self-start leading-6 font-medium ${META_LINK}`}
            to={treeHref(project, "main")}
          >
            Browse files
          </AppLink>
        }
        data={{ "data-ref": "main" }}
        href={treeHref(project, "main")}
        id="main"
        meta={
          <MetaLine
            parts={[
              "moves only by a landing",
              <span key="at">
                landed at <CommitLink project={project} sha={landed} />
              </span>,
            ]}
          />
        }
        mono
        state={{ mark: "landed", word: "Landed" }}
        title="main"
      />
    </RowList>
  );
};

const Packages = ({
  packages,
  project,
}: {
  readonly packages: readonly PackageRun[];
  readonly project: Refs["project"];
}) => (
  <Group
    counts={plural(packages.length, "package", "packages")}
    name="Packages"
  >
    {packages.map(({ count, name, newest }) => (
      <Row
        data={{ "data-package": name }}
        href={refsPath(project)}
        id={`package:${name}`}
        key={name}
        meta={
          <MetaLine
            parts={[
              <AppLink
                className={`text-mono font-mono ${META_LINK}`}
                key="newest"
                title="Newest tag"
                to={treeHref(project, newest.name)}
              >
                {newest.name}
              </AppLink>,
              plural(count, "tag", "tags"),
            ]}
          />
        }
        mono
        search={{ package: name }}
        size="one-line"
        title={name}
      />
    ))}
  </Group>
);

const TagRow = ({
  project,
  tag,
}: {
  readonly project: Refs["project"];
  readonly tag: TagRef;
}) => (
  <Row
    data={{ "data-tag": tag.name }}
    href={treeHref(project, tag.name)}
    id={`tag:${tag.name}`}
    meta={<CommitLink project={project} sha={tag.sha} />}
    mono
    size="one-line"
    title={tag.name}
  />
);

const ClaimFork = ({
  fork,
  project,
}: {
  readonly fork: ForkRef;
  readonly project: Refs["project"];
}) => (
  <Row
    data={{ "data-fork": fork.repo, "data-state": fork.state }}
    href={
      fork.ask === undefined
        ? personPath(fork.handle)
        : answerPath(project, fork.ask)
    }
    id={fork.repo}
    meta={
      <MetaLine
        parts={[
          fork.ask === undefined ? undefined : (
            <span key="ask">
              answer to <MetaCode>{fork.ask}</MetaCode>
            </span>
          ),
          <Person handle={fork.handle} key="handle" />,
        ]}
      />
    }
    mono
    size="one-line"
    state={fork.state === undefined ? undefined : CLAIM_STATES[fork.state]}
    title={fork.repo}
  />
);

const WorkingFork = ({ fork }: { readonly fork: ForkRef }) => (
  <Row
    data={{ "data-fork": fork.repo }}
    href={personPath(fork.handle)}
    id={fork.repo}
    meta={
      <>
        Working fork of <Person handle={fork.handle} />
      </>
    }
    mono
    size="one-line"
    title={fork.repo}
  />
);

const noTags = (only: string | undefined) =>
  only === undefined ? "No tags." : `No tags for ${only}.`;

const Facts = ({
  platformUrl,
  project,
}: {
  readonly platformUrl: string;
  readonly project: Refs["project"];
}) => (
  <>
    <FactBlock label="Clone it">
      <CommandLine
        command={`git clone ${platformUrl}/${project}.git`}
        numbered
      />
    </FactBlock>
    <FactBlock label="Claim forks">
      <p className="text-ui text-muted-foreground">
        A claim fork is the copy a claim gives its claimant, the one place their
        answer is pushed.
      </p>
    </FactBlock>
  </>
);

export const RefsView = ({
  from = 0,
  package: only,
  platformUrl,
  refs,
}: {
  readonly from?: number | undefined;
  readonly package?: string | undefined;
  readonly platformUrl: string;
  readonly refs: Refs;
}) => {
  const { forks, landed, project } = refs;
  const packages = packagesOf(refs.tags);

  const tags =
    only === undefined
      ? refs.tags
      : refs.tags.filter(
          (tag) => Option.getOrUndefined(packageOf(tag.name)) === only
        );

  const shown = tags.slice(from, from + TAGS_PAGE);
  const claims = forks.filter((fork) => fork.kind === "claim");
  const working = forks.filter((fork) => fork.kind === "working");

  return (
    <Workspace
      facts={<Facts platformUrl={platformUrl} project={project} />}
      factsHeading="These refs"
      meta={
        <MetaLine
          parts={[
            landed === undefined
              ? "main has not landed"
              : `main at ${shortSha(landed)}`,
            plural(refs.tags.length, "tag", "tags"),
            plural(claims.length, "claim fork", "claim forks"),
          ]}
        />
      }
      title="Refs"
    >
      <MainRow refs={refs} />
      {only === undefined && packages.length > 1 ? (
        <Packages packages={packages} project={project} />
      ) : null}
      <div className="flex min-w-0 flex-col gap-3">
        <Group
          counts={plural(tags.length, "tag", "tags")}
          empty={tags.length === 0 ? noTags(only) : undefined}
          facts={
            only === undefined ? undefined : (
              <AppLink
                className="decoration-rule underline hover:decoration-current"
                to={refsPath(project)}
              >
                All tags
              </AppLink>
            )
          }
          name={only === undefined ? "Tags" : `Tags of ${only}`}
        >
          {shown.map((tag) => (
            <TagRow key={tag.name} project={project} tag={tag} />
          ))}
        </Group>
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
      </div>
      {forks.length === 0 ? (
        <Group
          empty="No forks: nobody holds a claim or a working fork."
          name="Forks"
        >
          {null}
        </Group>
      ) : (
        <>
          {claims.length === 0 ? null : (
            <Group
              counts={plural(claims.length, "fork", "forks")}
              name="Claim forks"
            >
              {claims.map((fork) => (
                <ClaimFork fork={fork} key={fork.repo} project={project} />
              ))}
            </Group>
          )}
          {working.length === 0 ? null : (
            <Group
              counts={plural(working.length, "fork", "forks")}
              name="Working forks"
            >
              {working.map((fork) => (
                <WorkingFork fork={fork} key={fork.repo} />
              ))}
            </Group>
          )}
        </>
      )}
    </Workspace>
  );
};
