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

export interface AskAddress {
  readonly ask: string;
  readonly project: string;
}

const AskPath = Schema.Struct({ ask: AskId, project: ProjectName });

const CheckRead = Schema.Struct({
  path: RepoPath,
  sha: BlobSha,
  text: Schema.String,
});

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

export interface AnswerAddress {
  readonly ask: string;
  readonly head?: string | undefined;
  readonly project: string;
}

const AnswerPath = Schema.Struct({
  ask: AskId,
  head: Schema.optionalKey(CommitSha),
  project: ProjectName,
});

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

export const landedBy = (
  verdict: Verdict | undefined
): LandedSha | undefined =>
  verdict !== undefined && Outcome.isAnyOf(["Landed"])(verdict.outcome)
    ? verdict.outcome.sha
    : undefined;

const readLanding = (project: ProjectName, sha: LandedSha | undefined) =>
  Effect.gen(function* () {
    if (sha === undefined) {
      return Option.none<LandingView>();
    }

    const client = yield* Client;

    return yield* client.landing({ project, sha }).pipe(
      Effect.map((found) => Option.some(found.landing)),
      Effect.catchTag("UnknownCommit", () => Effect.succeedNone)
    );
  });

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
