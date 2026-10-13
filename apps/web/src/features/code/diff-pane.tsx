/**
 * Until the box has stuck under the toolbar it does not scroll, so a wheel over
 * the diff moves the page and the head scrolls away first; once stuck it
 * scrolls (Pierre's `CodeView` needs a scroller of its own).
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const PANE =
  "group/pane sticky top-[5.9375rem] h-[calc(100dvh-5.9375rem)] scroll-mt-[5.9375rem] -mt-6 -mb-16 flex min-h-0 flex-col";

export const PANE_SCROLLER =
  "min-h-0 flex-1 overflow-auto overscroll-y-auto group-data-[stuck=false]/pane:overflow-y-hidden";

const pixels = (length: string) => Number(/^-?[\d.]+/u.exec(length)?.[0] ?? 0);

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

const useStuck = () => {
  const pane = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState<boolean>();

  useEffect(() => {
    const box = pane.current;

    return box === null ? undefined : followStuck(box, setStuck);
  }, []);

  return { pane, stuck };
};

export const DiffPane = ({
  children,
  id,
}: {
  readonly children: ReactNode;
  readonly id?: string;
}) => {
  const { pane, stuck } = useStuck();

  return (
    <div
      className={PANE}
      id={id}
      data-diff-pane=""
      data-files=""
      data-stuck={stuck}
      ref={pane}
    >
      {children}
    </div>
  );
};
