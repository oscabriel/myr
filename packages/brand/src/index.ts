const slug = "myr";

const domain = `${slug}.technology`;

// The platform's own host on prod: where the CLI signs in and reads when
// nothing names another platform.
const platformHost = `git.${domain}`;

export const Brand = {
  cli: slug,
  cliPackage: `@${slug}/cli`,
  configDir: `.${slug}`,
  domain,
  gitCredentialHelper: `git-credential-${slug}`,
  gitRemoteHelper: `git-remote-${slug}`,
  githubOrg: `get${slug}`,
  name: "Myr",
  npmScope: `@${slug}`,
  platformHost,
  platformUrl: `https://${platformHost}`,
  refsPrefix: `refs/${slug}/`,
  slug,
  urlScheme: `${slug}://`,
} as const;
