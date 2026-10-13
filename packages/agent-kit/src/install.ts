import { Brand } from "@repo/brand";

export const installCommand = (webUrl: string) =>
  `curl -fsSL ${webUrl}/install.sh | sh`;

/** How an answer reaches its fork: the remote the claim's step names, then `main`. */
export const pushCommand = `git push ${Brand.slug} HEAD:main`;
