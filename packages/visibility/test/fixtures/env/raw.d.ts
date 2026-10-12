declare module "*?raw" {
  const text: string;
  export default text;
}

interface ImportMeta {
  /** The text of every file the patterns match, by path; `exhaustive` also searches `node_modules`. */
  readonly glob: (
    patterns: readonly string[],
    options: {
      readonly eager: true;
      readonly exhaustive?: true;
      readonly import: "default";
      readonly query: "?raw";
    }
  ) => Readonly<Record<string, string>>;
}
