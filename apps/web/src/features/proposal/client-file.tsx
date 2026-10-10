/**
 * A drafted file (the ask file or its check), drawn in the browser only.
 * The server renders the file's path as a heading and its text in a
 * `<pre>`; after hydration the browser loads `@pierre/diffs` and draws it
 * highlighted. `import.meta.env.SSR` is `true` in the Worker's build, so the
 * dynamic import below is dead code there and the Worker bundles none of it
 * (`bytes:check`), as `features/code/client-code.tsx` does.
 */
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// A type-only import is erased, so the server bundles nothing of it.
import type { DraftedFileProps } from "./drafted-file.tsx";

const DraftedFileLater = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./drafted-file.tsx"));

/** The file's text as the server and a reader without JavaScript see it. */
const Plain = ({ content }: { readonly content: string }) => (
  <pre className="border-rule bg-surface text-mono leading-code overflow-x-auto border px-3 py-2 font-mono">
    {content}
  </pre>
);

/** One drafted file under its path: a heading, then the code. */
export const DraftedCode = ({
  content,
  heading: Heading = "h3",
  path,
}: DraftedFileProps & {
  /** The heading level the path takes in its page. */
  readonly heading?: "h3" | "h4";
}) => {
  const fallback = <Plain content={content} />;

  return (
    <section className="flex min-w-0 flex-col gap-1.5" data-file={path}>
      <Heading className="font-mono text-sm font-medium [overflow-wrap:anywhere]">
        {path}
      </Heading>
      {DraftedFileLater === undefined ? (
        fallback
      ) : (
        <ClientOnly fallback={fallback}>
          <Suspense fallback={fallback}>
            <DraftedFileLater content={content} path={path} />
          </Suspense>
        </ClientOnly>
      )}
    </section>
  );
};
