/**
 * Where a page of the Code tab is, read from its path alone, so the code bar
 * reads the same address on the server, in the browser and under any route.
 */
import { Rev } from "@repo/protocol/domain/code";
import { projectAddressOf } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { segmentsOf } from "../shared/paths.ts";

/** The Code tab's pages: Files are `tree`, `blob` and `why`; Commits are `commits` and `commit`. */
export type CodePage = "blob" | "commit" | "commits" | "refs" | "tree" | "why";

export interface CodeAddress {
  readonly page: CodePage;
  readonly rev: string;
  readonly path?: string | undefined;
}

const PAGES: readonly CodePage[] = [
  "blob",
  "commit",
  "commits",
  "refs",
  "tree",
  "why",
];

const asRev = Schema.decodeUnknownOption(Rev);

/** Each segment is decoded once, so a tag's encoded `/` stays inside its own segment. */
export const codeAddressOf = (pathname: string): Option.Option<CodeAddress> =>
  Option.flatMap(projectAddressOf(segmentsOf(pathname)), ({ rest }) => {
    const [first, second, ...more] = rest;
    const page = PAGES.find((each) => each === first);

    if (page === undefined) {
      return Option.none();
    }

    if (page === "refs") {
      return Option.some({ page, rev: "main" });
    }

    return Option.map(asRev(second), (rev) => ({
      page,
      path: more.length === 0 ? undefined : more.join("/"),
      rev,
    }));
  });

/** The pages under Files, and the rest under Commits; the refs list is neither. */
export const codeViewOf = (page: CodePage): "commits" | "files" | undefined => {
  if (page === "refs") {
    return undefined;
  }

  return page === "commit" || page === "commits" ? "commits" : "files";
};
