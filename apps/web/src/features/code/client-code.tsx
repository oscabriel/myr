/**
 * A file and a commit's diff, drawn in the browser over what the server
 * sent. The server renders `fallback`: the code it highlighted
 * (`ServerCode`), or numbered lines or the plain-text diff for code it
 * does not highlight. After hydration the browser loads the drawing,
 * starts the worker pool and highlights the code there first
 * (`prepareFile`, `prepareDiffs`); only then does the drawing take the
 * fallback's place, in one render, drawing the highlighted code at once.
 * So code the server highlighted never visibly changes, and plain code
 * changes once, to highlighted.
 *
 * The fallback stays where it is until then (no `ClientOnly`, whose
 * switch would mount a second copy of it without the server's drawing).
 * `import.meta.env.SSR` is `true` in the Worker's build, so the dynamic
 * imports below are dead code there and the Worker bundles none of the
 * drawings (`bytes:check`), as `features/finish/client-diff.tsx` does.
 */
import { Effect, Fiber } from "effect";
import { Suspense, useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";

// Type-only imports are erased, so the server bundles nothing of these.
import type { FileCodeProps } from "./code-view.tsx";
import type { DiffCodeProps } from "./diff-view.tsx";

/** The file's drawing, once its module is loaded and the file highlighted in the pool; none on the server. */
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

/** The diff's drawing, once its module is loaded and its first files highlighted; none on the server. */
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

/** A drawing, held in state: a component is a function, which state would call. */
interface Ready<P> {
  readonly Draw: ComponentType<P>;
}

/**
 * Runs `ready` (load the drawing, prepare what it draws) and hands its
 * drawing to `done`; the returned function stops it, so a page left in
 * the meantime is not drawn. A drawing that cannot load leaves the
 * fallback in place.
 */
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
  // The files as they first came: the drawing, once ready, follows any
  // change itself, so preparing is done once.
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
