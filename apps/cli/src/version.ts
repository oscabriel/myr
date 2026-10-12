// Both bundlers (tsdown, `bun build --compile`) replace `import.meta.env.CLI_BUILD_VERSION`; an unbuilt run reads `0.0.0`.
// Bun reads `import.meta.env` from the process env, so an unbuilt Bun run with it set reports that instead.

declare global {
  interface ImportMeta {
    readonly env: { readonly CLI_BUILD_VERSION?: string };
  }
}

export const cliVersion: string = import.meta.env.CLI_BUILD_VERSION ?? "0.0.0";
