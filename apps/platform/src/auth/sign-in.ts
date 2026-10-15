import {
  AuthorizationError,
  CimdFetchError,
} from "@cloudflare/workers-oauth-provider";
import type {
  AuthRequest as ProviderAuthRequest,
  OAuthAuthorizationServer,
} from "@cloudflare/workers-oauth-provider";
import { Brand } from "@repo/brand";
import { Handle, reservedProjectNames, sameHandle } from "@repo/protocol/ids";
import { legacyProjects } from "@repo/protocol/legacy";
import {
  Context,
  Data,
  Effect,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import {
  Accounts,
  DisplayName,
  Email,
  emailKey,
  handleKey,
} from "./accounts.ts";
import type { Account } from "./accounts.ts";
import { SignInAttempts } from "./attempts.ts";
import {
  CLI_CLIENT_PATH,
  CLI_CODE_PATH,
  cliClientMetadata,
} from "./cli-client.ts";
import { codeMatches, codeTag, deadTag, freshCode } from "./codes.ts";
import type { CodePurpose } from "./codes.ts";
import { firstPartyOf } from "./first-party.ts";
import { Mailer } from "./mailer.ts";
import { OAuthStore } from "./oauth-store.ts";
import {
  ACCOUNT_PATHS,
  addEmailPage,
  cliCodePage,
  codePage,
  continuePage,
  problemPage,
  resetPage,
  SESSION_PATHS,
  signInPage,
  signUpPage,
} from "./pages.ts";
import type { Asker, CodeForm, PendingForm, SignUpValues } from "./pages.ts";
import {
  hashPassword,
  PasswordHash,
  PasswordPolicy,
  verifyPassword,
} from "./password.ts";
import {
  hasSessionCookie,
  sessionAccount,
  withoutSession,
  withSession,
} from "./platform-session.ts";
import {
  AuthRequest,
  openState,
  sealing,
  sealState,
  SIGN_IN_LIFETIME,
  SignInFailed,
  startAgain,
} from "./state.ts";
import type { PendingSignIn } from "./state.ts";

export class SignInKeys extends Context.Service<
  SignInKeys,
  {
    readonly cookieKey: Redacted.Redacted;
    readonly pepper: Redacted.Redacted;
  }
>()("platform/SignInKeys") {}

export class SignInOffers extends Context.Service<
  SignInOffers,
  { readonly google: Option.Option<string> }
>()("platform/SignInOffers") {}

// The web's address, when the platform knows it: the wordmark links there, and its client is told apart from any other.
export class SignInHome extends Context.Service<
  SignInHome,
  { readonly webUrl: Option.Option<string> }
>()("platform/SignInHome") {}

// Nobody signs up as a handle a named session holds, or an account would call as that person.
export class HeldHandles extends Context.Service<
  HeldHandles,
  { readonly handles: readonly Handle[] }
>()("platform/HeldHandles") {}

export interface OAuthEnv {
  readonly OAUTH_KV: OAuthStore["Service"];
}

export class Authorization extends Context.Service<
  Authorization,
  {
    readonly context: ExecutionContext;
    readonly origin: string;
    readonly server: OAuthAuthorizationServer<OAuthEnv>;
  }
>()("platform/Authorization") {}

export const AUTHORIZATION_SERVER_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/token",
] as const;

export const SIGN_IN_PATHS = [
  "/authorize",
  "/signup",
  CLI_CLIENT_PATH,
  CLI_CODE_PATH,
  ...Object.values(ACCOUNT_PATHS),
  ...Object.values(SESSION_PATHS),
] as const;

// A handle is an owner, the first segment of a project's address, so it may not be a word the web serves pages at.
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  ...reservedProjectNames,
  ...legacyProjects.map(({ key }) => key),
  Brand.slug,
  "admin",
  "api",
  "platform",
  "root",
  "security",
  "support",
  "www",
]);

const AccountHandle = Handle.check(Schema.isMaxLength(39));

const decodeHandle = Schema.decodeUnknownOption(AccountHandle);

const PasswordLength = { max: 256, min: 12 } as const;

export const Says = {
  codeWrong:
    "That code is wrong or has expired. Check the newest mail from us, or start again.",
  displayName:
    "A display name is 1 to 64 characters, with no space at either end.",
  emailHeld: "Another account already uses that email. Add a different one.",
  emailSpelling: "That does not look like an email address.",
  emailTaken:
    "That email already has an account. Sign in, or reset your password.",
  handleReserved: "That handle is reserved. Choose another.",
  handleSpelling:
    "A handle is 1 to 39 letters, digits and dashes, starting with a letter or digit.",
  handleTaken: "That handle is taken. Choose another, or sign in.",
  handleTakenSince:
    "Someone took that handle while you confirmed your email. Choose another.",
  mailFailed: "We could not send the mail just now. Try again in a minute.",
  passwordLength: "A password is 12 to 256 characters.",
  signedOut: "You were signed out here. Sign in again.",
  tooManyCodes:
    "Too many codes tried for that address. Wait a minute, then try again.",
  tooManyMails:
    "Too many mails to that address, or from here. Wait a minute, then try again.",
  tooManySignIns:
    "Too many sign-in attempts for this account or from here. Wait a minute, then try again.",
  tooManySignUps: "Too many sign-ups from here. Wait a minute, then try again.",
  unverifiedClient:
    "This app could not be verified: its client metadata document could not be read.",
  wrong: "The email, handle or password is wrong.",
} as const;

