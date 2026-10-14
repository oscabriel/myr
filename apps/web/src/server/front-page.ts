import { Client } from "@repo/protocol/contracts";
import { Ask } from "@repo/protocol/domain/ask";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { Array as Arr, DateTime, Effect, Option, Schema, Stream } from "effect";

import { wantsMarkdown } from "../features/ask/markdown.ts";
import { familiesIn } from "../features/front/families.ts";
import { variedByAccept } from "../features/front/markdown.ts";
import { INBOX_PATH } from "../features/shared/paths.ts";
import { KEPT_NOWHERE } from "./edge-cache.ts";
import { frontLlmsHandler } from "./llms.ts";
import type { ClientFor } from "./llms.ts";
import { credentialFrom } from "./session.ts";

export const FrontPageData = Schema.Struct({
  entries: Schema.Array(FrontPageEntry),
  events: Schema.Array(
    Schema.Struct({ events: Schema.Array(ProjectEvent), project: ProjectName })
  ),
  now: Schema.DateTimeUtcFromString,
  parents: Schema.Array(Ask),
});

export type FrontPageData = typeof FrontPageData.Type;

const AT_ONCE = 4;

const familiesOf = (entries: readonly FrontPageEntry[]) =>
  Arr.dedupe(entries.map(({ project }) => project)).flatMap((project) =>
    familiesIn(
      entries.flatMap((entry) => (entry.project === project ? [entry.ask] : []))
    ).map(({ parent }) => [project, parent] as const)
  );

// As the anonymous viewer reads it, so the page may be kept by a cache; the browser reads again once someone signs in.
export const readFrontPage = Effect.gen(function* () {
  const client = yield* Client;
  const { entries } = yield* client.frontPage({});
  const families = familiesOf(entries);

  // The parents and the replays need only the entries, so the two waves go at once.
  const { events, parents } = yield* Effect.all(
    {
      events: Effect.forEach(
        Arr.dedupe(families.map(([project]) => project)),
        (project) =>
          Stream.runCollect(client.watch({ project, since: 0 })).pipe(
            Effect.map((read) => Option.some({ events: read, project })),
            Effect.orElseSucceed(() => Option.none())
          ),
        { concurrency: AT_ONCE }
      ),
      parents: Effect.forEach(
        families,
        ([project, ask]) =>
          client.showAsk({ ask, project }).pipe(
            Effect.map((read) => Option.some(read.ask)),
            Effect.orElseSucceed(() => Option.none<Ask>())
          ),
        { concurrency: AT_ONCE }
      ),
    },
    { concurrency: "unbounded" }
  );

  return yield* Schema.encodeEffect(FrontPageData)({
    entries,
    events: Arr.getSomes(events),
    now: yield* DateTime.now,
    parents: Arr.getSomes(parents),
  });
});

export const frontPageHandler =
  (clientFor: ClientFor, platformUrl: string) =>
  <Next>({
    next,
    request,
  }: {
    readonly next: () => Next;
    readonly request: Request;
  }): Promise<Response> | Next =>
    wantsMarkdown(request)
      ? Effect.runPromise(
          Effect.map(
            Effect.promise(() =>
              frontLlmsHandler(clientFor, platformUrl)({ request })
            ),
            variedByAccept
          )
        )
      : next();

const toInbox = () =>
  new Response(null, {
    headers: { "cache-control": KEPT_NOWHERE, location: INBOX_PATH },
    status: 302,
  });

export const landingHandler =
  (clientFor: ClientFor, platformUrl: string) =>
  <Next>({
    next,
    request,
  }: {
    readonly next: () => Next;
    readonly request: Request;
  }): Promise<Response> | Next => {
    if (wantsMarkdown(request)) {
      return frontPageHandler(clientFor, platformUrl)({ next, request });
    }

    return Option.isSome(credentialFrom(request))
      ? Promise.resolve(toInbox())
      : next();
  };
