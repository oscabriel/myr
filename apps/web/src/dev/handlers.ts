/**
 * Every contract, served by the dev world the way the platform serves it
 * (`apps/platform/src/handlers.ts`, which an app may not import): a
 * contract that names a project calls that project's service as the caller
 * `Authenticated` named; the cross-project reads (`listProjects`,
 * `frontPage`, `credits`) come from the front page folded over the world's
 * projects; `status` and `today` without a project ask every project it
 * lists and merge what each says; `evidence` reads the world's lane logs.
 * Unlike the platform, nothing spends a rate limit: the world has one
 * browser at a time. Every `remote` names the origin the caller reached the
 * world by, as the platform's do. The code reads run the same
 * `@repo/project/code` functions the platform's do, over the world's
 * `RepoHost`.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import { EvidenceStore, LogRef } from "@repo/checks/evidence-store";
import {
  codeProjectOf,
  commitOf,
  fileOf,
  logOf,
  pathsOf,
  refsOf,
  treeOf,
  whyOf,
} from "@repo/project/code";
import type { CodeProject } from "@repo/project/code";
import { FrontPage } from "@repo/project/front-page";
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
import { Array, DateTime, Effect, Number, Option, Order, Stream } from "effect";
import type { Layer } from "effect";
import { HttpServerRequest } from "effect/http";
import type { Rpc, RpcGroup } from "effect/rpc";

/** How many commits a page of `log` holds when the caller names no limit. */
const LOG_PAGE = 30;

/** How many events `watch` reads from its project at a time. */
const EVENT_PAGE = 100;

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

/** Where the caller reached the world: the request's origin. */
const gateway = Effect.map(
  Effect.serviceOption(HttpServerRequest.HttpServerRequest),
  (request) =>
    Option.getOrElse(
      Option.flatMap(request, (incoming) =>
        Option.map(HttpServerRequest.toURL(incoming), ({ origin }) => origin)
      ),
      () => "http://localhost"
    )
);

/** A repo's git URL at the origin the caller came through. */
const remoteOf = (repo: RepoName | ProjectName) =>
  Effect.map(gateway, (origin) => `${origin}/${repo}.git`);

/** A claim, with its fork's URL at the caller's origin. */
const atGateway = (claim: ClaimView) =>
  Effect.map(remoteOf(claim.fork), (remote): ClaimView => ({
    ...claim,
    remote,
  }));

/** The caller's claims and answers, each claim at the caller's origin, under their handle. */
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
 * One decider's Today across the projects they decide in, as the platform
 * merges it: budgets added up, decisions in one order of expiry, the rest
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

/** Every contract over the dev world. A missing contract is a type error here. */
export const devHandlers: Layer.Layer<
  Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>,
  never,
  Projects | FrontPage | EvidenceStore | RepoHost
> = Contracts.toLayer(
  Effect.gen(function* () {
    const projects = yield* Projects;
    const frontPage = yield* FrontPage;
    const evidence = yield* EvidenceStore;
    const host = yield* RepoHost;

    /** `call` on the project named `project`; one never made is `UnknownProject`. */
    const on = <A, E>(
      project: ProjectName,
      call: (api: ProjectApi) => Effect.Effect<A, E>
    ) => Effect.flatMap(projects.get(project), call);

    /** A code read of `project`'s canonical repo, over the world's `RepoHost`. */
    const code = <A, E>(
      project: ProjectName,
      read: (of: CodeProject) => Effect.Effect<A, E, RepoHost>
    ) =>
      on(project, (api) =>
        read(codeProjectOf(api, project)).pipe(
          Effect.provideService(RepoHost, host)
        )
      );

    /** `call` on every project the front page lists, in name order, keeping what each finds. */
    const everywhere = <A, E>(
      call: (api: ProjectApi) => Effect.Effect<Option.Option<A>, E>
    ) =>
      Effect.gen(function* () {
        const listed = yield* frontPage.projects();

        const each = yield* Effect.forEach(
          Array.sort(
            Array.dedupe(listed.map(({ project }) => project)),
            Order.String
          ),
          (project) =>
            Effect.flatMap(
              Effect.option(projects.get(project)),
              Option.match({ onNone: () => Effect.succeedNone, onSome: call })
            )
        );

        return Array.getSomes(each);
      });

    return {
      claim: ({ ask, project }) =>
        Effect.gen(function* () {
          const who = yield* person;
          const { claim } = yield* on(project, (api) => api.claim(who, ask));

          return { claim: yield* atGateway(claim) };
        }),
      credits: ({ handle }) =>
        Effect.map(frontPage.credits(handle), (credits) => ({ credits })),
      decide: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.decide(who, input))
        ),
      draftAsk: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.draftAsk(who, input))
        ),
      evidence: ({ project, ref }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) =>
            api
              .evidence(who, LogRef.make(ref))
              .pipe(Effect.provideService(EvidenceStore, evidence))
          )
        ),
      // Keyed by the class: lint keeps "shape" out of code names.
      [EnvSchemaOf._tag]: ({ project }) =>
        Effect.flatMap(caller, (who) =>
          on(project, (api) => api[EnvSchemaOf._tag](who))
        ),
      finish: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.finish(who, input))
        ),
      flagAsk: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.flagAsk(who, input))
        ),
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
      listPaths: ({ at, project }) =>
        code(project, (of) => pathsOf(of, Option.fromUndefinedOr(at))),
      listProjects: () =>
        Effect.map(frontPage.projects(), (listed) => ({ projects: listed })),
      listRefs: ({ project }) => code(project, refsOf),
      log: ({ at, from = 0, limit = LOG_PAGE, path, project }) =>
        code(project, (of) =>
          logOf(of, {
            at: Option.fromUndefinedOr(at),
            from,
            limit,
            path: Option.fromUndefinedOr(path),
          })
        ),
      openAsk: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.openAsk(who, input))
        ),
      projectPolicy: ({ project }) =>
        on(project, (api) =>
          Effect.map(api.policy(), (policy) =>
            Option.match(policy, {
              onNone: () => ({}),
              onSome: (evaluated) => ({ policy: evaluated }),
            })
          )
        ),
      proposeAsk: ({ project, ...input }) =>
        Effect.flatMap(person, (who) =>
          on(project, (api) => api.proposeAsk(who, input))
        ),
      readFile: ({ at, path, project }) =>
        code(project, (of) => fileOf(of, Option.fromUndefinedOr(at), path)),
      readTree: ({ at, path, project }) =>
        code(project, (of) =>
          treeOf(of, Option.fromUndefinedOr(at), Option.fromUndefinedOr(path))
        ),
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
      showCommit: ({ project, sha }) =>
        code(project, (of) => commitOf(of, sha)),
      showProposal: ({ project, proposal }) =>
        Effect.flatMap(caller, (who) =>
          on(project, (api) => api.showProposal(who, proposal))
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
            Effect.asSome(api.status(who))
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
              Effect.asSome,
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
      watch: ({ project, since = 0 }) =>
        Stream.unwrap(
          Effect.map(projects.get(project), (api) =>
            Stream.paginate(since, (after) =>
              Effect.map(api.events(after, EVENT_PAGE), (rows) => [
                rows.map(({ event }) => event),
                rows.length < EVENT_PAGE
                  ? Option.none()
                  : Option.fromUndefinedOr(rows.at(-1)?.seq),
              ])
            )
          )
        ),
      why: ({ at, path, project }) =>
        code(project, (of) => whyOf(of, Option.fromUndefinedOr(at), path)),
    };
  })
);
