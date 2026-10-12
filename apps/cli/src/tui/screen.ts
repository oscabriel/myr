// Loaded only when `--tui` opens Today, since importing OpenTUI loads its native library.
import { createCliRenderer } from "@opentui/core";
import type { CliRenderer, KeyEvent } from "@opentui/core";
import { createElement, createRoot, flushSync } from "@opentui/react";
import { Effect, Queue } from "effect";
import type { Scope } from "effect";

import { causeText, TuiRefused } from "./run.ts";
import type { Screen } from "./run.ts";
import { TodayView } from "./view.ts";

const keyName = (key: KeyEvent) => (key.ctrl ? `ctrl+${key.name}` : key.name);

/** OpenTUI's root draws one element, so the last one is unmounted first. */
export const screenOn = (
  renderer: CliRenderer
): Effect.Effect<Screen, never, Scope.Scope> =>
  Effect.gen(function* () {
    const keys = yield* Queue.unbounded<string>();
    const root = createRoot(renderer);

    const onKey = (key: KeyEvent) => {
      Queue.offerUnsafe(keys, keyName(key));
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => renderer.keyInput.on("keypress", onKey)),
      () =>
        Effect.sync(() => {
          renderer.keyInput.off("keypress", onKey);
          root.unmount();
        })
    );

    return {
      forget: Effect.asVoid(Queue.clear(keys)),
      key: Queue.take(keys),
      show: (state) =>
        Effect.sync(() => {
          flushSync(() => {
            root.unmount();
            root.render(createElement(TodayView, { state }));
          });
        }),
    } satisfies Screen;
  });

/** Ctrl+C is a key here, which closes Today like `q`. */
export const openTerminal: Effect.Effect<Screen, TuiRefused, Scope.Scope> =
  Effect.acquireRelease(
    Effect.tryPromise({
      catch: (cause) =>
        new TuiRefused({
          reason: `the terminal would not open (${causeText(cause)})`,
        }),
      try: () =>
        createCliRenderer({
          exitOnCtrlC: false,
          screenMode: "alternate-screen",
          useMouse: false,
        }),
    }),
    (renderer) =>
      Effect.sync(() => {
        renderer.destroy();
      })
  ).pipe(Effect.flatMap(screenOn));
