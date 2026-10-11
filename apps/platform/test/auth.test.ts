import { describe, expect, it } from "@effect/vitest";
import { Contracts } from "@repo/protocol/contracts";
import { AskId, Handle, ProjectName } from "@repo/protocol/ids";
import {
  Anonymous,
  CurrentPrincipal,
  Person,
  Unauthenticated,
} from "@repo/protocol/principal";
import type { Principal } from "@repo/protocol/principal";
import { UnknownProject } from "@repo/protocol/refusal";
import { Effect, Exit, Layer, Option, Redacted, Ref, Schema } from "effect";

import { Sessions } from "../src/sessions.ts";
import { firstOf } from "../src/sessions/first-of.ts";
import { MemorySessions } from "../src/sessions/memory.ts";
import { sessionTable, TableSessions } from "../src/sessions/table.ts";
import {
  noProjects,
  origin,
  rpcClient,
  served,
  toolCall,
  toolResult,
} from "./harness.ts";

const project = ProjectName.make("oscabriel/datekit");

const alice = Handle.make("alice");

const operator = Handle.make("oscabriel");

const aliceToken = "alice-token-0123456789abcdef01234567";

const operatorToken = "operator-token-0123456789abcdef0123";

const sessions = MemorySessions.layer({ [aliceToken]: alice });

const metadataUrl = `${origin}/.well-known/oauth-protected-resource`;

const isPerson = Schema.is(Person);

/**
 * The platform before any project exists, except that `listAsks` and
 * `status` answer, each noting who called it in `seen`.
 */
const noting = (seen: Ref.Ref<readonly Principal[]>) => {
  const note = Effect.flatMap(Effect.service(CurrentPrincipal), (principal) =>
    Ref.update(seen, (principals) => [...principals, principal])
  );

  return Layer.mergeAll(
    noProjects,
    Contracts.toLayerHandler("listAsks", () => Effect.as(note, { asks: [] })),
    Contracts.toLayerHandler("status", () =>
      Effect.andThen(note, Effect.service(CurrentPrincipal)).pipe(
        Effect.flatMap((principal) =>
          isPerson(principal)
            ? Effect.succeed({
                answers: [],
                claims: [],
                handle: principal.handle,
              })
            : Effect.die("status is for people signed in")
        )
      )
    )
  );
};

/** Sessions that count every token they are asked to verify. */
const counting = Effect.gen(function* () {
  const verified = yield* Ref.make(0);

  const inner = MemorySessions.service({ [aliceToken]: alice });

  const layer = Layer.succeed(
    Sessions,
    Sessions.of({
      verify: (token) =>
        Effect.andThen(
          Ref.update(verified, (count) => count + 1),
          inner.verify(token)
        ),
    })
  );

  return { layer, verified };
});

/** The challenge a 401 carries, and its status. */
const challengeOf = (response: Response) => ({
  challenge: response.headers.get("www-authenticate"),
  status: response.status,
});

describe("discovering how to sign in", () => {
  it.effect(
    "names the platform as its own protected resource and authorization server, without a credential",
    () =>
      Effect.gen(function* () {
        const { fetch } = yield* served(Layer.mergeAll(noProjects, sessions));

        const response = yield* fetch(new Request(metadataUrl));

        expect(response.status).toBe(200);
        expect(yield* Effect.promise(() => response.json())).toStrictEqual({
          authorization_servers: [origin],
          bearer_methods_supported: ["header"],
          resource: origin,
        });
      })
  );

  it.effect(
    "never turns away /health or the sign-in paths, whatever credential they carry",
    () =>
      Effect.gen(function* () {
        const { fetch } = yield* served(Layer.mergeAll(noProjects, sessions));

        const stale = { authorization: "Bearer a-token-nobody-knows" };

        const client = { authorization: `Basic ${btoa("cli:secret")}` };

        const responses = [
          yield* fetch(new Request(`${origin}/health`, { headers: stale })),
          yield* fetch(new Request(metadataUrl, { headers: stale })),
          yield* fetch(
            new Request(`${origin}/.well-known/oauth-authorization-server`, {
              headers: stale,
            })
          ),
          yield* fetch(
            new Request(`${origin}/token`, { headers: client, method: "POST" })
          ),
          yield* fetch(new Request(`${origin}/authorize`, { headers: stale })),
          yield* fetch(new Request(`${origin}/signup`, { headers: stale })),
          yield* fetch(
            new Request(`${origin}/oauth/callback`, { headers: stale })
          ),
        ];

        expect(responses.map(({ status }) => status)).not.toContain(401);
      })
  );

  // The gateway answers git's paths itself: an unknown credential there is
  // its 401, with git's Basic challenge, never this one.
  it.effect(
    "leaves git's paths to the gateway, whatever credential they carry",
    () =>
      Effect.gen(function* () {
        const { fetch } = yield* served(Layer.mergeAll(noProjects, sessions));

        const response = yield* fetch(
          new Request(
            `${origin}/datekit.git/info/refs?service=git-upload-pack`,
            { headers: { authorization: "Bearer a-token-nobody-knows" } }
          )
        );

        expect(response.headers.get("www-authenticate") ?? "").not.toContain(
          "Bearer"
        );
      })
  );
});