// Verified against when no account has the handle, so timing names nobody.
const STAND_IN_HASH = PasswordHash.make(
  `pbkdf2-sha256$${PasswordPolicy.iterations}$${"A".repeat(22)}$${"A".repeat(43)}`
);

/**
 * One cookie per sign-in in progress, named by the head of its own token: a
 * second sign-in in the same browser (the CLI's and an agent's, each in its
 * own tab) never replaces the first's, so neither is told it expired. Each
 * lapses with its form, and a finished one is cleared.
 */
export const csrfCookieName = (csrf: string) =>
  `__Host-sign-in-${csrf.slice(0, 16)}`;

export const csrfOf = (
  request: HttpServerRequest.HttpServerRequest,
  csrf: string
): string | undefined => request.cookies[csrfCookieName(csrf)];

export const csrfCookie = {
  httpOnly: true,
  path: "/",
  sameSite: "strict",
  secure: true,
} as const;

// CSP's host grammar cannot name an IPv6 literal host, so only its scheme.
const redirectSource = (redirectUri: string) =>
  Option.fromNullishOr(URL.parse(redirectUri)).pipe(
    Option.filter(({ origin }) => origin !== "null"),
    Option.map(({ hostname, origin, protocol }) =>
      hostname.startsWith("[") ? protocol : origin
    )
  );

// Browsers hold a form post's redirect to `form-action` too, so the client's
// redirect URI is allowed there. Built by directive, so a source meant for
// `form-action` never lands in the directive written after it.
const contentSecurityPolicy = (
  redirectUri?: string,
  formActions: readonly string[] = []
) =>
  [
    ["default-src", "'none'"],
    ["style-src", "'unsafe-inline'"],
    [
      "form-action",
      "'self'",
      ...Option.toArray(
        Option.flatMap(Option.fromUndefinedOr(redirectUri), redirectSource)
      ),
      ...formActions,
    ],
    ["frame-ancestors", "'none'"],
  ]
    .map((directive) => directive.join(" "))
    .join("; ");

export const htmlPage = (
  body: string,
  status: number,
  redirectUri?: string,
  formActions: readonly string[] = []
) =>
  HttpServerResponse.text(body, {
    contentType: "text/html; charset=utf-8",
    headers: {
      "cache-control": "no-store",
      "content-security-policy": contentSecurityPolicy(
        redirectUri,
        formActions
      ),
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    },
    status,
  });

class ProviderFailed extends Data.TaggedError("ProviderFailed")<{
  readonly cause: unknown;
}> {}

const provider = <A>(call: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) => new ProviderFailed({ cause }),
    try: call,
  }).pipe(
    Effect.catchTag("ProviderFailed", ({ cause }) => {
      if (cause instanceof AuthorizationError) {
        return Effect.fail(
          cause.redirectTo === undefined
            ? new SignInFailed({ reason: cause.description })
            : new SignInFailed({
                reason: cause.description,
                redirectTo: cause.redirectTo,
              })
        );
      }

      return cause instanceof CimdFetchError
        ? Effect.fail(new SignInFailed({ reason: Says.unverifiedClient }))
        : Effect.die(cause);
    })
  );

const oauthApi = Effect.gen(function* () {
  const { server } = yield* Authorization;

  const store = yield* OAuthStore;

  return server.getOAuthApi({ OAUTH_KV: store });
});

// An absent key stays absent, never `undefined`.
const forProvider = (request: AuthRequest) => {
  const provided: ProviderAuthRequest = {
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    responseType: request.responseType,
    scope: [...request.scope],
    state: request.state,
  };

  if (request.codeChallenge !== undefined) {
    provided.codeChallenge = request.codeChallenge;
  }

  if (request.codeChallengeMethod !== undefined) {
    provided.codeChallengeMethod = request.codeChallengeMethod;
  }

  if (request.issuer !== undefined) {
    provided.issuer = request.issuer;
  }

  if (request.resource !== undefined) {
    provided.resource = request.resource;
  }

  return provided;
};

export const askerOf = (request: AuthRequest) =>
  Effect.gen(function* () {
    const api = yield* oauthApi;
    const { origin } = yield* Authorization;
    const { webUrl } = yield* SignInHome;

    const consent = yield* provider(() =>
      api.describeConsent(forProvider(request))
    );

    const asker: Asker = {
      clientDomain: consent.clientDomain,
      clientName: consent.clientName,
      firstParty: firstPartyOf(request.clientId, origin, webUrl),
      home: Option.getOrElse(webUrl, () => "/"),
      redirectHost: consent.redirectHost,
      redirectIsLoopback: consent.redirectIsLoopback,
    };

    return asker;
  });

export const authorizeHref = (request: AuthRequest) => {
  const query = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: request.responseType,
    state: request.state,
  });

  const optional = [
    ["code_challenge", request.codeChallenge],
    ["code_challenge_method", request.codeChallengeMethod],
    ["resource", request.resource],
    ["scope", request.scope.length === 0 ? undefined : request.scope.join(" ")],
  ] as const;

  for (const [name, value] of optional) {
    if (value !== undefined) {
      query.set(name, value);
    }
  }

  return `/authorize?${query.toString()}`;
};

const encodeToken = Schema.encodeEffect(Schema.Uint8ArrayFromBase64Url);

export const freshCsrf = Effect.sync(() =>
  crypto.getRandomValues(new Uint8Array(32))
).pipe(Effect.flatMap(encodeToken), Effect.orDie);

