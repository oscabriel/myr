/**
 * git's smart HTTP on the platform: clones and pushes of every project's
 * repos, reached at `/<repo>(.git)/(info/refs|git-upload-pack|git-receive-pack)`.
 * `surfaces.ts` hands every such path here, outside the 401 gate, before the
 * RPC and MCP routes.
 *
 * Who may do what (spec D10, ADR 0004): anyone clones a project's canonical
 * repo; a fork is read by a signed-in person; a push needs one, and custody
 * (`adapters/custody.ts`) decides what it may move. A credential the
 * platform does not know is a 401 everywhere. A name the platform never
 * makes (spec §4.5) is a 404. The client's credential never travels past
 * this file: the gateway forwards only the headers git's protocol needs, and
 * the upstream adds the platform's own.
 */
import { Brand } from "@repo/brand";
import { Custody } from "@repo/git/custody";
import { gateway, gitRoute, plain } from "@repo/git/gateway";
import { concat, packetAt, pkt, utf8 } from "@repo/git/pkt-line";
import type { Upstream } from "@repo/git/upstream";
import type { Projects } from "@repo/project/projects";
import { RepoName } from "@repo/protocol/ids";
import { Anonymous, Principal } from "@repo/protocol/principal";
import { Effect, Option, Ref } from "effect";

import { custodyFor, refuseAll } from "./adapters/custody.ts";
import { credentialOf } from "./credential.ts";
import { repoKind, RepoKind } from "./repo-names.ts";
import { Sessions } from "./sessions.ts";

/** What serving git needs: who is calling, their projects, and the git server behind. */
export type GitServices = Sessions | Projects | Upstream;

/** A push reads `info/refs` for receive-pack, then posts to it; everything else reads. */
const writes = (endpoint: string, url: URL) =>
  endpoint === "git-receive-pack" ||
  (endpoint === "info/refs" &&
    url.searchParams.get("service") === "git-receive-pack");

const RESULT = "application/x-git-receive-pack-result";

/**
 * git asks its credential helper for a password only after a 401 that names
 * Basic; the helper answers with the person's platform token.
 */
const signIn = (reason: string) =>
  plain(401, `${reason}; sign in with ${Brand.cli} login`, {
    "www-authenticate": `Basic realm="${Brand.name}"`,
  });

const notFound = (name: string) => plain(404, `no repo ${name}`);

/** Who the request's credential names; `None` when it names no one the platform knows. */
const principalOf = (headers: Headers) =>
  Option.match(credentialOf(headers), {
    onNone: () => Effect.succeedSome<Principal>(Anonymous.make({})),
    onSome: (token) =>
      Sessions.use(({ verify }) => verify(token)).pipe(
        Effect.map(Option.map((person): Principal => person))
      ),
  });

/** Whether `principal` may read the repo `kind` names: a canonical repo, anyone; a fork, a signed-in person. */
const mayRead = (principal: Principal, kind: RepoKind) =>
  RepoKind.$is("Canonical")(kind) || Principal.guards.Person(principal);

/**
 * The reply to a push with `notices` first, as `remote:` lines: only when
 * the reply speaks side-band, whose first packet names its band.
 */
const withNotices = (response: Response, notices: readonly string[]) =>
  Effect.gen(function* () {
    if (
      notices.length === 0 ||
      response.status !== 200 ||
      response.headers.get("content-type") !== RESULT
    ) {
      return response;
    }

    const read = yield* Effect.option(
      Effect.tryPromise(() => response.arrayBuffer())
    );

    // The gateway's own words when a push's report does not arrive whole.
    if (Option.isNone(read)) {
      return plain(502, "the push's report was cut off");
    }

    const reply = new Uint8Array(read.value);

    const first = Option.flatten(Option.liftThrowable(packetAt)(reply, 0));

    const banded = Option.exists(
      first,
      ({ packet }) =>
        packet !== "Flush" && packet[0] !== undefined && packet[0] <= 3
    );

    const body = banded
      ? concat([
          ...notices.map((line) =>
            pkt(concat([Uint8Array.of(2), utf8(`${line}\n`)]))
          ),
          reply,
        ])
      : reply;

    return new Response(body, {
      headers: response.headers,
      status: response.status,
    });
  });

/** A git request to `name`, as `principal` may make it. */
const serve = (
  request: Request,
  route: { readonly endpoint: string; readonly name: string },
  principal: Principal
) =>
  Effect.gen(function* () {
    const kind = repoKind(RepoName.make(route.name));

    if (RepoKind.$is("Unknown")(kind)) {
      return notFound(route.name);
    }

    const pushing = writes(route.endpoint, new URL(request.url));

    if (pushing && !Principal.guards.Person(principal)) {
      return signIn("a push needs a signed-in person");
    }

    if (!mayRead(principal, kind)) {
      return signIn("a fork is read by signed-in people");
    }

    const notices = yield* Ref.make<readonly string[]>([]);

    // Only a push's own request is judged; reads never reach custody.
    const custody =
      route.endpoint === "git-receive-pack"
        ? yield* custodyFor(principal, kind, (line) =>
            Ref.update(notices, (said) => [...said, line])
          )
        : refuseAll;

    const response = yield* gateway(request).pipe(
      Effect.provideService(Custody, custody)
    );

    return yield* withNotices(response, yield* Ref.get(notices));
  });

/** The response to a git request, if `request` is one the gateway serves. */
export const serveGit = (
  request: Request
): Option.Option<Effect.Effect<Response, never, GitServices>> =>
  Option.map(gitRoute(new URL(request.url).pathname), ({ endpoint, name }) =>
    Effect.flatMap(principalOf(request.headers), (principal) =>
      Option.match(principal, {
        onNone: () => Effect.succeed(signIn("that token is not one we know")),
        onSome: (known) => serve(request, { endpoint, name }, known),
      })
    )
  );
