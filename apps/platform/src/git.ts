import { Brand } from "@repo/brand";
import { Custody } from "@repo/git/custody";
import { gateway, gitRoute, plain } from "@repo/git/gateway";
import type { GitRoute } from "@repo/git/gateway";
import { concat, packetAt, pkt, utf8 } from "@repo/git/pkt-line";
import { readUpload } from "@repo/git/upload-pack";
import type { UploadRequest } from "@repo/git/upload-pack";
import { Upstream } from "@repo/git/upstream";
import type { Projects } from "@repo/project/projects";
import type { LayerAccess } from "@repo/project/visibility-port";
import { Anonymous, Principal } from "@repo/protocol/principal";
import { Effect, Option, Ref } from "effect";

import {
  custodyFor,
  layerCustodyFor,
  layerRead,
  refuseAll,
} from "./adapters/custody.ts";
import { auditOf, credentialOf } from "./credential.ts";
import { LayerGate } from "./layer-gate.ts";
import type { LayerReach } from "./layer-gate.ts";
import { repoKind, RepoKind } from "./repo-names.ts";
import { Sessions } from "./sessions.ts";

export type GitServices = Sessions | Projects | Upstream;

const writes = (endpoint: string, url: URL) =>
  endpoint === "git-receive-pack" ||
  (endpoint === "info/refs" &&
    url.searchParams.get("service") === "git-receive-pack");

const RESULT = "application/x-git-receive-pack-result";

// git asks its credential helper for a password only after a 401 that names Basic.
const signIn = (reason: string) =>
  plain(401, `${reason}; sign in with ${Brand.cli} login`, {
    "www-authenticate": `Basic realm="${Brand.name}"`,
  });

const notFound = (name: string) => plain(404, `no repo ${name}`);

const principalOf = (headers: Headers) =>
  Option.match(credentialOf(headers), {
    onNone: () => Effect.succeedSome<Principal>(Anonymous.make({})),
    onSome: (token) =>
      Sessions.use(({ verify }) => verify(token)).pipe(
        Effect.map(Option.map((person): Principal => person))
      ),
  });

const mayRead = (principal: Principal, kind: RepoKind) =>
  RepoKind.$is("Canonical")(kind) || Principal.guards.Person(principal);

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

const REACH = {
  none: 0,
  read: 1,
  write: 2,
} as const satisfies Record<LayerAccess, number>;

const inflated = (bytes: Uint8Array, encoding: string | null) => {
  if (encoding === null) {
    return Effect.succeedSome(bytes);
  }

  return encoding === "gzip"
    ? Effect.tryPromise(() =>
        new Response(
          new Response(bytes).body?.pipeThrough(new DecompressionStream("gzip"))
        ).arrayBuffer()
      ).pipe(
        Effect.map((read) => new Uint8Array(read)),
        Effect.option
      )
    : Effect.succeedNone;
};

// Read whole for the read log and sent on unchanged. A body in an encoding git never
// sends still counts as a read, so the log errs toward a read.
const uploadOf = (request: Request) =>
  Effect.gen(function* () {
    const read = yield* Effect.option(
      Effect.tryPromise(() => request.arrayBuffer())
    );

    if (Option.isNone(read)) {
      return Option.none();
    }

    const bytes = new Uint8Array(read.value);

    const upload = Option.match(
      yield* inflated(bytes, request.headers.get("content-encoding")),
      {
        onNone: (): UploadRequest => ({ reads: true, want: Option.none() }),
        onSome: readUpload,
      }
    );

    return Option.some({
      request: new Request(request.url, {
        body: bytes,
        headers: request.headers,
        method: request.method,
      }),
      upload,
    });
  });

// Every upload-pack request answered 200 is logged as a read, except a v2 `ls-refs`,
// which reads nothing, so a clone is one read.
const serveLayer = (
  request: Request,
  route: { readonly endpoint: string; readonly name: string },
  principal: Principal,
  { access, target }: LayerReach
) =>
  Effect.gen(function* () {
    const gate = yield* LayerGate;
    const pushing = writes(route.endpoint, new URL(request.url));

    if (!Principal.guards.Person(principal)) {
      return signIn("a layer is read by its readers");
    }

    if (REACH[access] < REACH[pushing ? "write" : "read"]) {
      return plain(
        403,
        `${principal.handle} may not ${pushing ? "push to" : "read"} ${route.name}`
      );
    }

    const custody =
      route.endpoint === "git-receive-pack"
        ? yield* layerCustodyFor(principal, target)
        : refuseAll;

    const served = (sent: Request) =>
      gateway(sent).pipe(
        Effect.provideService(Custody, custody),
        Effect.provideService(Upstream, gate.upstream)
      );

    if (route.endpoint !== "git-upload-pack" || request.method !== "POST") {
      return yield* served(request);
    }

    const fetched = yield* uploadOf(request);

    if (Option.isNone(fetched)) {
      return plain(400, "the request could not be read");
    }

    const { upload } = fetched.value;
    const response = yield* served(fetched.value.request);

    if (upload.reads && response.status === 200) {
      yield* layerRead(principal, target, upload.want);
    }

    return response;
  });

const serve = (request: Request, route: GitRoute, principal: Principal) =>
  Effect.gen(function* () {
    if (Option.isNone(route.repo)) {
      return notFound(route.name);
    }

    const repo = route.repo.value;
    const kind = repoKind(repo);

    if (RepoKind.$is("Unknown")(kind)) {
      const layer = yield* LayerGate.use((gate) =>
        gate.classify(repo, principal)
      );

      return yield* Option.match(layer, {
        onNone: () => Effect.succeed(notFound(route.name)),
        onSome: (reach) => serveLayer(request, route, principal, reach),
      });
    }

    const pushing = writes(route.endpoint, new URL(request.url));

    if (pushing && !Principal.guards.Person(principal)) {
      return signIn("a push needs a signed-in person");
    }

    if (!mayRead(principal, kind)) {
      return signIn("a fork is read by signed-in people");
    }

    const notices = yield* Ref.make<readonly string[]>([]);

    const custody =
      route.endpoint === "git-receive-pack"
        ? yield* custodyFor(
            principal,
            kind,
            (line) => Ref.update(notices, (said) => [...said, line]),
            auditOf(request.headers)
          )
        : refuseAll;

    const served = gateway(request).pipe(
      Effect.provideService(Custody, custody)
    );

    const response = yield* route.endpoint === "git-receive-pack"
      ? served.pipe(
          Effect.withSpan("Gateway.push", { attributes: { target: kind._tag } })
        )
      : served;

    return yield* withNotices(response, yield* Ref.get(notices));
  });

export const serveGit = (
  request: Request
): Option.Option<Effect.Effect<Response, never, GitServices>> =>
  Option.map(gitRoute(new URL(request.url).pathname), (route) =>
    Effect.flatMap(principalOf(request.headers), (principal) =>
      Option.match(principal, {
        onNone: () => Effect.succeed(signIn("that token is not one we know")),
        onSome: (known) => serve(request, route, known),
      })
    )
  );