const decodeEmail = Schema.decodeUnknownOption(Email);

const decodeDisplayName = Schema.decodeUnknownOption(DisplayName);

export const addressOf = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers["cf-connecting-ip"] ?? "unknown";

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

const lengthOf = (password: string) => [...graphemes.segment(password)].length;

const passwordFits = (password: string) =>
  lengthOf(password) >= PasswordLength.min &&
  lengthOf(password) <= PasswordLength.max;

const withCsrfCookie =
  (csrf: string) => (response: HttpServerResponse.HttpServerResponse) =>
    response.pipe(
      HttpServerResponse.setCookie(csrfCookieName(csrf), csrf, {
        ...csrfCookie,
        maxAge: SIGN_IN_LIFETIME,
      }),
      Effect.orDie
    );

// A form's own CSRF token, the one sealed into it and the cookie's agree, or the form was not opened here.
const sameCsrf = (
  request: HttpServerRequest.HttpServerRequest,
  posted: string,
  sealed: string
) =>
  sealed === posted && csrfOf(request, posted) === posted
    ? Effect.void
    : Effect.fail(startAgain);

// The form a request posted, if it posted one: its CSRF token names the cookie to clear.
const postedCsrf = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;

  return request.method === "POST"
    ? yield* HttpServerRequest.schemaBodyUrlParams(
        Schema.Struct({ csrf: Schema.String })
      ).pipe(
        Effect.map(({ csrf }) => Option.some(csrf)),
        Effect.orElseSucceed(() => Option.none<string>())
      )
    : Option.none<string>();
});

// The grant's user is the handle's key, so a grant is one account's in any case.
// Every account it is given for has a proven email, or the person just proved
// who they are to Google, whose address is then the account's. Each grant
// keeps the person signed in here, under the password the account has now
// (read again, since a reset has just changed it), so the next asks only to
// continue.
export const completed = (handle: Handle, request: AuthRequest) =>
  Effect.gen(function* () {
    const api = yield* oauthApi;
    const { cookieKey } = yield* SignInKeys;
    const { origin } = yield* Authorization;
    const { webUrl } = yield* SignInHome;
    const account = yield* (yield* Accounts).find(handle);
    const csrf = yield* postedCsrf;

    const { redirectTo } = yield* provider(() =>
      api.completeAuthorization({
        metadata: {},
        props: { handle },
        request: forProvider(request),
        // A grant to the web replaces none: each browser a person signs in on keeps its own.
        revokeExistingGrants:
          firstPartyOf(request.clientId, origin, webUrl) !== "web",
        scope: [...request.scope],
        userId: handleKey(handle),
      })
    );

    const redirected = HttpServerResponse.redirect(redirectTo, {
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
      status: 302,
    });

    // Only this sign-in's cookie: another in progress in this browser keeps its own.
    const cleared = yield* Option.match(csrf, {
      onNone: () => Effect.succeed(redirected),
      onSome: (finished) =>
        redirected.pipe(
          HttpServerResponse.setCookie(csrfCookieName(finished), "", {
            ...csrfCookie,
            maxAge: 0,
          }),
          Effect.orDie
        ),
    });

    return yield* Option.match(account, {
      onNone: () => Effect.succeed(cleared),
      onSome: (found) => withSession(cookieKey, found)(cleared),
    });
  });

const offeredSignIn = (
  request: AuthRequest,
  form: PendingForm,
  status: number,
  message?: string
) =>
  Effect.gen(function* () {
    const { google } = yield* SignInOffers;

    const asker = yield* askerOf(request);

    return htmlPage(
      signInPage(asker, form, { google: Option.isSome(google) }, message),
      status,
      request.redirectUri,
      Option.toArray(google)
    );
  });

export const signInPageFor = (
  request: AuthRequest,
  status: number,
  message?: string
) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const csrf = yield* freshCsrf;

    const sealed = yield* sealState(cookieKey, { csrf, request });

    const page = yield* offeredSignIn(
      request,
      { csrf, request: sealed },
      status,
      message
    );

    return yield* withCsrfCookie(csrf)(page);
  });

const continuePageFor = (request: AuthRequest, account: Account) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const csrf = yield* freshCsrf;

    const sealed = yield* sealState(cookieKey, { csrf, request });

    const asker = yield* askerOf(request);

    return yield* withCsrfCookie(csrf)(
      htmlPage(
        continuePage(
          asker,
          { csrf, request: sealed },
          { displayName: account.displayName, handle: account.handle }
        ),
        200,
        request.redirectUri
      )
    );
  });

// A session that no longer fits is dropped as the page that replaces it is shown.
const signInOrDropped = (
  request: HttpServerRequest.HttpServerRequest,
  pending: AuthRequest,
  message?: string
) =>
  Effect.gen(function* () {
    const page = yield* signInPageFor(pending, 200, message);

    return hasSessionCookie(request) ? yield* withoutSession(page) : page;
  });

// Someone signed in here already is asked only to continue; anyone else, to sign in.
const showSignIn = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const api = yield* oauthApi;
    const { cookieKey } = yield* SignInKeys;

    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

    const parsed = yield* provider(() => api.parseAuthRequest(web));

    const account = yield* sessionAccount(cookieKey, request);

    return yield* Option.match(account, {
      onNone: () => signInOrDropped(request, parsed),
      onSome: (signedIn) => continuePageFor(parsed, signedIn),
    });
  });