describe("reading without signing in", () => {
  it.effect("lists a project's asks as anyone", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<readonly Principal[]>([]);

      const { handler } = yield* served(Layer.mergeAll(noting(seen), sessions));

      const anyone = yield* rpcClient(handler);

      expect(yield* Effect.exit(anyone.listAsks({ project }))).toStrictEqual(
        Exit.succeed({ asks: [] })
      );
      expect(yield* Ref.get(seen)).toStrictEqual([Anonymous.make({})]);
    })
  );

  it.effect(
    "reads the front page, an ask and a verdict as anyone: each reaches its contract",
    () =>
      Effect.gen(function* () {
        const { handler } = yield* served(Layer.mergeAll(noProjects, sessions));

        const anyone = yield* rpcClient(handler);

        const ask = AskId.make("fix-parser");

        expect(yield* Effect.exit(anyone.frontPage({}))).toStrictEqual(
          Exit.succeed({ entries: [] })
        );
        expect(yield* Effect.exit(anyone.listProjects({}))).toStrictEqual(
          Exit.succeed({ projects: [] })
        );
        expect(
          yield* Effect.flip(anyone.showAsk({ ask, project }))
        ).toStrictEqual(new UnknownProject({ project }));
        expect(
          yield* Effect.flip(anyone.verdict({ ask, project }))
        ).toStrictEqual(new UnknownProject({ project }));
      })
  );

  it.effect(
    "refuses a signed-in or decider contract to anyone as Unauthenticated",
    () =>
      Effect.gen(function* () {
        const seen = yield* Ref.make<readonly Principal[]>([]);

        const { handler } = yield* served(
          Layer.mergeAll(noting(seen), sessions)
        );

        const anyone = yield* rpcClient(handler);

        expect(yield* Effect.exit(anyone.status({}))).toStrictEqual(
          Exit.fail(new Unauthenticated())
        );
        expect(yield* Effect.exit(anyone.today({}))).toStrictEqual(
          Exit.fail(new Unauthenticated())
        );
        expect(yield* Ref.get(seen)).toStrictEqual([]);
      })
  );
});

describe("the 401", () => {
  it.effect(
    "turns away an RPC call whose bearer the platform does not know",
    () =>
      Effect.gen(function* () {
        const { fetch } = yield* served(Layer.mergeAll(noProjects, sessions));

        const response = yield* fetch(
          new Request(`${origin}/rpc`, {
            body: "[]",
            headers: {
              authorization: "Bearer a-token-nobody-knows",
              "content-type": "application/json",
            },
            method: "POST",
          })
        );

        expect(challengeOf(response)).toStrictEqual({
          challenge: `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`,
          status: 401,
        });
      })
  );

  it.effect(
    "asks MCP for a credential, naming where to learn how to get one",
    () =>
      Effect.gen(function* () {
        const { fetch } = yield* served(Layer.mergeAll(noProjects, sessions));

        const response = yield* fetch(toolCall("listAsks", { project }));

        expect(challengeOf(response)).toStrictEqual({
          challenge: `Bearer resource_metadata="${metadataUrl}"`,
          status: 401,
        });
      })
  );

  // RFC 6750 §3.1: a credential of another scheme is not an invalid bearer
  // token, so the challenge carries no error code.
  it.effect(
    "turns away an RPC call whose credential is not a bearer token, with no error code",
    () =>
      Effect.gen(function* () {
        const { fetch } = yield* served(Layer.mergeAll(noProjects, sessions));

        const response = yield* fetch(
          new Request(`${origin}/rpc`, {
            body: "[]",
            headers: {
              authorization: `Basic ${btoa(`alice:${aliceToken}`)}`,
              "content-type": "application/json",
            },
            method: "POST",
          })
        );

        expect(challengeOf(response)).toStrictEqual({
          challenge: `Bearer resource_metadata="${metadataUrl}"`,
          status: 401,
        });
      })
  );

  // The router matches `/mcp` however its path is spelled, so the 401 must
  // hold wherever the router sends a request to MCP.
  it.effect("asks for a credential however MCP's path is spelled", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(Layer.mergeAll(noProjects, sessions));

      const call = toolCall("listProjects", {});

      const body = yield* Effect.promise(() => call.text());

      const statuses = yield* Effect.forEach(
        ["/mcp/", "//mcp", "/MCP", "/mc%70", "/mcp;x"],
        (path) =>
          Effect.map(
            fetch(
              new Request(`${origin}${path}`, {
                body,
                headers: call.headers,
                method: "POST",
              })
            ),
            ({ status }) => status
          )
      );

      expect(statuses).toStrictEqual([401, 401, 401, 401, 401]);
    })
  );

  it.effect(
    "runs a call as the credential its request was let in with, never one the call adds",
    () =>
      Effect.gen(function* () {
        const seen = yield* Ref.make<readonly Principal[]>([]);

        const { fetch } = yield* served(
          Layer.mergeAll(
            noting(seen),
            MemorySessions.layer({
              [aliceToken]: alice,
              [operatorToken]: operator,
            })
          )
        );

        // An RPC message may carry headers of its own (here, alice's token,
        // encoded as the wire carries it); only the HTTP request's
        // credential says who is calling.
        const message = `{"_tag":"Request","id":"1","tag":"status","payload":{},"headers":[["authorization","Bearer ${aliceToken}"]]}`;

        const status = (headers: Readonly<Record<string, string>>) =>
          fetch(
            new Request(`${origin}/rpc`, {
              body: message,
              headers: { "content-type": "application/json", ...headers },
              method: "POST",
            })
          ).pipe(
            Effect.flatMap((response) => Effect.promise(() => response.text()))
          );

        expect(yield* status({})).toContain('"_tag":"Unauthenticated"');
        expect(
          yield* status({ authorization: `Bearer ${operatorToken}` })
        ).toContain('"_tag":"Unauthenticated"');
        expect(yield* Ref.get(seen)).toStrictEqual([]);
      })
  );
});

