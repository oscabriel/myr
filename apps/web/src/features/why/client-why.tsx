/**
 * `import.meta.env.SSR` is `true` in the Worker's build, so the dynamic import
 * below is dead code there and the Worker bundles none of it.
 */
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";

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
