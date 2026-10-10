/**
 * What the ask page and the answer page read on the server, before either
 * draws: the subject, then what is read beside it (the project's events,
 * the family's parent, the check's source, the landing). A read beside the
 * subject that fails leaves its part out; the subject's own refusal is the
 * page's 404 (`notFoundFor`). The routes call these from their server
 * functions only, so none of it reaches the browser's first load.
 */
import { Client } from "@repo/protocol/contracts";
import { Verdict } from "@repo/protocol/domain/answer";
import { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  BlobSha,
  CommitSha,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
import type { LandedSha } from "@repo/protocol/ids";
import { notFound } from "@tanstack/react-router";
import { DateTime, Effect, Option, Schema } from "effect";

import { notFoundFor } from "../shared/refusals.ts";
import { keptEvents, readEvents, readParent } from "./subject.ts";

/** An ask's address, not yet decoded. */
export interface AskAddress {
  readonly ask: string;
  readonly project: string;
}

/** The address, decoded: names the platform could hold. */
const AskPath = Schema.Struct({ ask: AskId, project: ProjectName });

/** The check's file, as the page carries it. */
const CheckRead = Schema.Struct({
  path: RepoPath,
  sha: BlobSha,
  text: Schema.String,
});

/**
 * What the page's loader carries from the server, encoded: the ask and its
 * brief, the family's parent, the verdict on its latest answer, the
 * check's source, the events about them (and the last number of all the
 * project's), and when it was read.
 */
export const AskPageData = Schema.Struct({
  ask: Ask,
  brief: Schema.NonEmptyString,
  check: Schema.UndefinedOr(CheckRead),
  events: Schema.Array(ProjectEvent),
  lastSeq: Schema.Int,
  now: Schema.DateTimeUtcFromString,
  parent: Schema.UndefinedOr(Ask),
  verdict: Schema.UndefinedOr(Verdict),
});

export type AskPageData = typeof AskPageData.Type;

/** The check's source on main, when the check is a file that reads as text; none when it cannot be read. */
const readCheck = (ask: Ask) =>
  Effect.gen(function* () {
    if (!CheckSpec.guards.RedThenGreen(ask.check)) {
      return Option.none<typeof CheckRead.Type>();
    }

    const client = yield* Client;

    return yield* client
      .readFile({ path: ask.check.path, project: ask.project })
      .pipe(
        Effect.map(({ binary, path, sha, text }) =>
          binary || text === undefined
            ? Option.none()
            : Option.some({ path, sha, text })
        ),
        Effect.orElseSucceed(() => Option.none<typeof CheckRead.Type>())
      );
  });

/**
 * The page's reads: the ask, the project's events and the latest verdict
 * at once, then the family's parent (if it is in one) and the check's
 * source; or a not-found carrying the platform's refusal (a 404).
 */
export const readAsk = (params: AskAddress) =>
  Effect.gen(function* () {
    const path = yield* Schema.decodeEffect(AskPath)(params).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;

    const [read, events, verdict] = yield* Effect.all(
      [
        client.showAsk(path),
        readEvents(path.project),
        Effect.option(client.verdict(path)),
      ],
      { concurrency: "unbounded" }
    ).pipe(
      Effect.catchTags({
        UnknownAsk: notFoundFor,
        UnknownProject: notFoundFor,
      })
    );

    const [parent, check] = yield* Effect.all(
      [readParent(read.ask), readCheck(read.ask)],
      { concurrency: "unbounded" }
    );

    return yield* Schema.encodeEffect(AskPageData)({
      ...read,
      ...keptEvents(events, read.ask, Option.getOrUndefined(parent)),
      check: Option.getOrUndefined(check),
      now: yield* DateTime.now,
      parent: Option.getOrUndefined(parent),
      verdict: Option.getOrUndefined(
        Option.flatMap(verdict, (found) =>
          Option.fromUndefinedOr(found.verdict)
        )
      ),
    });
  });

/** The page's address, not yet decoded: the path's names and `?head=`. */
export interface AnswerAddress {
  readonly ask: string;
  readonly head?: string | undefined;
  readonly project: string;
}

/** The address, decoded: names the platform could hold, and a commit id. */
const AnswerPath = Schema.Struct({
  ask: AskId,
  head: Schema.optionalKey(CommitSha),
  project: ProjectName,
});

/**
 * What the page's loader carries from the server, encoded: the ask, the
 * verdict and its landing, the family's parent, the events about them (and
 * the last number of all the project's), and when it was read.
 */
export const AnswerPageData = Schema.Struct({
  ...AnswerPath.fields,
  askRead: Ask,
  brief: Schema.NonEmptyString,
  events: Schema.Array(ProjectEvent),
  landing: Schema.UndefinedOr(LandingView),
  lastSeq: Schema.Int,
  now: Schema.DateTimeUtcFromString,
  parent: Schema.UndefinedOr(Ask),
  verdict: Schema.UndefinedOr(Verdict),
});

export type AnswerPageData = typeof AnswerPageData.Type;

/** The landing a verdict's answer made, when it landed. */
export const landedBy = (
  verdict: Verdict | undefined
): LandedSha | undefined =>
  verdict !== undefined && Outcome.isAnyOf(["Landed"])(verdict.outcome)
    ? verdict.outcome.sha
    : undefined;

/** The landing at `sha`; none for no landing, or one the platform no longer finds. */
const readLanding = (project: ProjectName, sha: LandedSha | undefined) =>
  Effect.gen(function* () {
    if (sha === undefined) {
      return Option.none<LandingView>();
    }

    const client = yield* Client;

    return yield* client.landing({ project, sha }).pipe(
      Effect.map((found) => Option.some(found.landing)),
      // The verdict names a landing the platform no longer finds: show the verdict alone.
      Effect.catchTag("UnknownCommit", () => Effect.succeedNone)
    );
  });

/**
 * The page's reads: the verdict, the ask and the project's events at
 * once, then the landing (if it landed) and the family's parent (if it is
 * in one); or a not-found carrying the refusal (a 404).
 */
export const readAnswer = ({ ask, head, project }: AnswerAddress) =>
  Effect.gen(function* () {
    const path = yield* Schema.decodeEffect(AnswerPath)(
      head === undefined ? { ask, project } : { ask, head, project }
    ).pipe(Effect.mapError(() => notFound()));

    const client = yield* Client;

    const [{ verdict }, shown, events] = yield* Effect.all(
      [
        client.verdict(path),
        client.showAsk({ ask: path.ask, project: path.project }),
        readEvents(path.project),
      ],
      { concurrency: "unbounded" }
    ).pipe(
      Effect.catchTags({
        UnknownAsk: notFoundFor,
        UnknownProject: notFoundFor,
      })
    );

    const [landing, parent] = yield* Effect.all(
      [readLanding(path.project, landedBy(verdict)), readParent(shown.ask)],
      { concurrency: "unbounded" }
    );

    return yield* Schema.encodeEffect(AnswerPageData)({
      ...path,
      askRead: shown.ask,
      brief: shown.brief,
      ...keptEvents(events, shown.ask, Option.getOrUndefined(parent)),
      landing: Option.getOrUndefined(landing),
      now: yield* DateTime.now,
      parent: Option.getOrUndefined(parent),
      verdict,
    });
  });