// Mailing

const MAIL_TEXT: Record<CodePurpose, (code: string) => string> = {
  "add-email": (code) =>
    `Your code to add this address to your ${Brand.name} account is ${code}. It works for 10 minutes.\n\nIf you did not ask for it, ignore this mail: nothing changes without the code.`,
  reset: (code) =>
    `Your code to set a new ${Brand.name} password is ${code}. It works for 10 minutes.\n\nIf you did not ask for it, ignore this mail: your password stays as it is.`,
  "sign-up": (code) =>
    `Your code to finish signing up for ${Brand.name} is ${code}. It works for 10 minutes.\n\nIf you did not sign up, ignore this mail: no account is made without the code.`,
};

// SIGN_IN_LIMIT's few mails a minute to one address, of any kind, so the forms are no way to flood an inbox.
const mailAdmitted = (email: Email) =>
  Effect.flatMap(SignInAttempts, (attempts) =>
    attempts.admit(`mail:${emailKey(email)}`)
  );

const mailCode = (purpose: CodePurpose, email: Email) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const mailer = yield* Mailer;

    const code = yield* freshCode;

    yield* mailer.send({
      subject: `${code} is your ${Brand.name} code`,
      text: MAIL_TEXT[purpose](code),
      to: email,
    });

    return yield* codeTag(cookieKey, purpose, email, code);
  });

// Sent in place of a code when the address already has an account, so the page reads the same either way.
const mailAlreadyHeld = (email: Email) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;

    yield* mailer.send({
      subject: `You already have a ${Brand.name} account`,
      text: `Someone, maybe you, tried to sign up for ${Brand.name} with this address, which already has an account. To get in, sign in, or choose "Forgot your password?" on the sign-in page.\n\nIf it was not you, ignore this mail: nothing changed.`,
      to: email,
    });

    return yield* deadTag;
  });

const codeTried = (email: Email) =>
  Effect.flatMap(SignInAttempts, (attempts) =>
    attempts.admit(`code:${emailKey(email)}`)
  );

interface CodeStep {
  readonly csrf: string;
  readonly request: AuthRequest;
  readonly sealed: string;
}

const codePageFor = (
  step: CodeStep,
  code: CodeForm,
  status: number,
  message?: string
) =>
  Effect.map(askerOf(step.request), (asker) =>
    htmlPage(
      codePage(asker, { csrf: step.csrf, request: step.sealed }, code, message),
      status,
      step.request.redirectUri
    )
  );

const codeSentTo = (email: Email) => `We mailed a code to ${email}.`;

// Signing in

const PostedSignIn = Schema.Struct({
  csrf: Schema.String,
  login: Schema.String,
  password: Schema.String,
  request: Schema.String,
});

// An `@` makes it an email; anything else is read as a handle.
const accountNamed = (login: string) =>
  Effect.gen(function* () {
    const accounts = yield* Accounts;

    const named = login.trim();

    if (named.includes("@")) {
      return yield* Option.match(decodeEmail(named), {
        onNone: () => Effect.succeedNone,
        onSome: accounts.findByEmail,
      });
    }

    return yield* Option.match(decodeHandle(named), {
      onNone: () => Effect.succeedNone,
      onSome: accounts.find,
    });
  });

// A wrong login and a wrong password read the same.
export const byPassword = <E, R>(
  request: HttpServerRequest.HttpServerRequest,
  signedIn: (
    account: Account,
    pending: PendingSignIn
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
) =>
  Effect.gen(function* () {
    const { cookieKey, pepper } = yield* SignInKeys;

    const accounts = yield* Accounts;

    const attempts = yield* SignInAttempts;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(
      PostedSignIn
    ).pipe(Effect.mapError(() => startAgain));

    const pending = yield* openState(cookieKey, form.request);

    yield* sameCsrf(request, form.csrf, pending.csrf);

    const shown: PendingForm = { csrf: form.csrf, request: form.request };

    const again = (status: number, message: string) =>
      offeredSignIn(pending.request, shown, status, message);

    const fits = passwordFits(form.password);

    const account = fits ? yield* accountNamed(form.login) : Option.none();

    // An account is counted by its handle however it was named, so an email
    // and a handle share one limit.
    const admitted = yield* Effect.all([
      attempts.admit(`address:${addressOf(request)}`),
      attempts.admit(
        Option.match(account, {
          onNone: () => `login:${form.login.trim().toLowerCase()}`,
          onSome: ({ handle }) => `handle:${handleKey(handle)}`,
        })
      ),
    ]);

    if (!admitted.every(Boolean)) {
      return yield* again(429, Says.tooManySignIns);
    }

    const password = Redacted.make(form.password);

    const { needsRehash, ok } = yield* verifyPassword(
      pepper,
      password,
      Option.match(account, {
        onNone: () => STAND_IN_HASH,
        onSome: ({ hash }) => hash,
      })
    );

    if (Option.isNone(account) || !ok) {
      return yield* again(401, Says.wrong);
    }

    if (needsRehash) {
      yield* accounts.setPasswordHash(
        account.value.handle,
        yield* hashPassword(pepper, password)
      );
    }

    return yield* signedIn(account.value, pending);
  });

// Adding an email: an account made before sign-up asked for one

const NeedsEmail = Schema.Struct({
  csrf: Schema.String,
  handle: Handle,
  request: AuthRequest,
});

const needingEmail = sealing("needs-email", NeedsEmail);

const PendingEmail = Schema.Struct({
  csrf: Schema.String,
  email: Email,
  handle: Handle,
  request: AuthRequest,
  tag: Schema.String,
});

const pendingEmails = sealing("email-code", PendingEmail);

// The person proved their password, or Google proved who they are: only an email stands between them and the grant.
export const addEmailPageFor = (
  handle: Handle,
  request: AuthRequest,
  status: number,
  message?: string,
  value?: string
) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const csrf = yield* freshCsrf;

    const sealed = yield* needingEmail.seal(cookieKey, {
      csrf,
      handle,
      request,
    });

    const asker = yield* askerOf(request);

    return yield* withCsrfCookie(csrf)(
      htmlPage(
        addEmailPage(
          asker,
          { csrf, request: sealed },
          authorizeHref(request),
          value,
          message
        ),
        status,
        request.redirectUri
      )
    );
  });

