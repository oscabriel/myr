/**
 * The contracts' handlers: routing, the rate limit and the fan-out, nothing
 * more (spec §4.3 `src/handlers.ts`). A contract that names a project calls
 * that project's `ProjectApi` (its Durable Object, through `Projects`) as
 * the caller `Authenticated` named; the cross-project reads (`listProjects`,
 * `frontPage`, `credits`) come from the front-page projection; `status` and
 * `today` without a project ask every project the projection lists and
 * merge what each says. `claim`, `proposeAsk` and `flagAsk` spend the
 * caller's rate limit first, so a call past it reaches no project.
 * `evidence` asks the project who may read a lane's log, which it reads
 * from the stage's `EvidenceStore`. `watch` is served by `watch.ts`: live
 * for a caller on the framed `/rpc`, replayed and ended over JSON.
 *
 * Every `remote` a caller gets back is the platform's git URL for the repo,
 * at the origin the caller reached the platform by: never a storage URL.
 */
import { EvidenceStore, LogRef } from "@repo/checks/evidence-store";
import { envSchemaMethod } from "@repo/project/deciders";
import { FrontPage } from "@repo/project/front-page";
import { GatewayUrl } from "@repo/project/project";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import { Contracts, EnvSchemaOf } from "@repo/protocol/contracts";
import type { AnswerView } from "@repo/protocol/domain/answer";
import type { ClaimView } from "@repo/protocol/domain/claim";
import type { Decision, Today } from "@repo/protocol/domain/decision";
import { sameHandle } from "@repo/protocol/ids";
import type { ProjectName, RepoName } from "@repo/protocol/ids";
import { CurrentPrincipal, Principal } from "@repo/protocol/principal";
import type { Person } from "@repo/protocol/principal";
import { NotDecider } from "@repo/protocol/refusal";
import type { Layer } from "effect";
import { Array, DateTime, Effect, Number, Option, Order, Stream } from "effect";
import { HttpServerRequest } from "effect/http";
import type { Rpc, RpcGroup } from "effect/rpc";

import { RateLimits } from "./rate-limits.ts";
import { servedFramed, watchHandler } from "./watch.ts";

/** How many projects a call without one asks at once. */
const FAN_OUT = 8;

/** The caller, as the `Authenticated` server side named them. */
const caller = Effect.service(CurrentPrincipal);

/**
 * The caller of a contract only a person may call. `Authenticated` lets an
 * anonymous call reach only a `public` contract, so anyone else here is a
 * defect in the server side, never a caller to serve.
 */
const person = Effect.flatMap(caller, (principal) =>
  Principal.match(principal, {
    Anonymous: () =>
      Effect.die("a contract for signed-in people was called anonymously"),
    Person: (named) => Effect.succeed<Person>(named),
  })
);

/** The incoming request's origin: its URL's when whole, else from its host. */
const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  URL.canParse(request.originalUrl)
    ? Option.some(new URL(request.originalUrl).origin)
    : Option.map(HttpServerRequest.toURL(request), ({ origin }) => origin);

/**
 * Where the caller reached the platform, which is where its git lives: the
 * incoming request's origin, or the platform's own URL for a call that came
 * from no request.
 */
const gateway = Effect.gen(function* () {
  const request = yield* Effect.serviceOption(
    HttpServerRequest.HttpServerRequest
  );

  return yield* Option.match(Option.flatMap(request, originOf), {
    onNone: () => Effect.service(GatewayUrl),
    onSome: Effect.succeed,
  });
});

/** A repo's git URL at the gateway the caller came through. */
const remoteOf = (repo: RepoName | ProjectName) =>
  Effect.map(gateway, (origin) => `${origin}/${repo}.git`);

/** A claim, with its fork's URL at the caller's gateway. */
const atGateway = (claim: ClaimView) =>
  Effect.map(remoteOf(claim.fork), (remote): ClaimView => ({
    ...claim,
    remote,
  }));

/**
 * The caller's claims and answers, each claim at the caller's gateway, under
 * the caller's own handle (a first login has no claim to read it from).
 */
