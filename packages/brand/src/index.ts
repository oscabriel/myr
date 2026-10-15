const slug = "myr";

const domain = `${slug}.technology`;

// The platform's own host on prod: where the CLI signs in and reads when
// nothing names another platform.
const platformHost = `git.${domain}`;

// npm's `@myr` is another account's, so the package's scope spells the domain.
const npmScope = `@${slug}technology`;

const cliPackage = `${npmScope}/cli`;

export const Brand = {
  cli: slug,
  cliPackage,
  configDir: `.${slug}`,
  domain,
  gitCredentialHelper: `git-credential-${slug}`,
  gitRemoteHelper: `git-remote-${slug}`,
  githubOrg: `get${slug}`,
  name: "Myr",
  npmScope,
  platformHost,
  platformUrl: `https://${platformHost}`,
  refsPrefix: `refs/${slug}/`,
  // Each name a config folder imports the sdk by: the package's own, then
  // the one it had before its scope moved, which projects made then keep.
  sdkImports: [`${cliPackage}/rules`, `@${slug}/cli/rules`],
  slug,
  urlScheme: `${slug}://`,
} as const;
