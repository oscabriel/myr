import { Brand } from "@repo/brand";

export const installCommand = (webUrl: string) =>
  `curl -fsSL ${webUrl}/install.sh | sh`;

/** Signing in: bare on the platform itself, which `login` defaults to; `--url` only for another. */
export const loginCommand = (platformUrl: string) =>
  platformUrl.replace(/\/+$/u, "") === Brand.platformUrl
    ? `${Brand.cli} login`
    : `${Brand.cli} login --url ${platformUrl}`;

/** How an answer reaches its fork: the remote the claim's step names, then `main`. */
export const pushCommand = `git push ${Brand.slug} HEAD:main`;