// A signed-in account with no email adds one before its grant.
export const signedInWithEmail = (account: Account, request: AuthRequest) =>
  Effect.gen(function* () {
    return account.email === undefined
      ? yield* addEmailPageFor(account.handle, request, 200)
      : yield* completed(account.handle, request);
  });

const signIn = (request: HttpServerRequest.HttpServerRequest) =>
  byPassword(request, (account, pending) =>
    signedInWithEmail(account, pending.request)
  );

const PostedContinue = Schema.Struct({
  csrf: Schema.String,
  request: Schema.String,
});

// No password is asked, so the session is read again at the click: it must still fit, and the email rule still holds.
const continueAs = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(
      PostedContinue
    ).pipe(Effect.mapError(() => startAgain));

    const pending = yield* openState(cookieKey, form.request);

    yield* sameCsrf(request, form.csrf, pending.csrf);

    const account = yield* sessionAccount(cookieKey, request);

    return yield* Option.match(account, {
      onNone: () => signInOrDropped(request, pending.request, Says.signedOut),
      onSome: (signedIn) => signedInWithEmail(signedIn, pending.request),
    });
  });

// Leaves the session and signs in afresh for the same client.
const switchAccount = Effect.gen(function* () {
  const { cookieKey } = yield* SignInKeys;

  const { request: sealed } = yield* HttpServerRequest.schemaSearchParams(
    Schema.Struct({ request: Schema.String })
  ).pipe(Effect.mapError(() => startAgain));

  const pending = yield* openState(cookieKey, sealed);

  return yield* signInPageFor(pending.request, 200).pipe(
    Effect.flatMap(withoutSession)
  );
});

// Always to the web's home, never to an address the request names.
const signOut = Effect.gen(function* () {
  const { webUrl } = yield* SignInHome;

  return yield* withoutSession(
    HttpServerResponse.redirect(
      Option.getOrElse(webUrl, () => "/"),
      { headers: { "cache-control": "no-store" }, status: 302 }
    )
  );
});

const addEmailCode = (request: AuthRequest, email: Email): CodeForm => ({
  action: ACCOUNT_PATHS.addEmailVerify,
  intro: codeSentTo(email),
  newPassword: false,
  startOverHref: authorizeHref(request),
});

const PostedEmail = Schema.Struct({
  csrf: Schema.String,
  email: Schema.String,
  request: Schema.String,
});

const addEmail = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(PostedEmail).pipe(
      Effect.mapError(() => startAgain)
    );

    const pending = yield* needingEmail.open(cookieKey, form.request);

    yield* sameCsrf(request, form.csrf, pending.csrf);

    const again = (status: number, message: string) =>
      Effect.map(askerOf(pending.request), (asker) =>
        htmlPage(
          addEmailPage(
            asker,
            { csrf: form.csrf, request: form.request },
            authorizeHref(pending.request),
            form.email,
            message
          ),
          status,
          pending.request.redirectUri
        )
      );

    const email = decodeEmail(form.email.trim());

    if (Option.isNone(email)) {
      return yield* again(400, Says.emailSpelling);
    }

    if (!(yield* mailAdmitted(email.value))) {
      return yield* again(429, Says.tooManyMails);
    }

    // Mailed even when another account holds the address: that is said only
    // once the code shows the person reads it.
    const tag = yield* mailCode("add-email", email.value).pipe(Effect.option);

    if (Option.isNone(tag)) {
      return yield* again(503, Says.mailFailed);
    }

    const sealed = yield* pendingEmails.seal(cookieKey, {
      csrf: form.csrf,
      email: email.value,
      handle: pending.handle,
      request: pending.request,
      tag: tag.value,
    });

    return yield* codePageFor(
      { csrf: form.csrf, request: pending.request, sealed },
      addEmailCode(pending.request, email.value),
      200
    );
  });

const PostedCode = Schema.Struct({
  code: Schema.String,
  csrf: Schema.String,
  request: Schema.String,
});

