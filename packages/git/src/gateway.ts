import { RepoName } from "@repo/artifacts/repo-host";
import type { CommitSha } from "@repo/protocol/ids";
import { RepoBusy, StaleBase } from "@repo/protocol/refusal";
import { headline } from "@repo/protocol/render";
import { Array, Effect, Equal, Match, Option } from "effect";

import { Custody } from "./custody.ts";
import type { Command } from "./custody.ts";
import {
  drain,
  readAdvertisement,
  readOpening,
  readReport,
  refuseAll,
  resume,
  writeReport,
} from "./receive-pack.ts";
import type { Opening, RefStatus } from "./receive-pack.ts";
import { Exchange, Upstream, UpstreamFailure } from "./upstream.ts";
import type { Service } from "./upstream.ts";

const ROUTE =
  /^\/(?<name>[A-Za-z0-9._-]+?)(?:\.git)?\/(?<endpoint>info\/refs|git-upload-pack|git-receive-pack)$/u;

/** One of the three endpoints of git's smart HTTP. */
export type GitEndpoint = "info/refs" | "git-upload-pack" | "git-receive-pack";

/** The repo a smart HTTP path names, and the endpoint it asks for; `None` for any other path. */
export const gitRoute = (
  pathname: string
): Option.Option<{ readonly endpoint: GitEndpoint; readonly name: string }> =>
  Option.flatMap(Option.fromNullishOr(ROUTE.exec(pathname)?.groups), (route) =>
    route.name === undefined ||
    (route.endpoint !== "info/refs" &&
      route.endpoint !== "git-upload-pack" &&
      route.endpoint !== "git-receive-pack")
      ? Option.none()
      : Option.some({ endpoint: route.endpoint, name: route.name })
  );

const isService = (service: string | null): service is Service =>
  service === "git-upload-pack" || service === "git-receive-pack";

// What the upstream needs of the client's headers. Credentials are never on
// the list: the upstream sees only the platform's.
const FORWARDED = [
  "accept",
  "content-encoding",
  "content-type",
  "git-protocol",
];

const forwarded = (headers: Headers) => {
  const picked = new Headers();

  for (const name of FORWARDED) {
    const value = headers.get(name);

    if (value !== null) {
      picked.set(name, value);
    }
  }

  return picked;
};

/**
 * Passes bytes and fails the stream on anything else: the Workers types leave
 * a request body's chunk type open.
 */
const bytes = () =>
  new TransformStream<unknown, Uint8Array>({
    transform: (chunk, controller) => {
      if (chunk instanceof Uint8Array) {
        controller.enqueue(chunk);
      } else {
        controller.error(
          new TypeError("a request body held something other than bytes")
        );
      }
    },
  });

/** A POST's body, the only kind of request with one here. */
const bodyOf = (request: Request) =>
  request.method === "POST" && request.body !== null
    ? Option.some(request.body.pipeThrough(bytes()))
    : Option.none();

