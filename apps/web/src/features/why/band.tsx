/**
 * Who put lines there, in one line, ask and answer first and the commit
 * second: "format-ordinal · answered by bram · 9b1c3e5 · 3 d ago". An
 * ask's opening reads "opened format-ordinal · by ines-v · …"; a decider's
 * own landing "landed by okonkwo · …"; a commit the project adopted, its
 * subject and author, "before adoption". Each part is a link: the ask, the
 * answer, the commit. No credit count and no colour by age: neither is a
 * state.
 *
 * Used by a why group's band, and by a file's facts for the landing that
 * last touched it.
 */
import type { CommitView } from "@repo/protocol/domain/code";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";
import type { DateTime } from "effect";
import { Fragment } from "react";
import type { ReactElement } from "react";

import { commitHref, shortSha } from "../code/paths.ts";
import { AppLink } from "../shared/link.tsx";
import { answerPath, askPath, personPath } from "../shared/paths.ts";
import { When } from "../shared/time.tsx";
import { askOf } from "./rows.ts";

const LINK = "decoration-rule underline hover:decoration-current";

const CODE_LINK = `text-mono font-mono ${LINK}`;

/** Parts parted by a muted ` · `. */
const Parted = ({ parts }: { readonly parts: readonly ReactElement[] }) =>
  parts.map((part, index) => (
    <Fragment key={String(part.key)}>
      {index === 0 ? null : (
        <span aria-hidden="true" className="text-muted-foreground">
          {" · "}
        </span>
      )}
      {part}
    </Fragment>
  ));

/** What the landing did, ask first: answered, opened, or landed by a decider. */
const landingParts = (
  landing: LandingView,
  project: ProjectName
): readonly ReactElement[] => {
  const linked = Option.getOrUndefined(askOf(landing));

  if (linked === undefined) {
    return [
      <span key="by">
        landed by{" "}
        <AppLink className={LINK} to={personPath(landing.author)}>
          {landing.author}
        </AppLink>
      </span>,
    ];
  }

  if (linked.kind === "opened") {
    return [
      <span key="ask">
        opened{" "}
        <AppLink className={CODE_LINK} to={askPath(project, linked.ask)}>
          {linked.ask}
        </AppLink>
      </span>,
      <span key="by">
        by{" "}
        <AppLink className={LINK} to={personPath(landing.author)}>
          {landing.author}
        </AppLink>
      </span>,
    ];
  }

  return [
    <AppLink className={CODE_LINK} key="ask" to={askPath(project, linked.ask)}>
      {linked.ask}
    </AppLink>,
    <AppLink className={LINK} key="answer" to={answerPath(project, linked.ask)}>
      answered by {landing.author}
    </AppLink>,
  ];
};

/** A commit the project adopted: its subject, its author, and that it came before adoption. */
const adoptedParts = (
  commit: CommitView | undefined
): readonly ReactElement[] => {
  const subject = commit?.subject ?? "";

  return [
    <span className="min-w-0" key="subject">
      {subject === "" ? "(no subject)" : subject}
    </span>,
    <span key="author">{commit?.author.name ?? "unknown"}</span>,
    <span className="text-muted-foreground" key="adopted">
      before adoption
    </span>,
  ];
};

/** The line for a commit, and its landing when the platform landed it. */
export const LandingWords = ({
  commit,
  landing,
  now,
  project,
  sha,
}: {
  readonly project: ProjectName;
  /** The commit's id (all a line has when the walk did not return the commit). */
  readonly sha: string;
  readonly commit: Option.Option<CommitView>;
  readonly landing: Option.Option<LandingView>;
  readonly now: DateTime.Utc;
}) => {
  const landed = Option.getOrUndefined(landing);
  const adopted = Option.getOrUndefined(commit);
  const at = landed?.landedAt ?? adopted?.committer.at;

  const what =
    landed === undefined
      ? adoptedParts(adopted)
      : landingParts(landed, project);

  const when =
    at === undefined
      ? []
      : [
          <span className="text-muted-foreground tabular-nums" key="when">
            <When at={at} now={now} />
          </span>,
        ];

  return (
    <Parted
      parts={[
        ...what,
        <AppLink className={CODE_LINK} key="sha" to={commitHref(project, sha)}>
          {shortSha(sha)}
        </AppLink>,
        ...when,
      ]}
    />
  );
};
