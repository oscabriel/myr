import { Brand } from "./index.ts";

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface BrandLeak {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

const HOME = "packages/brand/";

// Prose names the product; code takes it from this package. A licence file
// sits beside the code it covers (`LICENSE`, `LICENSE-<font>.txt`).
const PROSE = /(?:^|\/)(?:LICENSE[^/]*|[^/]+\.md)$/u;

// An example project's config folder is named after the brand, and its files
// import the SDK by its published name: `examples/<name>/<config dir>/…`, and
// a layer's the same at its repo's root, `examples/<name>/layers/<layer>/
// <config dir>/…`. The example's own code is not exempt.
const inExampleConfig = (path: string) => {
  const [root, , dir, , layerDir] = path.split("/");

  return (
    root === "examples" &&
    (dir === Brand.configDir ||
      (dir === "layers" && layerDir === Brand.configDir))
  );
};

// Letters on either side make it another word ("myriad"), not the name.
const NAME = new RegExp(`(?<![a-z])${Brand.slug}(?![a-z])`, "iu");

const mayNameTheBrand = (path: string) =>
  path.startsWith(HOME) || PROSE.test(path) || inExampleConfig(path);

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

export const findLeaks = (files: Iterable<SourceFile>): readonly BrandLeak[] =>
  [...files].flatMap(leaksIn);
