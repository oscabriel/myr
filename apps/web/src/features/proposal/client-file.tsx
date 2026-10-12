/**
 * `import.meta.env.SSR` is `true` in the Worker's build, so the dynamic import
 * below is dead code there and the Worker bundles none of it.
 */
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import type { DraftedFileProps } from "./drafted-file.tsx";

const DraftedFileLater = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./drafted-file.tsx"));

const Plain = ({ content }: { readonly content: string }) => (
  <pre className="border-rule bg-surface text-mono leading-code overflow-x-auto border px-3 py-2 font-mono">
    {content}
  </pre>
);

export const DraftedCode = ({
  content,
  heading: Heading = "h3",
  path,
}: DraftedFileProps & {
  readonly heading?: "h3" | "h4";
}) => {
  const fallback = <Plain content={content} />;

  return (
    <section className="flex min-w-0 flex-col gap-1.5" data-file={path}>
      <Heading className="text-mono font-mono font-medium [overflow-wrap:anywhere]">
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
