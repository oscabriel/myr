/**
 * The front page's reads on the server, and its answer to an agent: what
 * its loader reads (the open asks, each family's parent in full, and the
 * events of each project that holds a family), and its GET, which gives a
 * request for Markdown `llms.txt`. The landing at `/` answers an agent the
 * same way, and sends a reader who carries a session to their home.
 */
import { Client } from "@repo/protocol/contracts";
import { Ask } from "@repo/protocol/domain/ask";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { Array as Arr, DateTime, Effect, Option, Schema, Stream } from "effect";

import { wantsMarkdown } from "../features/ask/markdown.ts";
import { familiesIn } from "../features/front/families.ts";
import { variedByAccept } from "../features/front/markdown.ts";
import { HOME_PATH } from "../features/shared/paths.ts";
import { KEPT_NOWHERE } from "./edge-cache.ts";
import { frontLlmsHandler } from "./llms.ts";
import type { ClientFor } from "./llms.ts";
import { credentialFrom } from "./session.ts";

/** What the loader carries from the server: the asks, the families' parents in full, and their projects' events. */
export const FrontPageData = Schema.Struct({
  entries: Schema.Array(FrontPageEntry),
  events: Schema.Array(
    Schema.Struct({ events: Schema.Array(ProjectEvent), project: ProjectName })
  ),
  now: Schema.DateTimeUtcFromString,
  parents: Schema.Array(Ask),
});

export type FrontPageData = typeof FrontPageData.Type;

/** Four reads at once: a page holds a few families, each read once. */
const AT_ONCE = 4;

/** Each family on the page, by its project: `[project, parent]`. */
const familiesOf = (entries: readonly FrontPageEntry[]) =>
  Arr.dedupe(entries.map(({ project }) => project)).flatMap((project) =>
    familiesIn(
      entries.flatMap((entry) => (entry.project === project ? [entry.ask] : []))
    ).map(({ parent }) => [project, parent] as const)
  );

/**
 * The front page's data, as the anonymous viewer reads it (so the page may
 * be kept by a cache; the browser reads again once someone signs in): the
 * open asks; each family's parent in full, which counts its children; and
 * the events of each project that holds a family, which mark them. A
 * parent or a replay the platform cannot give now leaves its family drawn
 * as plain rows. The list of projects is never read here.
 */
export const readFrontPage = Effect.gen(function* () {
  const client = yield* Client;
  const { entries } = yield* client.frontPage({});
  const families = familiesOf(entries);

  const parents = yield* Effect.forEach(
    families,
    ([project, ask]) =>
      client.showAsk({ ask, project }).pipe(
        Effect.map((read) => Option.some(read.ask)),
        Effect.orElseSucceed(() => Option.none<Ask>())
      ),
    { concurrency: AT_ONCE }
  );

  const events = yield* Effect.forEach(
    Arr.dedupe(families.map(([project]) => project)),
    (project) =>
      Stream.runCollect(client.watch({ project, since: 0 })).pipe(
        Effect.map((read) => Option.some({ events: read, project })),
        Effect.orElseSucceed(() => Option.none())
      ),
    { concurrency: AT_ONCE }
  );

  return yield* Schema.encodeEffect(FrontPageData)({
    entries,
    events: Arr.getSomes(events),
    now: yield* DateTime.now,
    parents: Arr.getSomes(parents),
  });
});

/**
 * The page's GET, as a function of its client: a request that asks for
 * Markdown gets `llms.txt`, varied by `Accept`; any other falls through to
 * the page.
 */
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

/** The answer that sends a signed-in reader from the landing to their home. */
const toHome = () =>
  new Response(null, {
    headers: { "cache-control": KEPT_NOWHERE, location: HOME_PATH },
    status: 302,
  });

/**
 * The landing's GET: a request for Markdown gets `llms.txt`, as the front
 * page's does; a reader who carries a session goes to `/home`, an answer
 * kept nowhere (the edge never stores an answer to a request with a
 * cookie); anyone else gets the landing, the same page for every reader.
 */
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
      ? Promise.resolve(toHome())
      : next();
  };
