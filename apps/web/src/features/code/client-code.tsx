/**
 * A file and a commit's diff, drawn in the browser only. `@pierre/diffs`
 * and Shiki's grammars are megabytes, and the drawing needs the DOM, so the
 * server renders `fallback` (numbered lines, or the changed files by name)
 * and the browser loads the drawing after hydration. `import.meta.env.SSR`
 * is `true` in the Worker's build, so the dynamic imports below are dead
 * code there and the Worker bundles none of it (`bytes:check`), as
 * `features/finish/client-diff.tsx` does.
 */
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";

// Type-only imports are erased, so the server bundles nothing of these.
import type { FileCodeProps } from "./code-view.tsx";
import type { DiffCodeProps } from "./diff-view.tsx";

const FileLater = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./code-view.tsx"));

const DiffLater = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./diff-view.tsx"));

export const ClientFile = ({
  fallback,
  ...props
}: FileCodeProps & { readonly fallback: ReactNode }) =>
  FileLater === undefined ? (
    fallback
  ) : (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <FileLater {...props} />
      </Suspense>
    </ClientOnly>
  );

export const ClientDiffs = ({
  fallback,
  ...props
}: DiffCodeProps & { readonly fallback: ReactNode }) =>
  DiffLater === undefined ? (
    fallback
  ) : (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <DiffLater {...props} />
      </Suspense>
    </ClientOnly>
  );