const statusAtGateway = (
  who: Person,
  status: {
    readonly answers: readonly AnswerView[];
    readonly claims: readonly ClaimView[];
  }
) =>
  Effect.map(Effect.forEach(status.claims, atGateway), (claims) => ({
    answers: status.answers,
    claims,
    handle: who.handle,
  }));

/** Decisions across projects: soonest to expire first, then oldest, then by project and id. */
const byExpiry: Order.Order<Decision> = Order.combineAll([
  Order.mapInput(DateTime.Order, ({ expiresAt }: Decision) => expiresAt),
  Order.mapInput(DateTime.Order, ({ openedAt }: Decision) => openedAt),
  Order.mapInput(Order.String, ({ project }: Decision) => project),
  Order.mapInput(Order.String, ({ id }: Decision) => id),
]);

/**
 * One decider's Today across the projects they decide in: each project's
 * budget added up, its decisions in one order of expiry, and the rest
 * side by side. A person who decides in none has no Today.
 */
const acrossProjects = (
  decider: Person,
  pages: readonly Today[]
): Effect.Effect<Today, NotDecider> => {
  const sumOf = (pick: (page: Today) => number) =>
    Number.sumAll(pages.map(pick));

  return Array.isReadonlyArrayNonEmpty(pages)
    ? Effect.succeed({
        budget: {
          finishes: sumOf(({ budget }) => budget.finishes),
          total: sumOf(({ budget }) => budget.total),
          used: sumOf(({ budget }) => budget.used),
        },
        decider: decider.handle,
        decisions: Array.sort(
          pages.flatMap(({ decisions }) => decisions),
          byExpiry
        ),
        expiringSoon: pages.flatMap(({ expiringSoon }) => expiringSoon),
        newcomers: Array.dedupeWith(
          pages.flatMap(({ newcomers }) => newcomers),
          sameHandle
        ),
        overflow: sumOf(({ overflow }) => overflow),
        unattended: pages.flatMap(({ unattended }) => unattended),
      })
    : Effect.fail(new NotDecider({}));
};

/**
 * Every contract, served by the project it names or by the projection. A
 * missing contract is a type error here (`Contracts.toLayer`).
 */
export const Handlers: Layer.Layer<
  Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>,
  never,
  Projects | FrontPage | RateLimits | EvidenceStore
