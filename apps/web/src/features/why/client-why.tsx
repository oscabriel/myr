/**
 * The "why" drawing, in the browser only: `@pierre/diffs` and Shiki's
 * grammars are megabytes and the drawing needs the DOM, so the server
 * renders `fallback` (the table of ranges beside the numbered lines) and
 * the browser loads the drawing after hydration. `import.meta.env.SSR` is
 * `true` in the Worker's build, so the dynamic import below is dead code
 * there and the Worker bundles none of it (`bytes:check`), as
 * `features/code/client-code.tsx` does.
 */
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";

// A type-only import is erased, so the server bundles nothing of it.
import type { WhyCodeProps } from "./why-code.tsx";

const WhyLater = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./why-code.tsx"));

export const ClientWhy = ({
  fallback,
  ...props
}: WhyCodeProps & { readonly fallback: ReactNode }) =>
  WhyLater === undefined ? (
    fallback
  ) : (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <WhyLater {...props} />
      </Suspense>
    </ClientOnly>
  );
