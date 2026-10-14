/**
 * The landing's hero: the platform as a cylinder music box that only its own
 * press can pin. The server draws the still picture (round 1 refused in its
 * tray, round 2 landed); in the browser one loop plays the story through
 * `poseAt`, writing transforms and paths on the parts it names, and never
 * re-renders. It stops off screen, and under reduced motion it moves only
 * when a key or a click asks it to, straight to the next moment.
 */
import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

import { Art } from "./art.tsx";
import { repaint } from "./draw.tsx";
import {
  drumPins,
  liveFrame,
  rulesPins,
  tapeEntries,
  toothState,
} from "./frame.ts";
import { BEATS, CYCLE, REST, poseAt } from "./model.ts";
import type { Pose } from "./model.ts";
import {
  armBack,
  armFront,
  armStrip,
  crank,
  governorFan,
  ratchetTeeth,
} from "./parts.ts";
import { FIGURE, KEYS } from "./words.ts";

const REST_POSE = poseAt(REST);

/** How long after the reader's last key or click the tour plays on by itself. */
const QUIET = 3.6;

interface Parts {
  readonly svg: SVGSVGElement;
  readonly one: (name: string) => SVGGElement | null;
  readonly teeth: readonly SVGGElement[];
  readonly flags: readonly SVGGElement[];
  readonly trayLayer: SVGGElement | null;
  readonly readout: HTMLElement | null;
}

const set = (
  element: Element | null,
  name: string,
  value: string | undefined
) => {
  if (element === null) {
    return;
  }

  if (value === undefined) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }

    return;
  }

  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
};

const paths = (group: Element | null, ds: readonly string[]) => {
  for (const [index, path] of [
    ...(group?.querySelectorAll("path") ?? []),
  ].entries()) {
    set(path, "d", ds[index] ?? "");
  }
};

/** Writes one pose onto the drawing. */
const paint = (parts: Parts, pose: Pose, last: Pose | undefined) => {
  const frame = liveFrame(pose);
  const pins = drumPins(pose);

  paths(parts.one("pins"), pins.tune);
  set(parts.one("sour"), "d", pins.ask);
  set(parts.one("fixed"), "d", pins.fixed);
  set(
    parts.one("fixed"),
    "data-state",
    pose.fresh > 0.4 ? "landed" : undefined
  );
  paths(parts.one("rules"), rulesPins(pose.drum));
  repaint(parts.one("fan"), governorFan(frame.fan));
  repaint(parts.one("crank"), crank(pose.drum));
  set(parts.one("ratchet"), "d", ratchetTeeth(frame.ratchet));

  for (const [index, tooth] of parts.teeth.entries()) {
    set(tooth, "transform", frame.teeth[index]);
    set(tooth, "data-state", toothState(pose, index));
  }

  for (const [index, flag] of parts.flags.entries()) {
    set(flag, "data-state", pose.flags[index]);
  }

  set(parts.one("claim"), "transform", frame.claim);
  set(parts.one("claim"), "opacity", frame.claimOpacity.toFixed(3));
  set(parts.one("flag"), "transform", frame.flag);
  set(parts.one("carriage"), "transform", frame.carriage);
  set(parts.one("strip"), "opacity", pose.round === 2 ? "1" : "0");

  const stray = parts.one("stray");

  if (stray !== null) {
    const inTray = pose.drop > 0;

    if (inTray !== (stray.parentElement === parts.trayLayer)) {
      const home = inTray ? parts.trayLayer : parts.one("carriage-slot");

      // oxlint-disable-next-line unicorn/prefer-dom-node-append -- the Worker's types merge HTMLRewriter's Element into the DOM's, so `append` there takes only text, streams and responses
      home?.appendChild(stray);
    }

    set(stray, "transform", frame.stray);
    set(stray, "opacity", frame.strayOpacity.toFixed(3));
  }

  set(parts.one("template"), "transform", frame.template);
  set(parts.one("feeler"), "transform", frame.feeler);
  set(parts.one("test-comb"), "transform", frame.testComb);
  set(parts.one("bell"), "transform", frame.bell);
  set(parts.one("bell"), "data-state", pose.bell > 0.05 ? "sealed" : undefined);
  set(parts.one("slip"), "transform", frame.slip);
  set(parts.one("slip"), "opacity", pose.slip.toFixed(3));

  if (last?.arm !== pose.arm) {
    repaint(parts.one("arm-back"), armBack(pose.arm));
    repaint(parts.one("arm-strip"), armStrip(pose.arm));
    repaint(parts.one("arm-front"), armFront(pose.arm));
  }

  set(parts.one("arm-strip"), "opacity", pose.holding ? "1" : "0");
  set(parts.one("entries"), "d", tapeEntries(pose));

  if (parts.readout !== null && parts.readout.textContent !== pose.readout) {
    parts.readout.textContent = pose.readout;
  }
};