> = Contracts.toLayer(
  Effect.gen(function* () {
    const projects = yield* Projects;
    const frontPage = yield* FrontPage;
    const rateLimits = yield* RateLimits;
    const evidence = yield* EvidenceStore;

    /** `call` on the project named `project`; one never made is `UnknownProject`. */
    const on = <A, E>(
      project: ProjectName,
      call: (api: ProjectApi) => Effect.Effect<A, E>
    ) => Effect.flatMap(projects.get(project), call);

    /**
     * `call` on every project the projection lists, in name order. A
     * project the platform never made adds nothing, and so does one where
     * `call` finds nothing for the caller; any other failure is the call's.
     */
    const everywhere = <A, E>(
      call: (api: ProjectApi) => Effect.Effect<Option.Option<A>, E>
    ) =>
      Effect.gen(function* () {
        const listed = yield* frontPage.projects();

        const names = Array.sort(
          Array.dedupe(listed.map(({ project }) => project)),
          Order.String
        );

        const each = yield* Effect.forEach(
          names,
          (project) =>
            Effect.flatMap(
              Effect.option(projects.get(project)),
              Option.match({ onNone: () => Effect.succeedNone, onSome: call })
            ),
          { concurrency: FAN_OUT }
        );

        return Array.getSomes(each);
      });

    return {
      claim: ({ ask, project }) =>
        Effect.gen(function* () {
          const who = yield* person;

          yield* rateLimits.check("claim", who.handle);

          const { claim } = yield* on(project, (api) => api.claim(who, ask));

          return { claim: yield* atGateway(claim) };
        }),
      credits: ({ handle }) =>
        Effect.map(frontPage.credits(handle), (credits) => ({ credits })),
      decide: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.decide(who, input))
        ),
      evidence: ({ project, ref }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) =>
            api
              .evidence(who, LogRef.make(ref))
              .pipe(Effect.provideService(EvidenceStore, evidence))
          )
        ),
      [EnvSchemaOf._tag]: ({ project }) =>
        Effect.flatMap(caller, (who) =>
          on(project, (api) => api[envSchemaMethod](who))
        ),
      finish: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.finish(who, input))
        ),
      flagAsk: ({ project, ...input }) =>
        Effect.gen(function* () {
          const who = yield* person;

          yield* rateLimits.check("proposal", who.handle);

          return yield* on(project, (api) => api.flagAsk(who, input));
        }),
      fork: ({ project }) =>
        Effect.gen(function* () {
          const who = yield* person;
          const { fork } = yield* on(project, (api) => api.fork(who));

          return { fork, remote: yield* remoteOf(fork) };
        }),
      frontPage: (filter) =>
        Effect.map(frontPage.entries(filter), (entries) => ({ entries })),
      initProject: ({ project, ...input }) =>
        Effect.gen(function* () {
          const who = yield* person;

          // A project an earlier call made but could not start is this
          // call's to start; one already started refuses it itself.
          const api = yield* projects
            .create(project)
            .pipe(
              Effect.catchTag("ProjectExists", () =>
                Effect.orDie(projects.get(project))
              )
            );

          const made = yield* api.initProject(who, input);

          return { ...made, remote: yield* remoteOf(made.project) };
        }),
      land: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.land(who, input))
        ),
      landing: ({ project, sha }) =>
        Effect.flatMap(caller, (who) =>
          on(project, (api) => api.landing(who, sha))
        ),
      ledger: ({ project }) =>
        Effect.flatMap(caller, (who) => on(project, (api) => api.ledger(who))),
      listAsks: ({ project }) =>
        Effect.flatMap(caller, (who) =>
          on(project, (api) => api.listAsks(who))
        ),
      listProjects: () =>
        Effect.map(frontPage.projects(), (listed) => ({ projects: listed })),
      openAsk: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.openAsk(who, input))
        ),
      proposeAsk: ({ project, ...input }) =>
        Effect.gen(function* () {
          const who = yield* person;

          yield* rateLimits.check("proposal", who.handle);

          return yield* on(project, (api) => api.proposeAsk(who, input));
        }),
      release: ({ ask, project }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.release(who, ask))
        ),
      setEnv: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.setEnv(who, input))
        ),
      showAsk: ({ ask, project }) =>
        Effect.flatMap(caller, (who) =>
          on(project, (api) => api.showAsk(who, ask))
        ),
      status: ({ project }) =>
        Effect.gen(function* () {
          const who = yield* person;

          if (project !== undefined) {
            return yield* statusAtGateway(
              who,
              yield* on(project, (api) => api.status(who))
            );
          }

          const each = yield* everywhere((api) =>
            Effect.map(api.status(who), Option.some)
          );

          return yield* statusAtGateway(who, {
            answers: each.flatMap(({ answers }) => answers),
            claims: each.flatMap(({ claims }) => claims),
          });
        }),
      submitAnswer: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.submitAnswer(who, input))
        ),
      today: ({ project }) =>
        Effect.gen(function* () {
          const who = yield* person;

          if (project !== undefined) {
            return yield* on(project, (api) => api.today(who));
          }

          // A project the caller decides nothing in has no page for them.
          const pages = yield* everywhere((api) =>
            api.today(who).pipe(
              Effect.map(Option.some),
              Effect.catchTag("NotDecider", () => Effect.succeedNone)
            )
          );

          return yield* acrossProjects(who, pages);
        }),
      verdict: ({ project, ...input }) =>
        Effect.flatMap(caller, (who) =>
          on(project, (api) => api.verdict(who, input))
        ),
      vouch: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.vouch(who, input))
        ),
      // Live over a framed `/rpc`; replayed and ended over a buffered one.
      watch: (payload) =>
        Stream.unwrap(
          Effect.map(servedFramed, (live) => watchHandler(payload, { live }))
        ).pipe(Stream.provideService(Projects, projects)),
    };
  })
);
