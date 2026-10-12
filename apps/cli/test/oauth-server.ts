import { NodeHttpServer } from "@effect/platform-node";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";

export interface OAuthServerOptions {
  readonly token: string;
  readonly state?: "same" | "other";
}

interface Grant {
  readonly challenge: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

const TokenForm = Schema.Struct({
  client_id: Schema.String,
  code: Schema.String,
  code_verifier: Schema.String,
  grant_type: Schema.String,
  redirect_uri: Schema.String,
});

/** Base64url without padding, as RFC 7636 §4.2 spells the S256 challenge. */
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

const s256 = (verifier: string) =>
  Effect.map(
    Effect.promise(() =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    ),
    (digest) => base64url(new Uint8Array(digest))
  );

const refused = (error: string) =>
  HttpServerResponse.jsonUnsafe({ error }, { status: 400 });

export const oauthServer = (options: OAuthServerOptions) =>
  Effect.gen(function* () {
    const grants = yield* Ref.make<ReadonlyMap<string, Grant>>(new Map());
    const authorizations = yield* Ref.make<readonly URLSearchParams[]>([]);
    const issued = yield* Ref.make(0);

    const authorize = (query: URLSearchParams) =>
      Effect.gen(function* () {
        yield* Ref.update(authorizations, (all) => [...all, query]);

        const redirectUri = query.get("redirect_uri") ?? "";
        const challenge = query.get("code_challenge") ?? "";

        if (
          query.get("response_type") !== "code" ||
          query.get("code_challenge_method") !== "S256" ||
          challenge === ""
        ) {
          return refused("invalid_request");
        }

        const code = `code-${yield* Ref.updateAndGet(issued, (n) => n + 1)}`;

        yield* Ref.update(grants, (all) =>
          new Map(all).set(code, {
            challenge,
            clientId: query.get("client_id") ?? "",
            redirectUri,
          })
        );

        const back = new URL(redirectUri);

        back.searchParams.set("code", code);
        back.searchParams.set(
          "state",
          options.state === "other"
            ? "not-the-state"
            : (query.get("state") ?? "")
        );

        return HttpServerResponse.redirect(back.href, { status: 302 });
      });

    const token = Effect.gen(function* () {
      const form = yield* HttpServerRequest.schemaBodyUrlParams(TokenForm);
      const grant = (yield* Ref.get(grants)).get(form.code);

      yield* Ref.update(grants, (all) => {
        const left = new Map(all);

        left.delete(form.code);

        return left;
      });

      if (
        form.grant_type !== "authorization_code" ||
        grant === undefined ||
        grant.clientId !== form.client_id ||
        grant.redirectUri !== form.redirect_uri ||
        (yield* s256(form.code_verifier)) !== grant.challenge
      ) {
        return refused("invalid_grant");
      }

      return HttpServerResponse.jsonUnsafe({
        access_token: options.token,
        token_type: "bearer",
      });
    }).pipe(Effect.orElseSucceed(() => refused("invalid_request")));

    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/authorize") {
        return yield* authorize(url.searchParams);
      }

      if (request.method === "POST" && url.pathname === "/token") {
        return yield* token;
      }

      return HttpServerResponse.empty({ status: 404 });
    });

    const server = yield* Layer.build(
      HttpServer.serve(app).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
    ).pipe(Effect.orDie);

    const { address } = Context.get(server, HttpServer.HttpServer);

    const origin =
      "port" in address
        ? `http://127.0.0.1:${address.port}`
        : yield* Effect.die("the test server listens on a socket, not a port");

    return { authorizations: Ref.get(authorizations), origin };
  });