const partsOf = (stage: HTMLElement, svg: SVGSVGElement): Parts => ({
  flags: [...svg.querySelectorAll<SVGGElement>("[data-flag]")],
  one: (name) => svg.querySelector<SVGGElement>(`[data-part="${name}"]`),
  readout:
    stage.closest("figure")?.querySelector<HTMLElement>("[data-readout]") ??
    null,
  svg,
  teeth: [...svg.querySelectorAll<SVGGElement>('[data-part="tooth"]')],
  trayLayer: svg.querySelector<SVGGElement>('[data-part="tray-layer"]'),
});

/** The next moment worth stopping at, after `time`, or the one before it. */
const beatFrom = (time: number, step: 1 | -1) => {
  const start = Math.floor(time / CYCLE) * CYCLE;

  const all = [-1, 0, 1].flatMap((cycle) =>
    BEATS.map((beat) => start + cycle * CYCLE + beat)
  );

  return step === 1
    ? (all.find((beat) => beat > time + 0.05) ?? time)
    : (all.findLast((beat) => beat < time - 0.05) ?? time);
};

interface Clock {
  time: number;
  target: number;
  touring: boolean;
  quiet: number;
}

type Step = 1 | -1 | "first" | "rest";

/** Arrows step between moments; Space and Enter press the button, which steps forward. */
const KEY_STEPS = new Map<string, Step>([
  ["ArrowDown", 1],
  ["ArrowLeft", -1],
  ["ArrowRight", 1],
  ["ArrowUp", -1],
  ["End", "rest"],
  ["Home", "first"],
]);

/** Starts the loop on the drawing, and returns what stops it. */
const start = (
  element: HTMLElement,
  svg: SVGSVGElement,
  clock: Clock,
  kick: { current: (() => void) | null }
) => {
  const parts = partsOf(element, svg);
  const still = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let previous = 0;
  let visible = false;
  let last: Pose | undefined;

  const tick = (now: number) => {
    const dt =
      previous === 0 ? 1 / 60 : Math.min((now - previous) / 1000, 1 / 30);

    const calm = still.matches;

    previous = now;
    clock.quiet += dt;

    if (!clock.touring && !calm && clock.quiet > QUIET) {
      clock.touring = true;
    }

    if (clock.touring && !calm) {
      clock.time += dt;
      clock.target = clock.time;
    } else {
      clock.time = calm
        ? clock.target
        : clock.time + (clock.target - clock.time) * (1 - Math.exp(-dt / 0.3));
    }

    const pose = poseAt(clock.time);

    paint(parts, pose, last);
    last = pose;

    const settled = calm && Math.abs(clock.target - clock.time) < 1e-3;

    frame = visible && !settled ? globalThis.requestAnimationFrame(tick) : 0;
  };

  const run = () => {
    if (frame === 0 && visible) {
      previous = 0;
      frame = globalThis.requestAnimationFrame(tick);
    }
  };

  kick.current = run;
  clock.touring = !still.matches;

  const watcher = new IntersectionObserver(
    (entries) => {
      visible = entries.at(-1)?.isIntersecting ?? false;

      if (visible) {
        run();
      }
    },
    { rootMargin: "120px 0px" }
  );

  watcher.observe(element);

  return () => {
    watcher.disconnect();
    globalThis.cancelAnimationFrame(frame);
  };
};

