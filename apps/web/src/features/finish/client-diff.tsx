/**
 * The answer's diff, drawn in the browser only. `@pierre/diffs` and Shiki's
 * grammars are megabytes, and the diff needs the DOM anyway, so the server
 * renders `fallback` (the changed files by name) and the browser loads the
 * drawing after hydration. `import.meta.env.SSR` is `true` in the Worker's
 * build, so the dynamic import below is dead code there and the Worker
 * bundles none of it (`bytes:check` holds the Worker's size).
 */
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";

const PatchDiffsLater = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./patch-diff.tsx"));

export const ClientPatchDiffs = ({
  fallback,
  patch,
}: {
  readonly fallback: ReactNode;
  readonly patch: string;
}) =>
  PatchDiffsLater === undefined ? (
    fallback
  ) : (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <PatchDiffsLater patch={patch} />
      </Suspense>
    </ClientOnly>
  );
