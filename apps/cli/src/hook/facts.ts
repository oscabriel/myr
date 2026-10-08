/**
 * The facts a hook session decides by, gathered once per session: the repo
 * the harness runs in, the claim its remote names, the ask behind it (one
 * `showAsk`), and the judge closure at the claim's base. Anything missing
 * leaves the session without a claim, with the reason, and the hook allows.
 */
import { Brand } from "@repo/brand";
import { Client } from "@repo/protocol/contracts";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { Cause, Duration, Effect, Option, Result, Schema } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { repoContext } from "../repo-context.ts";
import type { RepoRef } from "../repo-context.ts";
import type { HookClaim } from "./decide.ts";
import { askJudge, judgeAt } from "./judge.ts";
import type { SessionState } from "./session.ts";

/** No closure: a session without a claim judges nothing. */
const NO_JUDGE: SessionState["judge"] = { paths: [], pointers: [] };

const without = (root: string, why: string): SessionState => ({
  holds: 0,
  judge: NO_JUDGE,
  root,
  why,
});

/**
 * How long the platform has to answer one call. A hook the harness kills
 * for its time also lets the agent go on, but only after the harness's own
 * limit (a minute in Claude Code), on every turn.
 */
const PLATFORM_LIMIT = Duration.seconds(10);

/** The platform did not answer in time; the session goes on without a claim. */
class PlatformSilent extends Schema.TaggedError<PlatformSilent>()(
  "PlatformSilent",
  { limit: Schema.String }
) {
  override get message() {
    return `the platform did not answer within ${this.limit}`;
  }
}

/** A platform call, given at most `PLATFORM_LIMIT` to answer. */
const inTime = <A, E, R>(call: Effect.Effect<A, E, R>) =>
  Effect.timeoutOrElse(call, {
    duration: PLATFORM_LIMIT,
    orElse: () =>
      Effect.fail(
        new PlatformSilent({ limit: Duration.format(PLATFORM_LIMIT) })
      ),
  });

/** A failure's first line, for a reason on stderr. */
const firstLine = (cause: Cause.Cause<unknown>) =>
  String(Cause.squash(cause)).split("\n")[0] ?? "unknown failure";

const isLive = (claim: ClaimView) =>
  claim.state === "live" || claim.state === "warned";

/**
 * The caller's claim this repo works on: the one a claim's fork names, or,
 * in the project's own repo or a working fork, the caller's only live claim
 * in the project (an answer may be made in a clone of main and pushed to the
 * fork). Otherwise why there is none.
 */
const claimFor = (
  ref: RepoRef,
  claims: readonly ClaimView[]
): Result.Result<ClaimView, string> => {
  const live = claims.filter(
    (claim) => isLive(claim) && claim.project === ref.project
  );

  if (ref.kind === "claim") {
    return Result.fromOption(
      Option.fromUndefinedOr(live.find((claim) => claim.ask === ref.ask)),
      () =>
        `you hold no live claim on ${ref.ask}; ${Brand.cli} claim ${ref.ask} takes it`
    );
  }

  const [only, ...others] = live;

  if (ref.kind === "layer" || only === undefined) {
    return Result.fail(
      `you hold no live claim in ${ref.project}; ${Brand.cli} asks lists the open asks`
    );
  }

  return others.length === 0
    ? Result.succeed(only)
    : Result.fail(
        `you hold ${live.length} live claims in ${ref.project}, and this repo's remote names none of them`
      );
};

/**
 * The session's facts for a harness running in `cwd`. The repo's remote
 * names the project, and a claim's fork (`<project>--<ask>--<handle>`, spec
 * §4.5) the ask; `status` gives the caller's live claim and its check
 * command; `showAsk` gives the want and the territory; git gives the files
 * at the claim's base for the judge closure.
 */
export const gatherFacts = (
  cwd: string
): Effect.Effect<
  SessionState,
  never,
  Client | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const context = yield* Effect.option(repoContext(cwd));

    if (Option.isNone(context)) {
      return without(cwd, `${cwd} is not inside a git repo`);
    }

    const { repo, root } = context.value;

    if (Option.isNone(repo)) {
      return without(root, "this repo's remote is none of the platform's");
    }

    const ref = repo.value;
    const client = yield* Client;

    return yield* Effect.gen(function* () {
      const { claims } = yield* inTime(client.status({ project: ref.project }));

      const picked = claimFor(ref, claims);

      if (Result.isFailure(picked)) {
        return without(root, picked.failure);
      }

      const live = picked.success;

      const shown = yield* inTime(
        client.showAsk({ ask: live.ask, project: live.project })
      );

      const judge = askJudge(
        yield* judgeAt({ base: live.base, root, test: live.checkCommand }),
        shown.ask
      );

      const claim: HookClaim = {
        ask: live.ask,
        base: live.base,
        checkCommand: live.checkCommand,
        project: live.project,
        territory: shown.ask.territory,
        want: shown.ask.brief.want,
      };

      return { claim, holds: 0, judge, root } satisfies SessionState;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(
          without(root, `could not read the claim: ${firstLine(cause)}`)
        )
      )
    );
  });