/** A plain-text reply, which git prints as the reason a request failed. */
export const plain = (
  status: number,
  text: string,
  headers: Readonly<Record<string, string>> = {}
) =>
  new Response(`${text}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8", ...headers },
    status,
  });

/** The upstream's reply as the client gets it: status, type and body, uncached. */
const relay = (response: Response) =>
  new Response(response.body, {
    headers: {
      "cache-control": "no-cache",
      "content-type":
        response.headers.get("content-type") ?? "application/octet-stream",
    },
    status: response.status,
  });

const result = (report: Uint8Array) =>
  new Response(report, {
    headers: {
      "cache-control": "no-cache",
      "content-type": "application/x-git-receive-pack-result",
    },
  });

// What an upstream says when a ref moved under a push: Artifacts, then
// git's own receive-pack (2.56).
const MOVED = new Set(["stale ref", "incorrect old value provided"]);

// Artifacts' whole reply to a push it is too busy for: one fatal side-band
// message and no report.
const BUSY = "artifacts_git_receive_pack_busy";

const busy = (messages: readonly Uint8Array[]) =>
  messages.some((message) => new TextDecoder().decode(message).includes(BUSY));

/** Where each ref in the upstream points now. */
const tipsOf = (repo: RepoName) =>
  Effect.gen(function* () {
    const response = yield* (yield* Upstream).exchange(
      repo,
      Exchange.Advertise({
        headers: new Headers(),
        service: "git-receive-pack",
      })
    );

    const advertisement = yield* Effect.tryPromise(() =>
      response.arrayBuffer()
    );

    return yield* Effect.try(() =>
      readAdvertisement(new Uint8Array(advertisement))
    );
  }).pipe(Effect.orElseSucceed(() => new Map<string, CommitSha>()));

/**
 * The upstream's refusals in the closed union: a ref that moved under the
 * push is `StaleBase`, from the base the pusher named to where the ref is now.
 */
const translate = (
  repo: RepoName,
  commands: readonly Command[],
  refs: readonly RefStatus[]
) =>
  Effect.gen(function* () {
    const moved = refs.filter(({ ng }) =>
      Option.exists(ng, (reason) => MOVED.has(reason))
    );

    if (moved.length === 0) {
      return new Map<string, StaleBase>();
    }

    const tips = yield* tipsOf(repo);

    return new Map(
      moved.flatMap(({ ref }) => {
        const base = commands.find((command) => command.ref === ref)?.from;
        const tip = tips.get(ref);

        return base === undefined || Option.isNone(base) || tip === undefined
          ? []
          : [
              [
                ref,
                new StaleBase({ base: base.value, conflicts: [], main: tip }),
              ] as const,
            ];
      })
    );
  });

/**
 * The upstream's reply to a push, as the pusher gets it. When every ref
 * landed, custody reviews the push and may still turn it away. A reply that
 * is not a report passes on as it came.
 */
const answer = (
  repo: RepoName,
  opening: Opening,
  commands: Array.NonEmptyReadonlyArray<Command>,
  response: Response
) =>
  Effect.gen(function* () {
    if (response.status !== 200) {
      return relay(response);
    }

    const reply = new Uint8Array(
      yield* Effect.tryPromise({
        catch: () =>
          new UpstreamFailure({
            reason: "the push's report was cut off",
            repo,
          }),
        try: () => response.arrayBuffer(),
      })
    );

    const report = Effect.try(() => readReport(opening.capabilities, reply));
    const read = yield* Effect.option(report);

    if (Option.isNone(read)) {
      return result(reply);
    }

    const { messages, refs, unpack } = read.value;

    if (busy(messages)) {
      const refusals = [new RepoBusy()] as const;

      return result(
        writeReport(
          opening.capabilities,
          [],
          refusals,
          refuseAll(commands, refusals)
        )
      );
    }

    const translated = yield* translate(repo, commands, refs);

    if (translated.size > 0) {
      return result(
        writeReport(
          opening.capabilities,
          messages,
          [...translated.values()],
          refs.map((status) => {
            const refusal = translated.get(status.ref);

            return refusal === undefined
              ? status
              : { ng: Option.some(headline([refusal])), ref: status.ref };
          })
        )
      );
    }

    const landed =
      Equal.equals(unpack, Option.some("ok")) &&
      refs.length === commands.length &&
      refs.every(({ ng }) => Option.isNone(ng));

    if (!landed) {
      return result(reply);
    }

    const refused = yield* (yield* Custody).review(repo, commands);

    return Array.isReadonlyArrayNonEmpty(refused)
      ? result(
          writeReport(
            opening.capabilities,
            messages,
            refused,
            refuseAll(commands, refused)
          )
        )
      : result(reply);
  });

/**
 * A push: custody admits it or it goes no further. A refused push is read to
 * its end and answered here; the upstream never sees it.
 */
const push = (
  repo: RepoName,
  headers: Headers,
  body: ReadableStream<Uint8Array>
) =>
  Effect.gen(function* () {
    const custody = yield* Custody;
    const upstream = yield* Upstream;
    const opening = yield* readOpening(body);

    const forward = upstream.exchange(
      repo,
      Exchange.Call({
        body: resume(opening.read, body),
        headers,
        service: "git-receive-pack",
      })
    );

    // git's probe before a large push names no refs; nothing to judge.
    if (!Array.isReadonlyArrayNonEmpty(opening.commands)) {
      return relay(yield* forward);
    }

    const { commands } = opening;
    const refused = yield* custody.admit(repo, commands);

    if (Array.isReadonlyArrayNonEmpty(refused)) {
      yield* drain(body);

      return result(
        writeReport(
          opening.capabilities,
          [],
          refused,
          refuseAll(commands, refused)
        )
      );
    }

    return yield* answer(repo, opening, commands, yield* forward);
  }).pipe(
    Effect.catchTag("Malformed", ({ reason }) =>
      Effect.succeed(plain(400, reason))
    )
  );

/**
 * The platform's git endpoint, speaking git's smart HTTP: `info/refs`,
 * `git-upload-pack` (protocol v2 passes straight through) and
 * `git-receive-pack`. Packs stream through and are never held whole.
 */
export const gateway = (
  request: Request
): Effect.Effect<Response, never, Upstream | Custody> =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const found = gitRoute(url.pathname);

    if (Option.isNone(found)) {
      return plain(404, "not a git endpoint");
    }

    const route = found.value;
    const upstream = yield* Upstream;
    const repo = RepoName.make(route.name);
    const headers = forwarded(request.headers);

    return yield* Match.value(route.endpoint).pipe(
      Match.when("info/refs", () => {
        const service = url.searchParams.get("service");

        return request.method === "GET" && isService(service)
          ? upstream
              .exchange(repo, Exchange.Advertise({ headers, service }))
              .pipe(Effect.map(relay))
          : Effect.succeed(plain(403, "this gateway speaks smart HTTP only"));
      }),
      Match.when("git-upload-pack", (service) =>
        Option.match(bodyOf(request), {
          onNone: () => Effect.succeed(plain(405, "POST a git request")),
          onSome: (body) =>
            upstream
              .exchange(repo, Exchange.Call({ body, headers, service }))
              .pipe(Effect.map(relay)),
        })
      ),
      Match.when("git-receive-pack", () =>
        Option.match(bodyOf(request), {
          onNone: () => Effect.succeed(plain(405, "POST a git request")),
          onSome: (body) => push(repo, headers, body),
        })
      ),
      Match.orElse(() => Effect.succeed(plain(404, "not a git endpoint")))
    );
  }).pipe(
    Effect.catchTags({
      RepoNotFound: ({ name }) => Effect.succeed(plain(404, `no repo ${name}`)),
      UpstreamFailure: ({ reason }) => Effect.succeed(plain(502, reason)),
    })
  );
