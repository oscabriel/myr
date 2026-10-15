import { NodeHttpServer } from "@effect/platform-node";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";

export interface OAuthServerOptions {
  readonly token: string;
  readonly state?: "same" | "other";
  // Refuse every renewal, as a platform does once the grant has ended.
  readonly refuseRenewals?: boolean;
  // A refresh token it gave out before the test began.
  readonly given?: string;
}

interface Grant {
  readonly challenge: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

const TokenForm = Schema.Record(Schema.String, Schema.String);

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

export const refreshTokenOf = (count: number) => `refresh-${count}`;

export const renewedTokenOf = (token: string, count: number) =>
  `${token}-renewed-${count}`;

/**
 * An authorization server as the platform's behaves for the CLI: PKCE codes,
 * then refresh tokens that rotate on each renewal, the one just replaced still
 * taken once, and revocation of a whole grant by any of its refresh tokens.
 */
export const oauthServer = (options: OAuthServerOptions) =>
  Effect.gen(function* () {
    const grants = yield* Ref.make<ReadonlyMap<string, Grant>>(new Map());
    const authorizations = yield* Ref.make<readonly URLSearchParams[]>([]);
    const renewals = yield* Ref.make<readonly Record<string, string>[]>([]);
    const revocations = yield* Ref.make<readonly Record<string, string>[]>([]);
    const issued = yield* Ref.make(0);
    const refreshes = yield* Ref.make(0);

    // The refresh tokens still taken: the current one and the one before it.
    const live = yield* Ref.make<readonly string[]>(
      options.given === undefined ? [] : [options.given]
    );

    // Seconds each token lives, as the platform's default says.
    const lifetime = 3600;

    const tokens = (accessToken: string) =>
      Effect.gen(function* () {
        const count = yield* Ref.updateAndGet(refreshes, (n) => n + 1);
        const refreshToken = refreshTokenOf(count);

        yield* Ref.update(live, (all) => [...all.slice(-1), refreshToken]);

        return HttpServerResponse.jsonUnsafe({
          access_token: accessToken,
          expires_in: lifetime,
          refresh_token: refreshToken,
          token_type: "bearer",
        });
      });

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

    const traded = (form: Readonly<Record<string, string>>) =>
      Effect.gen(function* () {
        const code = form.code ?? "";
        const grant = (yield* Ref.get(grants)).get(code);

        yield* Ref.update(grants, (all) => {
          const left = new Map(all);

          left.delete(code);

          return left;
        });

        if (
          grant === undefined ||
          grant.clientId !== form.client_id ||
          grant.redirectUri !== form.redirect_uri ||
          (yield* s256(form.code_verifier ?? "")) !== grant.challenge
        ) {
          return refused("invalid_grant");
        }

        return yield* tokens(options.token);
      });

    const renewed = (form: Readonly<Record<string, string>>) =>
      Effect.gen(function* () {
        yield* Ref.update(renewals, (all) => [...all, form]);

        const presented = form.refresh_token ?? "";

        if (
          options.refuseRenewals === true ||
          !(yield* Ref.get(live)).includes(presented)
        ) {
          return refused("invalid_grant");
        }

        return yield* tokens(
          renewedTokenOf(options.token, yield* Ref.get(refreshes))
        );
      });

    const revoked = (form: Readonly<Record<string, string>>) =>
      Effect.gen(function* () {
        yield* Ref.update(revocations, (all) => [...all, form]);

        if ((yield* Ref.get(live)).includes(form.token ?? "")) {
          yield* Ref.set(live, []);
        }

        return HttpServerResponse.empty({ status: 200 });
      });

    const token = Effect.gen(function* () {
      const form = yield* HttpServerRequest.schemaBodyUrlParams(TokenForm);

      if (form.grant_type === "authorization_code") {
        return yield* traded(form);
      }

      if (form.grant_type === "refresh_token") {
        return yield* renewed(form);
      }

      return form.grant_type === undefined && form.token !== undefined
        ? yield* revoked(form)
        : refused("unsupported_grant_type");
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

    return {
      authorizations: Ref.get(authorizations),
      // The refresh tokens it still takes.
      live: Ref.get(live),
      origin,
      renewals: Ref.get(renewals),
      revocations: Ref.get(revocations),
    };
  });
