import { RepoHost } from "@repo/artifacts/repo-host";
import type {
  RepoName,
  RepoNotFound,
  TokenScope,
} from "@repo/artifacts/repo-host";
import type { Remote } from "@repo/checks/check-runner/wire";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { unquoted } from "@repo/telemetry/defects";
import {
  Cause,
  Data,
  Duration,
  Effect,
  Exit,
  Option,
  Redacted,
  Schema,
} from "effect";

// Each token is revoked when its job ends, so this bounds only a revoke that failed.
export const jobTokenTtl = Duration.minutes(5);

export type SandboxMethod =
  | "bundleRules"
  | "check"
  | "compose"
  | "land"
  | "merge";

export interface RemoteNeed {
  readonly repo: RepoName;
  readonly scope: TokenScope;
}

const DETAIL_LIMIT = 2000;

// The far side holds the tokens and may echo one in an error.
const scrub = (text: string, remotes: readonly Remote[]) => {
  let scrubbed = text;

  for (const { token } of remotes) {
    const secret = Redacted.value(token);

    if (secret.length > 0) {
      scrubbed = scrubbed.replaceAll(secret, "<token>");
    }
  }

  return scrubbed.slice(0, DETAIL_LIMIT);
};

const blocked = (
  method: SandboxMethod,
  annotations: Readonly<Record<string, string>>
) =>
  Effect.logError("sandbox job blocked").pipe(
    Effect.annotateLogs({ ...annotations, method }),
    Effect.andThen(Effect.fail(new VerifierBlocked({})))
  );

const unknownRepo =
  (method: SandboxMethod) =>
  ({ name }: RepoNotFound) =>
    blocked(method, { failure: "repo not found", repo: name });

// A failed revoke is logged with the token scrubbed, never raised: the token dies with its lifetime.
export const withRemote = <A, E, R>(
  method: SandboxMethod,
  need: RemoteNeed,
  use: (remote: Remote) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | VerifierBlocked, R | RepoHost> =>
  Effect.gen(function* () {
    const host = yield* RepoHost;

    const url = yield* host
      .remote(need.repo)
      .pipe(Effect.catchTag("RepoNotFound", unknownRepo(method)));

    return yield* Effect.acquireUseRelease(
      host.mintToken(need.repo, need.scope, jobTokenTtl).pipe(
        Effect.map(({ id, secret }) => ({
          id,
          remote: { token: secret, url } satisfies Remote,
        })),
        Effect.catchTag("RepoNotFound", unknownRepo(method))
      ),
      ({ remote }) => use(remote),
      ({ id, remote }) =>
        host.revokeToken(need.repo, id).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("sandbox job token not revoked").pipe(
              Effect.annotateLogs({
                cause: scrub(Cause.pretty(cause), [remote]),
                method,
                repo: need.repo,
                tokenId: id,
              })
            )
          )
        )
    );
  });

class Unreached extends Data.TaggedError("Unreached")<{
  readonly failure: "rejected" | "undecodable" | "unencodable";
  readonly detail: string;
}> {}

export interface SandboxJob<W, WI, A, E, X> {
  readonly method: SandboxMethod;
  readonly wire: Schema.Codec<W, WI>;
  readonly exit: Schema.Codec<Exit.Exit<A, E>, X>;
  readonly job: W;
  readonly remotes: readonly Remote[];
  readonly send: (encoded: WI) => Promise<X>;
}

// A job's defect is logged by its name and frames alone: a Checker's may
// quote a sealed file's path.
const settle = <A, E>(
  method: SandboxMethod,
  remotes: readonly Remote[],
  exit: Exit.Exit<A, E>
): Effect.Effect<A, E | VerifierBlocked> =>
  Exit.isSuccess(exit)
    ? Effect.succeed(exit.value)
    : Option.match(Cause.findErrorOption(exit.cause), {
        onNone: () =>
          blocked(method, {
            detail: scrub(Cause.pretty(unquoted(exit.cause)), remotes),
            failure: "defect",
          }),
        onSome: (refusal): Effect.Effect<never, E> => Effect.fail(refusal),
      });

export const sandboxJob = <W, WI, A, E, X>(
  call: SandboxJob<W, WI, A, E, X>
): Effect.Effect<A, E | VerifierBlocked> =>
  Schema.encodeEffect(call.wire)(call.job).pipe(
    Effect.mapError(
      ({ message }) =>
        new Unreached({ detail: message, failure: "unencodable" })
    ),
    Effect.flatMap((encoded) =>
      Effect.tryPromise({
        catch: (cause) =>
          new Unreached({ detail: String(cause), failure: "rejected" }),
        try: () => call.send(encoded),
      })
    ),
    Effect.flatMap((outcome) =>
      Schema.decodeEffect(call.exit)(outcome).pipe(
        Effect.mapError(
          ({ message }) =>
            new Unreached({ detail: message, failure: "undecodable" })
        )
      )
    ),
    Effect.matchEffect({
      onFailure: ({ detail, failure }) =>
        blocked(call.method, { detail: scrub(detail, call.remotes), failure }),
      onSuccess: (exit) => settle(call.method, call.remotes, exit),
    })
  );
