/**
 * A project's home's reads on the server, and its answer to an agent: what
 * its loader reads (its asks, its own ledger, its events, its policy, its
 * root folder and README, then each family's parent in full), and its GET,
 * which gives a request for Markdown the project's `llms.txt`.
 */
import { Client, PolicyOf } from "@repo/protocol/contracts";
import { Ask, AskListing } from "@repo/protocol/domain/ask";
import { FileView, TreeListing } from "@repo/protocol/domain/code";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Ledger } from "@repo/protocol/domain/visibility";
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { notFound } from "@tanstack/react-router";
import {
  Array as Arr,
  Cause,
  DateTime,
  Effect,
  Option,
  Schema,
  Stream,
} from "effect";

import { wantsMarkdown } from "../features/ask/markdown.ts";
import { familiesIn } from "../features/front/families.ts";
import { variedByAccept } from "../features/front/markdown.ts";
import { readFolderWithReadme } from "./folder.ts";
import { projectLlmsHandler } from "./llms.ts";
import type { ClientFor } from "./llms.ts";

export const decodeName = Schema.decodeUnknownOption(ProjectName);

/** What the loader carries from the server, each read there when the platform gave it. */
export const ProjectPageData = Schema.Struct({
  asks: Schema.optionalKey(Schema.Array(AskListing)),
  code: Schema.optionalKey(
    Schema.Struct({
      readme: Schema.optionalKey(FileView),
      root: TreeListing,
    })
  ),
  events: Schema.optionalKey(Schema.Array(ProjectEvent)),
  ledger: Schema.optionalKey(Ledger),
  now: Schema.DateTimeUtcFromString,
  parents: Schema.Array(Ask),
  /** The project's policy, and where it was imported from, as `projectPolicy` gives them. */
  policy: Schema.optionalKey(PolicyOf.successSchema),
  project: ProjectName,
});

export type ProjectPageData = typeof ProjectPageData.Type;

const isUnknownProject = Schema.is(UnknownProject);

/**
 * A read the page can do without: its value, or none when the platform
 * cannot give it now (whatever went wrong on the way); a project it does
 * not know is a 404.
 */
const optional = <A, E, R>(read: Effect.Effect<A, E, R>) =>
  read.pipe(
    Effect.asSome,
    Effect.catchCause((cause) =>
      Option.exists(Cause.findErrorOption(cause), isUnknownProject)
        ? Effect.fail(notFound())
        : Effect.succeed(Option.none<A>())
    )
  );

/** Four reads at once: a project holds a few families, each read once. */
const AT_ONCE = 4;

/**
 * The project's home, read over `Client`, or a not-found for a name that is
 * none or a project the platform does not know.
 */
export const readProjectPage = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(decodeName(name));
    const client = yield* Client;

    const read = yield* Effect.all(
      {
        asks: optional(client.listAsks({ project })),
        code: optional(
          readFolderWithReadme({ path: Option.none(), project, rev: "main" })
        ),
        events: optional(
          Stream.runCollect(client.watch({ project, since: 0 }))
        ),
        ledger: optional(client.ledger({ project })),
        policy: optional(client.projectPolicy({ project })),
      },
      { concurrency: "unbounded" }
    );

    const asks = Option.map(read.asks, (listed) => listed.asks);

    const parents = yield* Effect.forEach(
      familiesIn(Option.getOrElse(asks, () => [])),
      ({ parent }) =>
        client.showAsk({ ask: parent, project }).pipe(
          Effect.map((shown) => Option.some(shown.ask)),
          Effect.orElseSucceed(() => Option.none<Ask>())
        ),
      { concurrency: AT_ONCE }
    );

    // What the platform sent decoded, so it encodes; a failure is a defect.
    return yield* Schema.encodeEffect(ProjectPageData)({
      ...Option.match(asks, {
        onNone: () => ({}),
        onSome: (listed) => ({ asks: listed }),
      }),
      ...Option.match(read.code, {
        onNone: () => ({}),
        onSome: ({ listing, readme }) => ({
          code: {
            root: listing,
            ...Option.match(readme, {
              onNone: () => ({}),
              onSome: (file) => ({ readme: file }),
            }),
          },
        }),
      }),
      ...Option.match(read.policy, {
        onNone: () => ({}),
        onSome: (policy) => ({ policy }),
      }),
      ...Option.match(read.events, {
        onNone: () => ({}),
        onSome: (events) => ({ events }),
      }),
      ...Option.match(read.ledger, {
        onNone: () => ({}),
        onSome: (ledger) => ({ ledger }),
      }),
      now: yield* DateTime.now,
      parents: Arr.getSomes(parents),
      project,
    }).pipe(Effect.orDie);
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

/**
 * The page's GET, as a function of its client: a request that asks for
 * Markdown gets the project's `llms.txt`, varied by `Accept`; any other
 * falls through to the page.
 */
export const projectPageHandler =
  (clientFor: ClientFor, platformUrl: string) =>
  <Next>({
    next,
    params,
    request,
  }: {
    readonly next: () => Next;
    readonly params: { readonly project: string };
    readonly request: Request;
  }): Promise<Response> | Next =>
    wantsMarkdown(request)
      ? Effect.runPromise(
          Effect.map(
            Effect.promise(() =>
              projectLlmsHandler(clientFor, platformUrl)({ params, request })
            ),
            variedByAccept
          )
        )
      : next();
