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
import { envSchemaMethod } from "@repo/project/deciders";
import { landedProjectOf } from "@repo/project/description";
import { FrontPage } from "@repo/project/front-page";
import { withProjectFacts } from "@repo/project/listing";
import { GatewayUrl } from "@repo/project/project";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import { Contracts, EnvSchemaOf } from "@repo/protocol/contracts";
import type { AnswerView } from "@repo/protocol/domain/answer";
import type { ClaimView } from "@repo/protocol/domain/claim";
import type { Decision, Today } from "@repo/protocol/domain/decision";
import { addressOfRepo, sameHandle, RepoName } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { CurrentPrincipal, Principal } from "@repo/protocol/principal";
import type { Person } from "@repo/protocol/principal";
import { NotDecider } from "@repo/protocol/refusal";
import type { Layer } from "effect";
import { Array, DateTime, Effect, Option, Order, Stream } from "effect";
import { HttpServerRequest } from "effect/http";
import type { Rpc, RpcGroup } from "effect/rpc";

import { RateLimits } from "./rate-limits.ts";
import { servedFramed, watchHandler } from "./watch.ts";

const LOG_PAGE = 30;

const FAN_OUT = 8;

const caller = Effect.service(CurrentPrincipal);

// `Authenticated` lets an anonymous call reach only a `public` contract, so anyone
// else here is a defect in the server side.
const person = Effect.flatMap(caller, (principal) =>
  Principal.match(principal, {
    Anonymous: () =>
      Effect.die("a contract for signed-in people was called anonymously"),
    Person: (named) => Effect.succeed<Person>(named),
  })
);

const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  URL.canParse(request.originalUrl)
    ? Option.some(new URL(request.originalUrl).origin)
    : Option.map(HttpServerRequest.toURL(request), ({ origin }) => origin);

const gateway = Effect.gen(function* () {
  const request = yield* Effect.serviceOption(
    HttpServerRequest.HttpServerRequest
  );

  return yield* Option.match(Option.flatMap(request, originOf), {
    onNone: () => Effect.service(GatewayUrl),
    onSome: Effect.succeed,
  });
});

const remoteOf = (repo: RepoName | ProjectName) =>
  Effect.map(
    gateway,
    (origin) =>
      `${origin}/${repo.includes("/") ? repo : Option.getOrElse(addressOfRepo(RepoName.make(repo)), () => repo)}.git`
  );

const atGateway = (claim: ClaimView) =>
  Effect.map(remoteOf(claim.fork), (remote): ClaimView => ({
    ...claim,
    remote,
  }));

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

const byExpiry: Order.Order<Decision> = Order.combineAll([
  Order.mapInput(DateTime.Order, ({ expiresAt }: Decision) => expiresAt),
  Order.mapInput(DateTime.Order, ({ openedAt }: Decision) => openedAt),
  Order.mapInput(Order.String, ({ project }: Decision) => project),
  Order.mapInput(Order.String, ({ id }: Decision) => id),
]);

const acrossProjects = (
  decider: Person,
  pages: readonly Today[]
): Effect.Effect<Today, NotDecider> =>
  Array.isReadonlyArrayNonEmpty(pages)
    ? Effect.succeed({
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
        unattended: pages.flatMap(({ unattended }) => unattended),
      })
    : Effect.fail(new NotDecider({}));

export const Handlers: Layer.Layer<
  Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>,
  never,
  Projects | FrontPage | RateLimits | EvidenceStore | RepoHost
> = Contracts.toLayer(
  Effect.gen(function* () {
    const projects = yield* Projects;
    const frontPage = yield* FrontPage;
    const rateLimits = yield* RateLimits;
    const evidence = yield* EvidenceStore;
    const host = yield* RepoHost;

    const on = <A, E>(
      project: ProjectName,
      call: (api: ProjectApi) => Effect.Effect<A, E>
    ) => Effect.flatMap(projects.get(project), call);

    const code = <A, E>(
      project: ProjectName,
      read: (of: CodeProject) => Effect.Effect<A, E, RepoHost>
    ) =>
      on(project, (api) =>
        read(codeProjectOf(api, project)).pipe(
          Effect.provideService(RepoHost, host)
        )
      );

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
      draftAsk: ({ project, ...input }) =>
        Effect.gen(function* () {
          const who = yield* person;

          yield* rateLimits.check("draft", who.handle);

          return yield* on(project, (api) => api.draftAsk(who, input));
        }),
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

          // A project an earlier call made but could not start is this call's to start;
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
        frontPage.projects().pipe(
          Effect.flatMap((listed) =>
            withProjectFacts(listed, (project) =>
              Effect.map(projects.get(project), (api) =>
                landedProjectOf(api, project)
              )
            )
          ),
          Effect.provideService(Projects, projects),
          Effect.provideService(RepoHost, host),
          Effect.map((listed) => ({ projects: listed }))
        ),
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
      projectPolicy: ({ project }) => on(project, (api) => api.policy()),
      proposeAsk: ({ project, ...input }) =>
        Effect.gen(function* () {
          const who = yield* person;

          // A draft spends the draft limit first, then the proposal limit.
          if (input.draft === true) {
            yield* rateLimits.check("draft", who.handle);
          }

          yield* rateLimits.check("proposal", who.handle);

          return yield* on(project, (api) => api.proposeAsk(who, input));
        }),
      readFile: ({ at, path, project }) =>
        code(project, (of) => fileOf(of, Option.fromUndefinedOr(at), path)),
      readTree: ({ at, path, project }) =>
        code(project, (of) =>
          treeOf(of, Option.fromUndefinedOr(at), Option.fromUndefinedOr(path))
        ),
      // Read as nobody: the list ignores the caller, so every caller's read is the same.
      recentLandings: () =>
        Effect.map(frontPage.recentLandings(), (landings) => ({ landings })),
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
      showCommit: ({ at, project, sha }) =>
        code(project, (of) => commitOf(of, sha, Option.fromUndefinedOr(at))),
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
      watch: (payload) =>
        Stream.unwrap(
          Effect.map(servedFramed, (live) => watchHandler(payload, { live }))
        ).pipe(Stream.provideService(Projects, projects)),
      // The session names the caller; no project is woken for it.
      whoami: () => Effect.map(person, ({ handle }) => ({ handle })),
      why: ({ at, path, project }) =>
        code(project, (of) => whyOf(of, Option.fromUndefinedOr(at), path)),
    };
  })
);
