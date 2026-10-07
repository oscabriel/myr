import { untouchable } from "@repo/testkit/untouchable";

/** The operator's token in every fake env: long enough to decode. */
export const operatorToken = "operator-token-0123456789abcdef0123";

/** Sign-in's cookie key and pepper in every fake env (W3 316). */
export const cookieKey = "cookie-key-0123456789abcdef0123456789";

export const passwordPepper = "pepper-0123456789abcdef0123456789abcdef";

/**
 * The platform Worker's env at stage `local`, as `wrangler.jsonc` declares
 * it: every var and the required secret set, every binding a fake that
 * throws if touched, so a test proves what building the platform touches.
 * The optional secrets are absent.
 */
export const fakeEnv = (): Env => ({
  ANSWER: untouchable("ANSWER"),
  ARTIFACTS: untouchable("ARTIFACTS"),
  CLAIM_LIMIT: untouchable("CLAIM_LIMIT"),
  COOKIE_KEY: cookieKey,
  EVIDENCE: untouchable("EVIDENCE"),
  FRONT_PAGE: untouchable("FRONT_PAGE"),
  LANDER_ADAPTER: "container",
  LOADER: untouchable("LOADER"),
  OAUTH_KV: untouchable("OAUTH_KV"),
  ON_PUSH: untouchable("ON_PUSH"),
  OPERATOR_HANDLE: "oscabriel",
  OPERATOR_TOKEN: operatorToken,
  PASSWORD_PEPPER: passwordPepper,
  PROJECT: untouchable("PROJECT"),
  PROPOSAL_LIMIT: untouchable("PROPOSAL_LIMIT"),
  SANDBOX: untouchable("SANDBOX"),
  SIGN_IN_LIMIT: untouchable("SIGN_IN_LIMIT"),
  STAGE: "local",
});

/** `env` without `key`, as a Worker missing that binding, var or secret sees it. */
export const without = (env: Env, key: keyof Env): Env => {
  const rest = { ...env };

  Reflect.deleteProperty(rest, key);

  return rest;
};
