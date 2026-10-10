/**
 * The line that installs the CLI, from a web's origin (the web forwards the
 * CLI's downloads to the platform, as `llms.txt` says). One string, so every
 * page and document that gives it gives the same one.
 */
export const installCommand = (webUrl: string) =>
  `curl -fsSL ${webUrl}/install.sh | sh`;
