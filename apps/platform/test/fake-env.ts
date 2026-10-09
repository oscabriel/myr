import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { fakeArtifactsBinding } from "@repo/testkit/fake-artifacts-binding";
import type { HostLike } from "@repo/testkit/fake-artifacts-binding";
import { untouchable } from "@repo/testkit/untouchable";
import { Exit, Schema } from "effect";

import type { ProjectStub } from "../src/adapters/do-projects.ts";
import { CallRequest, ProjectCalls } from "../src/project-calls.ts";
import type { ExitEncoded, ProjectMethod } from "../src/project-calls.ts";

/**
 * A `FRONT_PAGE` database where every query reads no rows, each recorded in
 * `prepared`: what a call that lists projects (`listProjects`, or `status`
 * without a project) reads from D1.
 */
export const emptyFrontPage = (prepared: string[] = []) =>
  untouchable<D1Database>("FRONT_PAGE", {
    prepare: (query) => {
      prepared.push(query);

      return untouchable<D1PreparedStatement>("D1PreparedStatement", {
        bind: () =>
          untouchable<D1PreparedStatement>("D1PreparedStatement", {
            all: <T>() =>
              Promise.resolve<D1Result<T>>({
                meta: {
                  changed_db: false,
                  changes: 0,
                  duration: 0,
                  last_row_id: 0,
                  rows_read: 0,
                  rows_written: 0,
                  size_after: 0,
                },
                results: [],
                success: true,
              }),
          }),
      });
    },
  });

/** The operator's token in every fake env: long enough to decode. */
export const operatorToken = "operator-token-0123456789abcdef0123";

/** Sign-in's cookie key and pepper in every fake env. */
export const cookieKey = "cookie-key-0123456789abcdef0123456789";

export const passwordPepper = "pepper-0123456789abcdef0123456789abcdef";

/**
 * The master key in every fake env: 64 hex characters, the 256-bit key
 * that wraps write-only values. A test value, never a stage's.
 */
export const masterKey = "0123456789abcdef".repeat(4);

/** One call a fake Project DO was sent: the DO's name, the method, and who called. */
export interface ProjectCallSeen {
  readonly project: string;
  readonly method: ProjectMethod;
  readonly caller: CallRequest["caller"];
}

/** What each fake `PROJECT` namespace was sent, in order, by the namespace. */
const seenBy = new WeakMap<Env["PROJECT"], ProjectCallSeen[]>();

/** Every call a `fakeProjects` namespace's DOs were sent, in order. */
export const callsTo = (
  namespace: Env["PROJECT"]
): readonly ProjectCallSeen[] => seenBy.get(namespace) ?? [];

const decodeCall = Schema.decodeUnknownSync(CallRequest);

/** `exit`, encoded as `method`'s DO answers it. */
const replyOf = (method: ProjectMethod, exit: Exit.Exit<unknown, unknown>) =>
  Schema.encodeUnknownSync(ProjectCalls[method].exit)(exit);

/**
 * What a fake Project DO answers. A project in `made` reads as one with no
 * asks and nobody's claims or answers; any other method there is a defect.
 * Any other name holds no project: a contract call answers `UnknownProject`
 * (as the Project DO's shell does before `initProject`); the rest are defects.
 */
const answer = (
  made: ReadonlySet<string>,
  project: string,
  method: ProjectMethod
): ExitEncoded => {
  if (!made.has(project)) {
    return ProjectCalls[method].refusesUnmade
      ? replyOf(
          method,
          Exit.fail(new UnknownProject({ project: ProjectName.make(project) }))
        )
      : replyOf(method, Exit.die(`no project ${project} to call ${method} on`));
  }

  if (method === "listAsks") {
    return replyOf(method, Exit.succeed({ asks: [] }));
  }

  if (method === "status") {
    return replyOf(method, Exit.succeed({ answers: [], claims: [] }));
  }

  return replyOf(method, Exit.die(`the fake DO does not serve ${method}`));
};

/**
 * The `PROJECT` namespace as the Worker reaches it, in memory: each name is
 * a DO (`idFromName`), and each call is decoded as the real DO decodes it,
 * noted for `callsTo`, and answered by `answer`. Anything else read from it
 * throws, as an untouched binding does.
 */
export const fakeProjects = (made: readonly string[] = []): Env["PROJECT"] => {
  const known = new Set(made);
  const seen: ProjectCallSeen[] = [];

  const namespace = untouchable<Env["PROJECT"]>("PROJECT", {
    get: (id) =>
      untouchable<ProjectStub>("ProjectStub", {
        call: (request) => {
          const { caller, method } = decodeCall(request);
          const project = id.toString();

          seen.push({ caller, method, project });

          return Promise.resolve(answer(known, project, method));
        },
      }),
    idFromName: (name) =>
      untouchable<DurableObjectId>("DurableObjectId", {
        name,
        toString: () => name,
      }),
  });

  seenBy.set(namespace, seen);

  return namespace;
};

/**
 * The platform Worker's env at stage `local`, as `wrangler.jsonc` declares
 * it: every var and every required secret set, every binding a fake that
 * throws if touched, so a test proves what building the platform touches.
 * `PROJECT` is the exception: its DOs hold no project and answer calls on
 * one with `UnknownProject`, each noted (`callsTo`). The optional secrets
 * are absent.
 */
export const fakeEnv = (): Env => ({
  AI: untouchable("AI"),
  ANSWER: untouchable("ANSWER"),
  ARTIFACTS: untouchable("ARTIFACTS"),
  ARTIFACTS_PRIVATE: untouchable("ARTIFACTS_PRIVATE"),
  CLAIM_LIMIT: untouchable("CLAIM_LIMIT"),
  CODE_CACHE: untouchable("CODE_CACHE"),
  COOKIE_KEY: cookieKey,
  DRAFT_LIMIT: untouchable("DRAFT_LIMIT"),
  DRAFT_MODEL: "@cf/moonshotai/kimi-k2.7-code",
  EVIDENCE: untouchable("EVIDENCE"),
  FRONT_PAGE: untouchable("FRONT_PAGE"),
  LANDER_ADAPTER: "container",
  LOADER: untouchable("LOADER"),
  MASTER_KEY: masterKey,
  OAUTH_KV: untouchable("OAUTH_KV"),
  ON_PUSH: untouchable("ON_PUSH"),
  OPERATOR_HANDLE: "oscabriel",
  OPERATOR_TOKEN: operatorToken,
  PASSWORD_PEPPER: passwordPepper,
  PROJECT: fakeProjects(),
  PROPOSAL_LIMIT: untouchable("PROPOSAL_LIMIT"),
  PUBLIC_WEB_URL: "http://localhost:5173",
  RELEASES: untouchable("RELEASES"),
  SANDBOX: untouchable("SANDBOX"),
  SIGN_IN_LIMIT: untouchable("SIGN_IN_LIMIT"),
  STAGE: "local",
});

/**
 * `env` whose private namespace is `host`, a store of bare repos a test
 * keeps (the Node world's second store): the visibility cartridge's layer
 * repos, through the binding the cartridge reads. Remotes are the store's
 * own, so git reaches the store's server.
 */
export const withPrivateNamespace = (env: Env, host: HostLike): Env => ({
  ...env,
  ARTIFACTS_PRIVATE: fakeArtifactsBinding(host),
});

/** `env` without `key`, as a Worker missing that binding, var or secret sees it. */
export const without = (env: Env, key: keyof Env): Env => {
  const rest = { ...env };

  Reflect.deleteProperty(rest, key);

  return rest;
};