const useMusicBox = () => {
  const stage = useRef<HTMLButtonElement>(null);
  const phase = useRef<HTMLSpanElement>(null);

  const clock = useRef<Clock>({
    quiet: 0,
    target: REST,
    time: REST,
    touring: true,
  });

  const kick = useRef<(() => void) | null>(null);

  useEffect(() => {
    const element = stage.current;
    const svg = element?.querySelector("svg") ?? null;

    return element === null || svg === null
      ? undefined
      : start(element, svg, clock.current, kick);
  }, []);

  const step = (direction: Step) => {
    const state = clock.current;
    const cycle = Math.floor(state.time / CYCLE) * CYCLE;

    state.touring = false;
    state.quiet = 0;

    if (direction === "first") {
      state.target = cycle + (BEATS[0] ?? 0);
    } else if (direction === "rest") {
      state.target = cycle + REST;
    } else {
      state.target = beatFrom(state.target, direction);
    }

    if (phase.current !== null) {
      phase.current.textContent = poseAt(state.target).phase;
    }

    kick.current?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = KEY_STEPS.get(event.key);

    if (direction !== undefined) {
      event.preventDefault();
      step(direction);
    }
  };

  return {
    onClick: () => {
      step(1);
    },
    onKeyDown,
    phase,
    stage,
  };
};

const Swatch = ({ mark }: { readonly mark: string }) => (
  <svg
    aria-hidden="true"
    className="mbx-swatch"
    data-mark={mark}
    viewBox="0 0 16 10"
  >
    <path d="M2 4.5 8 1.5 14 4.5 14 6 8 9 2 6Z" />
    <path className="mbx-swatch-crease" d="M2 4.5 8 7.5 14 4.5" />
  </svg>
);

/** Fig 1: the music box, its card, its live readout and the legend under it. */
export const MusicBox = () => {
  const { onClick, onKeyDown, phase, stage } = useMusicBox();

  return (
    <figure className="mbx flex flex-col gap-3" data-figure="music-box">
      <div className="bg-card border-rule tablet:px-6 relative overflow-hidden rounded-md border px-3 pt-12 pb-14">
        <div
          aria-hidden="true"
          className="text-label text-muted-foreground tablet:inset-x-5 pointer-events-none absolute inset-x-4 top-4 flex justify-between gap-4"
        >
          <span className="text-foreground">{FIGURE.fig}</span>
          <span className="text-right">{FIGURE.title}</span>
        </div>
        <button
          aria-label={FIGURE.label}
          className="mbx-stage block w-full"
          onClick={onClick}
          onKeyDown={onKeyDown}
          ref={stage}
          type="button"
        >
          <Art pose={REST_POSE} />
        </button>
        <span aria-live="polite" className="sr-only" ref={phase} />
        <div className="text-label text-muted-foreground tablet:inset-x-5 pointer-events-none absolute inset-x-4 bottom-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span aria-hidden="true">{FIGURE.hint}</span>
          <span className="text-foreground tabular-nums" data-readout="">
            {REST_POSE.readout}
          </span>
        </div>
      </div>
      <figcaption className="flex flex-col gap-3">
        <dl className="tablet:grid-cols-2 columns:grid-cols-3 grid gap-x-8 gap-y-2.5">
          {KEYS.map((key) => (
            <div className="text-ui" data-key={key.word} key={key.word}>
              <dt className="inline font-medium">
                <Swatch mark={key.mark} />
                {key.word}
              </dt>{" "}
              <dd className="text-muted-foreground inline">{key.part}</dd>
            </div>
          ))}
        </dl>
        <p className="text-ui text-muted-foreground max-w-(--measure)">
          {FIGURE.caption}
        </p>
      </figcaption>
    </figure>
  );
};