const addEmailVerified = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const accounts = yield* Accounts;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(PostedCode).pipe(
      Effect.mapError(() => startAgain)
    );

    const pending = yield* pendingEmails.open(cookieKey, form.request);

    yield* sameCsrf(request, form.csrf, pending.csrf);

    const again = (status: number, message: string) =>
      codePageFor(
        {
          csrf: form.csrf,
          request: pending.request,
          sealed: form.request,
        },
        addEmailCode(pending.request, pending.email),
        status,
        message
      );

    if (!(yield* codeTried(pending.email))) {
      return yield* again(429, Says.tooManyCodes);
    }

    const right = yield* codeMatches(
      cookieKey,
      "add-email",
      pending.email,
      pending.tag,
      form.code
    );

    if (!right) {
      return yield* again(401, Says.codeWrong);
    }

    const set = yield* accounts.setEmail(pending.handle, pending.email).pipe(
      Effect.as(true),
      Effect.catchTag("EmailTaken", () => Effect.succeed(false))
    );

    return yield* set
      ? completed(pending.handle, pending.request)
      : addEmailPageFor(pending.handle, pending.request, 409, Says.emailHeld);
  });

// Signing up: the account is written only once the mailed code comes back

const PendingSignUp = Schema.Struct({
  csrf: Schema.String,
  displayName: DisplayName,
  email: Email,
  handle: Handle,
  // Peppered: worthless to the browser that holds the form.
  hash: PasswordHash,
  request: AuthRequest,
  tag: Schema.String,
});

const pendingSignUps = sealing("sign-up-code", PendingSignUp);

const showSignUp = Effect.gen(function* () {
  const { cookieKey } = yield* SignInKeys;

  const { request: sealed } = yield* HttpServerRequest.schemaSearchParams(
    Schema.Struct({ request: Schema.String })
  ).pipe(Effect.mapError(() => startAgain));

  const pending = yield* openState(cookieKey, sealed);

  const asker = yield* askerOf(pending.request);
  const { google } = yield* SignInOffers;

  return htmlPage(
    signUpPage(
      asker,
      { csrf: pending.csrf, request: sealed },
      { google: Option.isSome(google) },
      authorizeHref(pending.request),
      {}
    ),
    200,
    pending.request.redirectUri
  );
});

export interface Refused {
  readonly message: string;
  readonly status: number;
}

export const chosenHandle = (
  handle: string,
  held: readonly Handle[]
): Result.Result<Handle, Refused> =>
  Option.match(decodeHandle(handle.trim()), {
    onNone: () => Result.fail({ message: Says.handleSpelling, status: 400 }),
    onSome: (chosen) => {
      if (RESERVED_HANDLES.has(handleKey(chosen))) {
        return Result.fail({ message: Says.handleReserved, status: 400 });
      }

      if (held.some((holder) => sameHandle(holder, chosen))) {
        return Result.fail({ message: Says.handleTaken, status: 409 });
      }

      return Result.succeed(chosen);
    },
  });

export const chosenDisplayName = (
  name: string
): Result.Result<DisplayName, Refused> =>
  Option.match(decodeDisplayName(name.trim()), {
    onNone: () => Result.fail({ message: Says.displayName, status: 400 }),
    onSome: Result.succeed,
  });

const PostedSignUp = Schema.Struct({
  csrf: Schema.String,
  displayName: Schema.String,
  email: Schema.String,
  handle: Schema.String,
  password: Schema.String,
  request: Schema.String,
});

type PostedSignUp = typeof PostedSignUp.Type;

interface SignUpChoice {
  readonly displayName: DisplayName;
  readonly email: Email;
  readonly handle: Handle;
}

const signUpChoice = (
  form: PostedSignUp,
  held: readonly Handle[]
): Result.Result<SignUpChoice, Refused> =>
  Result.flatMap(
    Result.all({
      displayName: chosenDisplayName(form.displayName),
      email: Option.match(decodeEmail(form.email.trim()), {
        onNone: () =>
          Result.fail<Refused>({ message: Says.emailSpelling, status: 400 }),
        onSome: Result.succeed,
      }),
      handle: chosenHandle(form.handle, held),
    }),
    (choice) =>
      passwordFits(form.password)
        ? Result.succeed(choice)
        : Result.fail({ message: Says.passwordLength, status: 400 })
  );

const signUpPageFor = (
  request: AuthRequest,
  form: PendingForm,
  values: SignUpValues,
  status: number,
  message: string
) =>
  Effect.gen(function* () {
    const asker = yield* askerOf(request);
    const { google } = yield* SignInOffers;

    return htmlPage(
      signUpPage(
        asker,
        form,
        { google: Option.isSome(google) },
        authorizeHref(request),
        values,
        message
      ),
      status,
      request.redirectUri
    );
  });

const signUpCode = (request: AuthRequest, email: Email): CodeForm => ({
  action: ACCOUNT_PATHS.signUpVerify,
  intro: codeSentTo(email),
  newPassword: false,
  startOverHref: authorizeHref(request),
});

