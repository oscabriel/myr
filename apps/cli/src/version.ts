/**
 * The CLI's version, as its build stamped it: what `--version` prints and
 * what the stdio MCP server says it is.
 *
 * `build.ts` stamps it with a define (`versionDefine`) that both bundlers
 * apply: tsdown for the npm build, `bun build --compile` for each binary.
 * Each replaces `import.meta.env.CLI_BUILD_VERSION` with the version as a
 * string literal at build time. The form is chosen because both bundlers
 * replace it, it needs no `typeof` guard on an undeclared global and no
 * `process.env` read, and a run no build stamped (vitest, `bun
 * src/bin.ts`) leaves it undefined, so it reads as `0.0.0`, the release's
 * own word for unreleased (`scripts/lib/release.ts`' `UNRELEASED`). Bun
 * reads `import.meta.env` from the process env, so an unbuilt run under
 * Bun with `CLI_BUILD_VERSION` set reports that instead; a built one never
 * looks.
 */

declare global {
  interface ImportMeta {
    /** What a bundler's define replaces; unbuilt, Vite's or Bun's env. */
    readonly env: { readonly CLI_BUILD_VERSION?: string };
  }
}

/** The CLI's version as its build stamped it; `0.0.0` in a run no build stamped. */
export const cliVersion: string = import.meta.env.CLI_BUILD_VERSION ?? "0.0.0";
