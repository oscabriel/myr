import { Client, PolicyOf } from "@repo/protocol/contracts";
import { Ask, AskListing } from "@repo/protocol/domain/ask";
import { FileView, TagName, TreeListing } from "@repo/protocol/domain/code";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Ledger } from "@repo/protocol/domain/visibility";
import { Handle, ProjectName } from "@repo/protocol/ids";
import { Posture } from "@repo/protocol/posture";
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
import { familiesIn, stillWaiting } from "../features/front/families.ts";
import { ledeOf } from "../features/front/head.ts";
import { variedByAccept } from "../features/front/markdown.ts";
import { openAsks, openToTake } from "../features/project/asks.tsx";
import { readFolderWithReadme } from "./folder.ts";
import { projectLlmsHandler } from "./llms.ts";
import type { ClientFor } from "./llms.ts";

export const decodeName = Schema.decodeUnknownOption(ProjectName);

/**
 * What a project's header says on every one of its pages: only the facts it
 * shows, so the header's read stays small in each page's HTML.
 */
export const ProjectHeaderData = Schema.Struct({
  deciders: Schema.optionalKey(Schema.Array(Handle)),
  landedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  latestTag: Schema.optionalKey(TagName),
  lede: Schema.optionalKey(Schema.String),
  now: Schema.DateTimeUtcFromString,
  open: Schema.optionalKey(
    Schema.Struct({ asks: Schema.Int, takeable: Schema.Int })
  ),
  posture: Schema.optionalKey(
    Schema.Struct({ label: Schema.String, posture: Posture })
  ),
  project: ProjectName,
});

export type ProjectHeaderData = typeof ProjectHeaderData.Type;

/** Overview carries its project's header, built from the reads the page makes anyway. */
export const ProjectPageData = Schema.Struct({
  asks: Schema.optionalKey(Schema.Array(AskListing)),
  code: Schema.optionalKey(
    Schema.Struct({
      readme: Schema.optionalKey(FileView),
      root: TreeListing,
    })
  ),
  events: Schema.optionalKey(Schema.Array(ProjectEvent)),
  header: ProjectHeaderData,
  ledger: Schema.optionalKey(Ledger),
  now: Schema.DateTimeUtcFromString,
  parents: Schema.Array(Ask),
  policy: Schema.optionalKey(PolicyOf.successSchema),
  project: ProjectName,
});

export type ProjectPageData = typeof ProjectPageData.Type;

const isUnknownProject = Schema.is(UnknownProject);

const optional = <A, E, R>(read: Effect.Effect<A, E, R>) =>
  read.pipe(
    Effect.asSome,
    Effect.catchCause((cause) =>
      Option.exists(Cause.findErrorOption(cause), isUnknownProject)
        ? Effect.fail(notFound())
        : Effect.succeed(Option.none<A>())
    )
  );

/**
 * The reads a project's header is built from, each made at once. Overview
 * makes them as its own reads too, so on Overview each is made once.
 */
const headerReads = (client: Client["Service"], project: ProjectName) => ({
  asks: optional(client.listAsks({ project })),
  code: optional(
    readFolderWithReadme({ path: Option.none(), project, rev: "main" })
  ),
  ledger: optional(client.ledger({ project })),
  log: optional(client.log({ limit: 1, project })),
  policy: optional(client.projectPolicy({ project })),
  refs: optional(client.listRefs({ project })),
});

type HeaderReads = ReturnType<typeof headerReads>;

type HeaderRead = {
  readonly [K in keyof HeaderReads]: Effect.Success<HeaderReads[K]>;
};

const byNewest = (a: TagName, b: TagName) =>
  b.localeCompare(a, "en", { numeric: true });

/** A field only when its read gave it; the header never says what it was not told. */
const onlySome = <A, B extends object>(
  read: Option.Option<A>,
  field: (value: A) => B
) => Option.match(read, { onNone: () => ({}), onSome: field });

/**
 * The asks it counts, the ledger's posture, who decides, the newest tag,
 * main's last landing and the README's first sentence.
 */
const headerOf = (
  project: ProjectName,
  now: DateTime.Utc,
  read: HeaderRead
): ProjectHeaderData => {
  const open = Option.map(read.asks, ({ asks }) => {
    const waiting = openAsks(stillWaiting(asks));

    return {
      asks: waiting.length,
      takeable: waiting.filter(openToTake).length,
    };
  });

  const deciders = Option.flatMapNullishOr(read.policy, ({ policy }) =>
    policy === undefined
      ? undefined
      : [...new Set(policy.deciders.flatMap(({ handles }) => handles))]
  );

  const lede = read.code.pipe(
    Option.flatMap(({ readme }) => readme),
    Option.flatMapNullishOr(({ text }) => text),
    Option.flatMapNullishOr(ledeOf)
  );

  return {
    ...onlySome(open, (counted) => ({ open: counted })),
    ...onlySome(deciders, (handles) => ({ deciders: handles })),
    ...onlySome(
      Option.flatMapNullishOr(
        read.log,
        ({ commits }) => commits[0]?.landing?.landedAt
      ),
      (landedAt) => ({ landedAt })
    ),
    ...onlySome(
      Option.flatMapNullishOr(
        read.refs,
        ({ tags }) => tags.map((tag) => tag.name).toSorted(byNewest)[0]
      ),
      (latestTag) => ({ latestTag })
    ),
    ...onlySome(lede, (sentence) => ({ lede: sentence })),
    ...onlySome(read.ledger, ({ posture, postureLabel }) => ({
      posture: { label: postureLabel, posture },
    })),
    now,
    project,
  };
};

const AT_ONCE = 4;

export const readProjectPage = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(decodeName(name));
    const client = yield* Client;

    const read = yield* Effect.all(
      {
        ...headerReads(client, project),
        events: optional(
          Stream.runCollect(client.watch({ project, since: 0 }))
        ),
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

    const now = yield* DateTime.now;

    // What the platform sent decoded, so it encodes; a failure is a defect.
    return yield* Schema.encodeEffect(ProjectPageData)({
      ...onlySome(asks, (listed) => ({ asks: listed })),
      ...onlySome(read.code, ({ listing, readme }) => ({
        code: {
          root: listing,
          ...onlySome(readme, (file) => ({ readme: file })),
        },
      })),
      ...onlySome(read.policy, (policy) => ({ policy })),
      ...onlySome(read.events, (events) => ({ events })),
      ...onlySome(read.ledger, (ledger) => ({ ledger })),
      header: headerOf(project, now, read),
      now,
      parents: Arr.getSomes(parents),
      project,
    }).pipe(Effect.orDie);
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

/**
 * The header alone, for a page whose own loader does not read it: every
 * read at once and none waiting on another, beside the page's own reads.
 */
export const readProjectHeader = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(decodeName(name));
    const client = yield* Client;

    const read = yield* Effect.all(headerReads(client, project), {
      concurrency: "unbounded",
    });

    // What the platform sent decoded, so it encodes; a failure is a defect.
    return yield* Schema.encodeEffect(ProjectHeaderData)(
      headerOf(project, yield* DateTime.now, read)
    ).pipe(Effect.orDie);
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

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
