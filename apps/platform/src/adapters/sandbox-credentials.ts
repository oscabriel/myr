/**
 * The only credentials a sandbox job carries, and the one way a job crosses
 * the `SANDBOX` service binding (spec §4.3): the sandbox Worker has no
 * Artifacts binding, so each job takes a token the platform minted for it
 * alone, on one repo (tokens are per repo, S1 #10), with the narrowest scope
 * the job needs and a lifetime of minutes, revoked as soon as the job ends
 * (S1 change 2). A token never appears in a result, a refusal or a log: the
 * wire redacts it, refusals carry no free text (principle 3), and what a
 * failure log says is scrubbed of every token the job carried.
 *
 * A job is encoded with the wire schemas both sides share, and its outcome
 * comes back as a JSON `Exit` decoded here (principle 2): a typed refusal
 * stays typed; anything else (a rejected call, an outcome that won't decode,
 * a defect on the far side) is `VerifierBlocked`, the gate's trouble and
 * never the answer's, with one error-level log line naming the method.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import type {
  RepoName,
  RepoNotFound,
  TokenScope,
} from "@repo/artifacts/repo-host";
import type { Remote } from "@repo/checks/check-runner/wire";
import { VerifierBlocked } from "@repo/protocol/refusal";
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

/**
 * How long a job's token lives: enough for a cold container to start and
 * fetch, short enough that a token outliving its job is dead within
 * minutes (S1 #2: an expired token gets 403). Each is revoked when its job
 * ends, so this bounds only a revoke that failed.
 */
export const jobTokenTtl = Duration.minutes(5);

/** The sandbox entrypoint's methods: the one name every failure log carries. */
export type SandboxMethod =
  | "bundleRules"
  | "check"
  | "compose"
  | "land"
  | "merge";

/** One repo a job reaches, and what it may do there. */
export interface RemoteNeed {
  readonly repo: RepoName;
  readonly scope: TokenScope;
}

/** The longest failure detail a log line keeps. */
const DETAIL_LIMIT = 2000;

/**
 * `text` without any token the job carried, cut to `DETAIL_LIMIT`: the far
 * side holds the tokens and may echo one in an error.
 */
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

/**
 * The job could not run: one error-level log line, then `VerifierBlocked`,
 * which carries no free text; what went wrong goes in the annotations.
 */
const blocked = (
  method: SandboxMethod,
  annotations: Readonly<Record<string, string>>
) =>
  Effect.logError("sandbox job blocked").pipe(
    Effect.annotateLogs({ ...annotations, method }),
    Effect.andThen(Effect.fail(new VerifierBlocked({})))
  );

/** A repo the store does not know: the job cannot run. */
const unknownRepo =
  (method: SandboxMethod) =>
  ({ name }: RepoNotFound) =>
    blocked(method, { failure: "repo not found", repo: name });

/**
 * Mints a `need.scope` token on `need.repo` for one job, hands `use` its
 * remote, and revokes the token once `use` ends, however it ends. A revoke
 * that fails is logged, never raised: the token dies with its lifetime. A
 * repo the store does not know is `VerifierBlocked` for `method`.
 */
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
      host
        .mintToken(need.repo, need.scope, jobTokenTtl)
        .pipe(Effect.catchTag("RepoNotFound", unknownRepo(method))),
      ({ secret }) => use({ token: secret, url }),
      ({ id }) =>
        host.revokeToken(need.repo, id).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("sandbox job token not revoked").pipe(
              Effect.annotateLogs({
                cause: Cause.pretty(cause),
                method,
                repo: need.repo,
                tokenId: id,
              })
            )
          )
        )
    );
  });

/** Why a job's outcome never arrived as a typed `Exit`. */
class Unreached extends Data.TaggedError("Unreached")<{
  readonly failure: "rejected" | "undecodable" | "unencodable";
  readonly detail: string;
}> {}

/** One job for the sandbox: what to send, and how its wire and outcome are coded. */
export interface SandboxJob<W, WI, A, E, X> {
  readonly method: SandboxMethod;
  readonly wire: Schema.Codec<W, WI>;
  readonly exit: Schema.Codec<Exit.Exit<A, E>, X>;
  readonly job: W;
  /** Every remote `job` carries: their tokens are scrubbed from failure logs. */
  readonly remotes: readonly Remote[];
  /** The binding's method, called with the encoded job. */
  readonly send: (encoded: WI) => Promise<X>;
}

/**
 * An outcome as the port gives it: the success, a typed refusal as itself,
 * and a defect or an interruption on the far side as `VerifierBlocked`.
 */
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
            detail: scrub(Cause.pretty(exit.cause), remotes),
            failure: "defect",
          }),
        onSome: (refusal): Effect.Effect<never, E> => Effect.fail(refusal),
      });

/**
 * Sends one job and settles its outcome into the Effect's channels; a job
 * whose outcome never arrived as an `Exit` is `VerifierBlocked`. Each
 * failure is logged once, at error level.
 */
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
