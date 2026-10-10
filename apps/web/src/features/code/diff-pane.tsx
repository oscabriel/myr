/**
 * Where a commit's diff scrolls: a box the height of the screen below the
 * bars, which sticks under the toolbar once the page head has scrolled
 * away. The diff scrolls inside it (Pierre's `CodeView` needs a scroller
 * of its own to draw only what is in view), and its file headers stick at
 * its top.
 *
 * Until the box has reached the toolbar, the box does not scroll: a wheel
 * or a swipe over the diff moves the page instead, so the head scrolls
 * away first and nothing traps the reader. Once stuck, it scrolls; at its
 * top a further scroll up moves the page back. Without script it always
 * scrolls.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** The box's place: under the toolbar, as tall as the screen below it (and above a phone's bottom bar). */
const PANE =
  "group/pane sticky top-[5.1875rem] h-[calc(100dvh-5.1875rem-3.5rem-env(safe-area-inset-bottom))] scroll-mt-[5.1875rem] tablet:top-[5.4375rem] tablet:h-[calc(100dvh-5.4375rem)] tablet:scroll-mt-[5.4375rem] shell:top-[5.1875rem] shell:h-[calc(100dvh-5.1875rem)] shell:scroll-mt-[5.1875rem] -mt-6 -mb-16 flex min-h-0 flex-col";

/** What a scroller inside the box puts on itself: all the box's height, scrolling only once the box is stuck. */
export const PANE_SCROLLER =
  "min-h-0 flex-1 overflow-auto overscroll-y-auto group-data-[stuck=false]/pane:overflow-y-hidden";

/** Pixels from a computed length (`83px`); nothing, none. */
const pixels = (length: string) => Number(/^-?[\d.]+/u.exec(length)?.[0] ?? 0);

/**
 * Follow whether `box` has reached its sticky place, read on every scroll
 * (of main, or of the page below the shell's width), telling `stuck`; the
 * returned function stops.
 */
const followStuck = (box: HTMLElement, stuck: (now: boolean) => void) => {
  let frame = 0;

  const read = () => {
    frame = 0;
    stuck(
      box.getBoundingClientRect().top <=
        pixels(globalThis.getComputedStyle(box).top) + 1
    );
  };

  const onScroll = () => {
    if (frame === 0) {
      frame = globalThis.requestAnimationFrame(read);
    }
  };

  read();
  document.addEventListener("scroll", onScroll, {
    capture: true,
    passive: true,
  });
  globalThis.addEventListener("resize", onScroll, { passive: true });

  return () => {
    globalThis.cancelAnimationFrame(frame);
    document.removeEventListener("scroll", onScroll, { capture: true });
    globalThis.removeEventListener("resize", onScroll);
  };
};

/** Whether the box has reached its sticky place; none before the page runs. */
const useStuck = () => {
  const pane = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState<boolean>();

  useEffect(() => {
    const box = pane.current;

    return box === null ? undefined : followStuck(box, setStuck);
  }, []);

  return { pane, stuck };
};

export const DiffPane = ({ children }: { readonly children: ReactNode }) => {
  const { pane, stuck } = useStuck();

  return (
    <div
      className={PANE}
      data-diff-pane=""
      data-files=""
      data-stuck={stuck}
      ref={pane}
    >
      {children}
    </div>
  );
};
