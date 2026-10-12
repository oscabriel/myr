/**
 * The drawing takes the fallback's place only once its code is highlighted, so
 * code the server highlighted never visibly changes (no `ClientOnly`, whose
 * switch would mount a second copy of the fallback). `import.meta.env.SSR` is
 * `true` in the Worker's build, so the dynamic imports below are dead code
 * there and the Worker bundles none of the drawings.
 */
import { Effect, Fiber } from "effect";
import { Suspense, useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import type { FileCodeProps } from "./code-view.tsx";
import type { DiffCodeProps } from "./diff-view.tsx";

const fileDrawing = import.meta.env.SSR
  ? undefined
  : (file: FileCodeProps) =>
      Effect.gen(function* () {
        const { FileCode, prepareFile } = yield* Effect.tryPromise(
          () => import("./code-view.tsx")
        );

        yield* prepareFile(file);

        return FileCode;
      });

const diffDrawing = import.meta.env.SSR
  ? undefined
  : (files: Pick<DiffCodeProps, "drawn" | "files">) =>
      Effect.gen(function* () {
        const { DiffCode, prepareDiffs } = yield* Effect.tryPromise(
          () => import("./diff-view.tsx")
        );

        yield* prepareDiffs(files);

        return DiffCode;
      });

/**
 * A drawing, held in state: a component is a function, which state would call.
 */
interface Ready<P> {
  readonly Draw: ComponentType<P>;
}

const start = <P, E>(
  ready: Effect.Effect<ComponentType<P>, E>,
  done: (ready: Ready<P>) => void
) => {
  const fiber = Effect.runFork(
    ready.pipe(
      Effect.andThen((Draw) =>
        Effect.sync(() => {
          done({ Draw });
        })
      ),
      Effect.ignore
    )
  );

  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
};

export const ClientFile = ({
  fallback,
  ...props
}: FileCodeProps & { readonly fallback: ReactNode }) => {
  const { path, sha, text } = props;
  const [ready, setReady] = useState<Ready<FileCodeProps>>();

  useEffect(
    () =>
      fileDrawing === undefined
        ? undefined
        : start(fileDrawing({ path, sha, text }), setReady),
    [path, sha, text]
  );

  return ready === undefined ? (
    fallback
  ) : (
    <Suspense fallback={fallback}>
      <ready.Draw {...props} />
    </Suspense>
  );
};

export const ClientDiffs = ({
  fallback,
  ...props
}: DiffCodeProps & { readonly fallback: ReactNode }) => {
  // The drawing, once ready, follows any change itself, so preparing is done
  // once.
  const first = useRef({ drawn: props.drawn, files: props.files });
  const [ready, setReady] = useState<Ready<DiffCodeProps>>();

  useEffect(
    () =>
      diffDrawing === undefined
        ? undefined
        : start(diffDrawing(first.current), setReady),
    []
  );

  return ready === undefined ? (
    fallback
  ) : (
    <Suspense fallback={fallback}>
      <ready.Draw {...props} />
    </Suspense>
  );
};
