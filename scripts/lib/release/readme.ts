/**
 * The npm package's own README: how to install the CLI, start
 * it and use its sdk, every name from `Brand`. The repo's README is about
 * the platform; this one is what npm and pi show for the package.
 */
import type { Brand } from "@repo/brand";

const fence = (lines: readonly string[]) => ["```sh", ...lines, "```"];

/** The package's README for `version`. */
export const packageReadme = (input: {
  readonly brand: typeof Brand;
  readonly version: string;
}): string => {
  const { brand } = input;

  return [
    `# ${brand.cliPackage}`,
    "",
    `The ${brand.name} command line, ${input.version}. ${brand.name} is a git platform where a change lands only by passing a typed gate: a project states each change it wants as an ask, and you answer one with a commit pushed to your claim's fork.`,
    "",
    "## Install",
    "",
    "With Node or Bun:",
    "",
    ...fence([`npm install --global ${brand.cliPackage}`]),
    "",
    `Or as one file that needs neither, from the platform you use (Linux x64 and macOS on Apple silicon; the script checks the download against the release's SHA256SUMS):`,
    "",
    ...fence(["curl -fsSL <platform>/install.sh | sh"]),
    "",
    `Either way you get \`${brand.cli}\`, and \`${brand.gitCredentialHelper}\`, the credential helper git calls for the platform.`,
    "",
    "## Start",
    "",
    ...fence([
      `${brand.cli} login --url <platform>`,
      `${brand.cli} asks          # list the open asks you could take`,
      `${brand.cli} claim <ask>   # take one; you get a fork to push your answer to`,
      `${brand.cli} check         # run the gate's checks locally before you push`,
    ]),
    "",
    `\`${brand.cli} --help\` lists every command; \`${brand.cli} mcp\` serves them as MCP tools over stdio.`,
    "",
    "## pi",
    "",
    `The package is a pi package: \`pi install npm:${brand.cliPackage}\` gives every pi session the brief of the claim it works on, a guard on the files the gate judges with, and the verdict before it stops. The platform's skill ships in \`skills/${brand.slug}/\`.`,
    "",
    "## A project's config folder",
    "",
    `A maintainer's \`${brand.configDir}/\` imports the sdk from \`${brand.cliPackage}/rules\`, and the types of its data from \`${brand.cliPackage}/protocol\`:`,
    "",
    "```ts",
    `import { project } from "${brand.cliPackage}/rules";`,
    "```",
    "",
    "## Licence",
    "",
    "MIT",
    "",
  ].join("\n");
};
