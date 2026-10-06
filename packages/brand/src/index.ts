/**
 * The product's name and every identifier made from it. Nothing outside this
 * package spells the name; `brand:check` holds that, and the acceptance script
 * renames the slug at random to prove it.
 */
const slug = "myr";

export const Brand = {
  cli: slug,
  cliPackage: `@${slug}/cli`,
  configDir: `.${slug}`,
  domain: `${slug}.technology`,
  gitCredentialHelper: `git-credential-${slug}`,
  gitRemoteHelper: `git-remote-${slug}`,
  githubOrg: `get${slug}`,
  name: "Myr",
  npmScope: `@${slug}`,
  refsPrefix: `refs/${slug}/`,
  slug,
  urlScheme: `${slug}://`,
} as const;
