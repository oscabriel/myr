import { nameOfKey, ProjectKey } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { fakeArtifactsBinding } from "@repo/testkit/fake-artifacts-binding";
import type { HostLike } from "@repo/testkit/fake-artifacts-binding";
import { untouchable } from "@repo/testkit/untouchable";
import { Exit, Option, Schema } from "effect";

import type { ProjectStub } from "../src/adapters/do-projects.ts";
import { CallRequest, ProjectCalls } from "../src/project-calls.ts";
import type { ExitEncoded, ProjectMethod } from "../src/project-calls.ts";

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

export const operatorToken = "operator-token-0123456789abcdef0123";

export const cookieKey = "cookie-key-0123456789abcdef0123456789";

export const passwordPepper = "pepper-0123456789abcdef0123456789abcdef";

export const masterKey = "0123456789abcdef".repeat(4);

export interface ProjectCallSeen {
  readonly project: string;
  readonly method: ProjectMethod;
  readonly caller: CallRequest["caller"];
}

const seenBy = new WeakMap<Env["PROJECT"], ProjectCallSeen[]>();

export const callsTo = (
  namespace: Env["PROJECT"]
): readonly ProjectCallSeen[] => seenBy.get(namespace) ?? [];

const decodeCall = Schema.decodeUnknownSync(CallRequest);

const replyOf = (method: ProjectMethod, exit: Exit.Exit<unknown, unknown>) =>
  Schema.encodeUnknownSync(ProjectCalls[method].exit)(exit);

const answer = (
  made: ReadonlySet<string>,
  project: string,
  method: ProjectMethod
): ExitEncoded => {
  if (!made.has(project)) {
    return ProjectCalls[method].refusesUnmade
      ? replyOf(
          method,
          Exit.fail(
            new UnknownProject({
              project: Option.getOrThrow(nameOfKey(ProjectKey.make(project))),
            })
          )
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
  EMAIL: untouchable("EMAIL"),
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

export const withPrivateNamespace = (env: Env, host: HostLike): Env => ({
  ...env,
  ARTIFACTS_PRIVATE: fakeArtifactsBinding(host),
});

export const without = (env: Env, key: keyof Env): Env => {
  const rest = { ...env };

  Reflect.deleteProperty(rest, key);

  return rest;
};