describe("verifying a token", () => {
  it.effect(
    "verifies an MCP request's token once, and calls as its person",
    () =>
      Effect.gen(function* () {
        const seen = yield* Ref.make<readonly Principal[]>([]);

        const { layer, verified } = yield* counting;

        const { fetch } = yield* served(Layer.mergeAll(noting(seen), layer));

        const result = yield* toolResult(
          yield* fetch(toolCall("status", {}, aliceToken))
        );

        expect(result).toStrictEqual({
          isError: false,
          json: { answers: [], claims: [], handle: alice },
        });
        expect(yield* Ref.get(seen)).toStrictEqual([
          Person.make({ handle: alice }),
        ]);
        expect(yield* Ref.get(verified)).toBe(1);
      })
  );

  it.effect("verifies an RPC call's token once, and calls as its person", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<readonly Principal[]>([]);

      const { layer, verified } = yield* counting;

      const { handler } = yield* served(Layer.mergeAll(noting(seen), layer));

      const asAlice = yield* rpcClient(handler, aliceToken);

      expect(yield* Effect.exit(asAlice.status({}))).toStrictEqual(
        Exit.succeed({ answers: [], claims: [], handle: alice })
      );
      expect(yield* Ref.get(seen)).toStrictEqual([
        Person.make({ handle: alice }),
      ]);
      expect(yield* Ref.get(verified)).toBe(1);
    })
  );
});

describe("sessions", () => {
  it.effect(
    "lets a named session call as its handle, and the operator as theirs",
    () =>
      Effect.gen(function* () {
        const seen = yield* Ref.make<readonly Principal[]>([]);

        const table = TableSessions([
          { handle: operator, token: Redacted.make(operatorToken) },
          { handle: alice, token: Redacted.make(aliceToken) },
        ]);

        const { handler } = yield* served(Layer.mergeAll(noting(seen), table));

        const asAlice = yield* rpcClient(handler, aliceToken);
        const asOperator = yield* rpcClient(handler, operatorToken);

        expect(yield* Effect.exit(asAlice.status({}))).toStrictEqual(
          Exit.succeed({ answers: [], claims: [], handle: alice })
        );
        expect(yield* Effect.exit(asOperator.status({}))).toStrictEqual(
          Exit.succeed({ answers: [], claims: [], handle: operator })
        );

        expect(yield* Ref.get(seen)).toStrictEqual([
          Person.make({ handle: alice }),
          Person.make({ handle: operator }),
        ]);
      })
  );

  it.effect("takes the first entry when two name one token", () =>
    Effect.gen(function* () {
      const table = sessionTable([
        { handle: operator, token: Redacted.make(operatorToken) },
        { handle: alice, token: Redacted.make(operatorToken) },
      ]);

      expect(yield* table.verify(operatorToken)).toStrictEqual(
        Option.some(Person.make({ handle: operator }))
      );
    })
  );

  it.effect("asks each in turn and takes the first that knows the token", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make<readonly string[]>([]);

      const named = (name: string, tokens: Record<string, Handle>) => {
        const inner = MemorySessions.service(tokens);

        return Sessions.of({
          verify: (token) =>
            Effect.andThen(
              Ref.update(asked, (names) => [...names, name]),
              inner.verify(token)
            ),
        });
      };

      const both = firstOf([
        named("a", { "shared-token": alice }),
        named("b", { "b-token": operator, "shared-token": operator }),
      ]);

      expect(yield* both.verify("shared-token")).toStrictEqual(
        Option.some(Person.make({ handle: alice }))
      );
      expect(yield* both.verify("b-token")).toStrictEqual(
        Option.some(Person.make({ handle: operator }))
      );
      expect(yield* both.verify("nobody-token")).toStrictEqual(Option.none());
      expect(yield* Ref.get(asked)).toStrictEqual(["a", "a", "b", "a", "b"]);
    })
  );

  it.effect("knows nobody when it asks nobody", () =>
    Effect.gen(function* () {
      expect(yield* firstOf([]).verify(aliceToken)).toStrictEqual(
        Option.none()
      );
    })
  );
});