const signUp = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { cookieKey, pepper } = yield* SignInKeys;

    const accounts = yield* Accounts;

    const attempts = yield* SignInAttempts;

    const { handles: held } = yield* HeldHandles;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(
      PostedSignUp
    ).pipe(Effect.mapError(() => startAgain));

    const pending = yield* openState(cookieKey, form.request);

    yield* sameCsrf(request, form.csrf, pending.csrf);

    const again = (status: number, message: string) =>
      signUpPageFor(
        pending.request,
        { csrf: form.csrf, request: form.request },
        {
          displayName: form.displayName,
          email: form.email,
          handle: form.handle,
        },
        status,
        message
      );

    if (!(yield* attempts.admit(`sign-up:${addressOf(request)}`))) {
      return yield* again(429, Says.tooManySignUps);
    }

    const checked = signUpChoice(form, held);

    if (Result.isFailure(checked)) {
      return yield* again(checked.failure.status, checked.failure.message);
    }

    const { displayName, email, handle } = checked.success;

    if (Option.isSome(yield* accounts.find(handle))) {
      return yield* again(409, Says.handleTaken);
    }

    if (!(yield* mailAdmitted(email))) {
      return yield* again(429, Says.tooManyMails);
    }

    const holder = yield* accounts.findByEmail(email);

    const tag = yield* (
      Option.isSome(holder)
        ? mailAlreadyHeld(email)
        : mailCode("sign-up", email)
    ).pipe(Effect.option);

    if (Option.isNone(tag)) {
      return yield* again(503, Says.mailFailed);
    }

    const sealed = yield* pendingSignUps.seal(cookieKey, {
      csrf: form.csrf,
      displayName,
      email,
      handle,
      hash: yield* hashPassword(pepper, Redacted.make(form.password)),
      request: pending.request,
      tag: tag.value,
    });

    return yield* codePageFor(
      { csrf: form.csrf, request: pending.request, sealed },
      signUpCode(pending.request, email),
      200
    );
  });

const signUpVerified = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const accounts = yield* Accounts;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(PostedCode).pipe(
      Effect.mapError(() => startAgain)
    );

    const pending = yield* pendingSignUps.open(cookieKey, form.request);

    yield* sameCsrf(request, form.csrf, pending.csrf);

    const again = (status: number, message: string) =>
      codePageFor(
        { csrf: form.csrf, request: pending.request, sealed: form.request },
        signUpCode(pending.request, pending.email),
        status,
        message
      );

    if (!(yield* codeTried(pending.email))) {
      return yield* again(429, Says.tooManyCodes);
    }

    const right = yield* codeMatches(
      cookieKey,
      "sign-up",
      pending.email,
      pending.tag,
      form.code
    );

    if (!right) {
      return yield* again(401, Says.codeWrong);
    }

    return yield* accounts
      .create({
        displayName: pending.displayName,
        email: pending.email,
        handle: pending.handle,
        hash: pending.hash,
      })
      .pipe(
        Effect.andThen(completed(pending.handle, pending.request)),
        Effect.catchTags({
          EmailTaken: () =>
            signInPageFor(pending.request, 409, Says.emailTaken),
          HandleTaken: () =>
            Effect.gen(function* () {
              const csrf = yield* freshCsrf;

              const sealed = yield* sealState(cookieKey, {
                csrf,
                request: pending.request,
              });

              const page = yield* signUpPageFor(
                pending.request,
                { csrf, request: sealed },
                { displayName: pending.displayName, email: pending.email },
                409,
                Says.handleTakenSince
              );

              return yield* withCsrfCookie(csrf)(page);
            }),
        })
      );
  });

// Resetting a password by a code mailed to the account's address

const PendingReset = Schema.Struct({
  csrf: Schema.String,
  email: Email,
  request: AuthRequest,
  tag: Schema.String,
});

const pendingResets = sealing("reset-code", PendingReset);

const showReset = Effect.gen(function* () {
  const { cookieKey } = yield* SignInKeys;

  const { request: sealed } = yield* HttpServerRequest.schemaSearchParams(
    Schema.Struct({ request: Schema.String })
  ).pipe(Effect.mapError(() => startAgain));

  const pending = yield* openState(cookieKey, sealed);

  const asker = yield* askerOf(pending.request);

  return htmlPage(
    resetPage(
      asker,
      { csrf: pending.csrf, request: sealed },
      authorizeHref(pending.request)
    ),
    200,
    pending.request.redirectUri
  );
});

const resetCode = (request: AuthRequest, email: Email): CodeForm => ({
  action: ACCOUNT_PATHS.resetVerify,
  intro: `If an account uses ${email}, we mailed it a code.`,
  newPassword: true,
  startOverHref: authorizeHref(request),
});

// Says the same whether or not an account has the address; only one that has gets a mail.
const reset = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const accounts = yield* Accounts;

    const attempts = yield* SignInAttempts;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(PostedEmail).pipe(
      Effect.mapError(() => startAgain)
    );

    const pending = yield* openState(cookieKey, form.request);

    yield* sameCsrf(request, form.csrf, pending.csrf);

    const again = (status: number, message: string) =>
      Effect.map(askerOf(pending.request), (asker) =>
        htmlPage(
          resetPage(
            asker,
            { csrf: form.csrf, request: form.request },
            authorizeHref(pending.request),
            form.email,
            message
          ),
          status,
          pending.request.redirectUri
        )
      );

    const email = decodeEmail(form.email.trim());

    if (Option.isNone(email)) {
      return yield* again(400, Says.emailSpelling);
    }

    const admitted = yield* Effect.all([
      attempts.admit(`reset:${addressOf(request)}`),
      mailAdmitted(email.value),
    ]);

    if (!admitted.every(Boolean)) {
      return yield* again(429, Says.tooManyMails);
    }

    const account = yield* accounts.findByEmail(email.value);

    const tag = yield* (
      Option.isSome(account) ? mailCode("reset", email.value) : deadTag
    ).pipe(Effect.option);

    if (Option.isNone(tag)) {
      return yield* again(503, Says.mailFailed);
    }

    const sealed = yield* pendingResets.seal(cookieKey, {
      csrf: form.csrf,
      email: email.value,
      request: pending.request,
      tag: tag.value,
    });

    return yield* codePageFor(
      { csrf: form.csrf, request: pending.request, sealed },
      resetCode(pending.request, email.value),
      200
    );
  });

