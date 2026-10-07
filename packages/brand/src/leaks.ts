import { Brand } from "./index.ts";

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface BrandLeak {
  readonly path: string;
  /** 1-based; 0 when the path itself carries the name. */
  readonly line: number;
  readonly text: string;
}

const HOME = "packages/brand/";

// Prose names the product; code takes it from this package.
const PROSE = /^LICENSES\/|(?:^|\/)(?:LICENSE[^/]*|[^/]+\.md)$/u;

// `bun run gen` writes these from the brand, so they spell the name.
const GENERATED = ["docs/reference/", "plugins/", "skills/"] as const;

// An example project's config folder is named after the brand, and its files
// import the SDK by its published name: `examples/<name>/<config dir>/…`. The
// example's own code is not exempt.
const inExampleConfig = (path: string) => {
  const [root, , dir] = path.split("/");

  return root === "examples" && dir === Brand.configDir;
};

// Letters on either side make it another word ("myriad"), not the name.
const NAME = new RegExp(`(?<![a-z])${Brand.slug}(?![a-z])`, "iu");

const mayNameTheBrand = (path: string) =>
  path.startsWith(HOME) ||
  PROSE.test(path) ||
  GENERATED.some((root) => path.startsWith(root)) ||
  inExampleConfig(path);

const leaksIn = (file: SourceFile): readonly BrandLeak[] => {
  if (mayNameTheBrand(file.path)) {
    return [];
  }

  const inPath: readonly BrandLeak[] = NAME.test(file.path)
    ? [{ line: 0, path: file.path, text: file.path }]
    : [];

  if (file.content.includes("\u0000")) {
    return inPath;
  }

  const inContent = file.content
    .split("\n")
    .flatMap((text, index) =>
      NAME.test(text)
        ? [{ line: index + 1, path: file.path, text: text.trim() }]
        : []
    );

  return [...inPath, ...inContent];
};

/** Every place outside the brand package and prose that spells the name. */
export const findLeaks = (files: Iterable<SourceFile>): readonly BrandLeak[] =>
  [...files].flatMap(leaksIn);
