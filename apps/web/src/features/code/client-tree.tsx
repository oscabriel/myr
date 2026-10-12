import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";

import type { RepoTreeProps } from "./repo-tree.tsx";

const TreeLater = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./repo-tree.tsx"));

export const ClientTree = ({
  fallback = null,
  ...props
}: RepoTreeProps & { readonly fallback?: ReactNode }) =>
  TreeLater === undefined ? (
    fallback
  ) : (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <TreeLater {...props} />
      </Suspense>
    </ClientOnly>
  );