const PostedReset = Schema.Struct({
  code: Schema.String,
  csrf: Schema.String,
  password: Schema.String,
  request: Schema.String,
});

const resetVerified = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { cookieKey, pepper } = yield* SignInKeys;

    const accounts = yield* Accounts;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(PostedReset).pipe(
      Effect.mapError(() => startAgain)
    );

    const pending = yield* pendingResets.open(cookieKey, form.request);

    yield* sameCsrf(request, form.csrf, pending.csrf);

    const again = (status: number, message: string) =>
      codePageFor(
        { csrf: form.csrf, request: pending.request, sealed: form.request },
        resetCode(pending.request, pending.email),
        status,
        message
      );

    if (!passwordFits(form.password)) {
      return yield* again(400, Says.passwordLength);
    }

    if (!(yield* codeTried(pending.email))) {
      return yield* again(429, Says.tooManyCodes);
    }

    const right = yield* codeMatches(
      cookieKey,
      "reset",
      pending.email,
      pending.tag,
      form.code
    );

    const account = right
      ? yield* accounts.findByEmail(pending.email)
      : Option.none();

    if (Option.isNone(account)) {
      return yield* again(401, Says.codeWrong);
    }

    yield* accounts.setPasswordHash(
      account.value.handle,
      yield* hashPassword(pepper, Redacted.make(form.password))
    );

    return yield* completed(account.value.handle, pending.request);
  });

const cliClient = Effect.gen(function* () {
  const { origin } = yield* Authorization;

  return HttpServerResponse.jsonUnsafe(cliClientMetadata(origin), {
    headers: { "cache-control": "public, max-age=300" },
  });
});

// The code is shown, never kept: it is worth nothing without the CLI's verifier.
const cliCode = Effect.gen(function* () {
  const { webUrl } = yield* SignInHome;

  const { code } = yield* HttpServerRequest.schemaSearchParams(
    Schema.Struct({ code: Schema.optionalKey(Schema.NonEmptyString) })
  ).pipe(Effect.orElseSucceed(() => ({ code: undefined })));

  return htmlPage(
    cliCodePage(
      code,
      Option.getOrElse(webUrl, () => "/")
    ),
    code === undefined ? 400 : 200
  );
});

const authorizationServer = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { context, server } = yield* Authorization;

    const store = yield* OAuthStore;

    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

    const response = yield* Effect.promise(() =>
      server.fetch(web, { OAUTH_KV: store }, context)
    );

    return HttpServerResponse.fromWeb(response);
  });

export const failedPage = (failed: SignInFailed) =>
  Effect.map(Effect.service(SignInHome), ({ webUrl }) =>
    failed.redirectTo === undefined
      ? htmlPage(
          problemPage(
            failed.reason,
            Option.getOrElse(webUrl, () => "/")
          ),
          400
        )
      : HttpServerResponse.redirect(failed.redirectTo, {
          headers: { "cache-control": "no-store" },
          status: 302,
        })
  );

export type SignInServices =
  | Accounts
  | HeldHandles
  | Mailer
  | OAuthStore
  | SignInAttempts
  | SignInHome
  | SignInKeys
  | SignInOffers;

export const signInRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = Context.make(Accounts, yield* Accounts).pipe(
      Context.add(HeldHandles, yield* HeldHandles),
      Context.add(Mailer, yield* Mailer),
      Context.add(OAuthStore, yield* OAuthStore),
      Context.add(SignInAttempts, yield* SignInAttempts),
      Context.add(SignInHome, yield* SignInHome),
      Context.add(SignInKeys, yield* SignInKeys),
      Context.add(SignInOffers, yield* SignInOffers)
    );

    const add = <R>(
      method: "*" | "GET" | "POST",
      path: HttpRouter.PathInput,
      handler: (
        request: HttpServerRequest.HttpServerRequest
      ) => Effect.Effect<HttpServerResponse.HttpServerResponse, SignInFailed, R>
    ) =>
      router.add(method, path, (request) =>
        handler(request).pipe(
          Effect.catchTag("SignInFailed", failedPage),
          Effect.provide(services)
        )
      );

    yield* add("GET", "/authorize", showSignIn);
    yield* add("POST", "/authorize", signIn);
    yield* add("POST", SESSION_PATHS.continue, continueAs);
    yield* add("GET", SESSION_PATHS.switch, () => switchAccount);
    yield* add("GET", SESSION_PATHS.signOut, () => signOut);
    yield* add("POST", SESSION_PATHS.signOut, () => signOut);
    yield* add("GET", "/signup", () => showSignUp);
    yield* add("POST", "/signup", signUp);
    yield* add("POST", ACCOUNT_PATHS.signUpVerify, signUpVerified);
    yield* add("POST", ACCOUNT_PATHS.addEmail, addEmail);
    yield* add("POST", ACCOUNT_PATHS.addEmailVerify, addEmailVerified);
    yield* add("GET", ACCOUNT_PATHS.reset, () => showReset);
    yield* add("POST", ACCOUNT_PATHS.reset, reset);
    yield* add("POST", ACCOUNT_PATHS.resetVerify, resetVerified);
    yield* add("GET", CLI_CLIENT_PATH, () => cliClient);
    yield* add("GET", CLI_CODE_PATH, () => cliCode);

    for (const path of AUTHORIZATION_SERVER_PATHS) {
      yield* add("*", path, authorizationServer);
    }
  })
);
