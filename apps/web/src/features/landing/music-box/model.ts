/**
 * The music box's story as a pure function of time: an ask is claimed, a
 * first answer is refused at the shape stage, a second passes every stage and
 * the press pins it onto the cylinder. Every part's place and every word in
 * the readout come from `poseAt`, so the tour, a key press and the still
 * picture under reduced motion all agree.
 */
import { StageName } from "@repo/protocol/domain/outcome";

import {
  ARM_DOWN,
  ARM_OVER,
  ARM_PARK,
  INTAKE_X,
  PRESS_X,
  SECTION,
  STATIONS,
  TEETH_PER_SECTION,
} from "./layout.ts";

/** One cycle of the story, in seconds; three asks in turn make the whole loop. */
export const CYCLE = 26;

export const ASKS = [2, 0, 3] as const;

export const LOOP = CYCLE * ASKS.length;

/** The cylinder turns once in this many seconds while the tune plays. */
const TURN = 9;

/** The stage that refuses the first answer, as the landing page's transcript does. */
const REFUSED_AT = 1;

export type FlagState = "idle" | "checking" | "landed" | "refused" | "sealed";

export interface Pose {
  /** Which of the asks in turn this cycle shows. */
  readonly ask: number;
  /** The cylinder's angle, in radians. */
  readonly drum: number;
  /** The ask's tooth, counted from the bass end. */
  readonly tooth: number;
  /** How far the ask's corrected pin has come in, 0 to 1, and how green it still is. */
  readonly fixed: number;
  readonly fresh: number;
  /** The claim's clip: 0 off the ruler, 1 on it. */
  readonly claim: number;
  readonly carriage: number;
  /** Which answer the carriage holds: none, the first or the second. */
  readonly round: 0 | 1 | 2;
  /** The first answer's slide off the carriage into its tray, 0 to 1, and its fade at the reset. */
  readonly drop: number;
  readonly dropped: number;
  readonly slip: number;
  readonly template: number;
  readonly feeler: number;
  readonly testComb: number;
  readonly bell: number;
  readonly flags: readonly FlagState[];
  readonly arm: number;
  /** The arm holds the second answer from the grip until the press takes it in. */
  readonly holding: boolean;
  readonly entries: number;
  readonly printing: number;
  readonly ratchet: number;
  readonly readout: string;
  /** The phase in words, for the figure's accessible value. */
  readonly phase: string;
}

const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));

const smooth = (from: number, to: number, value: number) => {
  const share = clamp((value - from) / (to - from));

  return share * share * (3 - 2 * share);
};

const between = (from: number, to: number, value: number) =>
  value >= from && value < to;

/** A one-off envelope: up over `rise`, down over `fall`. */
const pulse = (start: number, rise: number, fall: number, value: number) =>
  value < start
    ? 0
    : smooth(start, start + rise, value) *
      (1 - smooth(start + rise, start + rise + fall, value));

const ROUND_ONE = 2.6;

const ROUND_TWO = 8.6;

const STEP = 1.25;

const DWELL = 0.75;

/** When the second answer reaches each stage. */
const arrival = (stage: number) => ROUND_TWO + 0.8 + stage * STEP;

const AT_PRESS = arrival(StageName.literals.length - 1) + DWELL + 0.75;

const GRIP = AT_PRESS + 0.7;

const OVER = GRIP + 1.3;

const PRESSED = OVER + 0.4;

const PARKED = PRESSED + 1.4;

const RESET = 24;

/** The tune's speed: full, slowing to a stop for the press, then full again. */
const speed = (t: number) =>
  1 -
  smooth(AT_PRESS - 0.8, AT_PRESS, t) +
  smooth(PARKED - 0.6, PARKED + 0.4, t);

/** The cylinder's angle over one cycle, integrated once on a fine grid. */
const ANGLES = (() => {
  const step = 0.01;
  const count = Math.ceil(CYCLE / step) + 1;
  const omega = (Math.PI * 2) / TURN;

  const angles = [0];

  for (const index of Array.from({ length: count - 1 }, (_, at) => at + 1)) {
    angles.push(
      (angles[index - 1] ?? 0) + speed(index * step - step / 2) * omega * step
    );
  }

  return angles;
})();

const angleIn = (t: number) => {
  const at = t / 0.01;
  const low = Math.floor(at);
  const share = at - low;

  return (
    (ANGLES[low] ?? 0) * (1 - share) +
    (ANGLES[low + 1] ?? ANGLES[low] ?? 0) * share
  );
};

const PER_CYCLE = ANGLES.at(-1) ?? 0;

/** The carriage's x: out from the intake, stage by stage, and home again. */
const carriageAt = (t: number) => {
  if (t < ROUND_ONE + 0.4) {
    return INTAKE_X;
  }

  if (t < ROUND_TWO) {
    const toFirst =
      smooth(ROUND_ONE + 0.4, ROUND_ONE + 1.2, t) * (STATIONS[0] - INTAKE_X);

    const toSecond =
      smooth(ROUND_ONE + 1.7, ROUND_ONE + 2.4, t) *
      (STATIONS[REFUSED_AT] - STATIONS[0]);

    const home =
      smooth(ROUND_ONE + 4.4, ROUND_ONE + 5.4, t) *
      (INTAKE_X - STATIONS[REFUSED_AT]);

    return INTAKE_X + toFirst + toSecond + home;
  }

  const legs = [...STATIONS, PRESS_X].map((x, index) => {
    const from = index === 0 ? INTAKE_X : (STATIONS[index - 1] ?? INTAKE_X);
    const start = index === 0 ? ROUND_TWO + 0.2 : arrival(index - 1) + DWELL;

    return (
      smooth(start, start + (index === 0 ? 0.6 : STEP - DWELL), t) * (x - from)
    );
  });

  const home = smooth(PRESSED + 0.4, PRESSED + 1.9, t) * (INTAKE_X - PRESS_X);

  return INTAKE_X + legs.reduce((sum, leg) => sum + leg, 0) + home;
};

const armAt = (t: number) => {
  const down = smooth(AT_PRESS - 0.1, GRIP, t) * (ARM_DOWN - ARM_PARK);
  const over = smooth(GRIP + 0.1, OVER, t) * (ARM_OVER - ARM_DOWN);
  const press = pulse(OVER, 0.18, 0.22, t) * 0.035;
  const home = smooth(PRESSED + 0.2, PARKED, t) * (ARM_PARK - ARM_OVER);

  return ARM_PARK + down + over + press + home;
};

/** A stage's flag while the first answer is in the gate: one pass, then the refusal. */
const firstRound = (index: number, t: number): FlagState => {
  if (index === 0) {
    if (t >= ROUND_ONE + 1.55) {
      return "landed";
    }

    return t >= ROUND_ONE + 1.1 ? "checking" : "idle";
  }

  if (index === REFUSED_AT) {
    if (t >= ROUND_ONE + 2.9) {
      return "refused";
    }

    return t >= ROUND_ONE + 2.3 ? "checking" : "idle";
  }

  return "idle";
};

/** A stage's flag while the second answer passes through: checking, then passed. */
const secondRound = (stage: StageName, index: number, t: number): FlagState => {
  const reached = arrival(index);

  if (t < reached) {
    return "idle";
  }

  if (t < reached + DWELL - 0.15) {
    return "checking";
  }

  return stage === "heldBack" ? "sealed" : "landed";
};

/** The flag of each stage, by how far each answer has come. */
const flagsAt = (t: number): readonly FlagState[] =>
  StageName.literals.map((stage, index) => {
    if (t >= RESET + 0.6) {
      return "idle";
    }

    return t < ROUND_TWO ? firstRound(index, t) : secondRound(stage, index, t);
  });

const roundAt = (t: number): Pose["round"] => {
  if (t >= ROUND_ONE && t < ROUND_ONE + 4) {
    return 1;
  }

  return between(ROUND_TWO, GRIP, t) ? 2 : 0;
};

const stageWord = (index: number) =>
  ["Parse", "Shape", "Merge", "Cheap", "Checks", "Held-back", "Maintainer"][
    index
  ] ?? "";

/** The readout's few words, and the same moment in a sentence. */
interface Words {
  readonly text: string;
  readonly phase: string;
}

const readoutAt = (t: number, tooth: number): Words => {
  const section = SECTION + 1;
  const note = `tooth ${tooth + 1}`;

  if (t < ROUND_ONE - 1.4) {
    return {
      phase: `An ask is open: ${note}, in section ${section}, plays sour.`,
      text: `ask open · ${note} plays sour`,
    };
  }

  if (t < ROUND_ONE) {
    return {
      phase: `Claimed: the clip is on section ${section}, its sand running.`,
      text: `claimed · section ${section}`,
    };
  }

  if (t < ROUND_ONE + 2.9) {
    const stage = t < ROUND_ONE + 1.7 ? 0 : 1;

    return {
      phase: `Round 1 is at the ${stageWord(stage)} stage.`,
      text: `round 1 · checking · ${stageWord(stage)}`,
    };
  }

  if (t < ROUND_TWO) {
    return {
      phase:
        "Round 1 is refused at the Shape stage: a pin outside its section, OutOfScope.",
      text: "round 1 · refused · OutOfScope",
    };
  }

  if (t < AT_PRESS) {
    const stage = Math.max(
      0,
      StageName.literals.findLastIndex((_, index) => t >= arrival(index))
    );

    const word = stageWord(stage);

    return {
      phase: `Round 2 is at the ${word} stage.`,
      text: `round 2 · checking · ${word}`,
    };
  }

  if (t < PRESSED) {
    return {
      phase: "Round 2 passed every stage; the press is pinning it.",
      text: "round 2 · landing",
    };
  }

  if (t < RESET) {
    return {
      phase: `Round 2 landed: ${note} plays true, and the tape printed its credit.`,
      text: `landed · ${note} plays true`,
    };
  }

  return { phase: "The next ask opens.", text: "next ask" };
};

/** Where the story stands at `time` seconds into the loop. */
export const poseAt = (time: number): Pose => {
  const looped = ((time % LOOP) + LOOP) % LOOP;
  const cycle = Math.floor(looped / CYCLE);
  const t = looped - cycle * CYCLE;
  const tooth = SECTION * TEETH_PER_SECTION + (ASKS[cycle] ?? 0);
  const words = readoutAt(t, tooth);
  const fixed = smooth(PRESSED - 0.2, PRESSED + 0.2, t);

  return {
    arm: armAt(t),
    ask: cycle,
    bell: pulse(arrival(5) + 0.2, 0.05, 0.6, t),
    carriage: carriageAt(t),
    claim:
      smooth(ROUND_ONE - 1.4, ROUND_ONE - 0.6, t) *
      (1 - smooth(RESET, RESET + 0.8, t)),
    drop: smooth(ROUND_ONE + 3.3, ROUND_ONE + 4, t),
    dropped: 1 - smooth(RESET, RESET + 0.8, t),
    drum: angleIn(t) + cycle * PER_CYCLE,
    entries: cycle * 2 + (t >= PRESSED ? 2 : 0),
    feeler:
      pulse(arrival(3) + 0.1, 0.12, 0.3, t) +
      pulse(arrival(3) + 0.42, 0.12, 0.2, t),
    fixed,
    flags: flagsAt(t),
    fresh: fixed * (1 - smooth(RESET - 2, RESET, t)),
    holding: between(GRIP, PRESSED + 0.05, t),
    phase: words.phase,
    printing: smooth(PRESSED, PRESSED + 0.6, t),
    ratchet: cycle + smooth(PRESSED + 0.3, PRESSED + 0.45, t),
    readout: words.text,
    round: roundAt(t),
    slip:
      smooth(ROUND_ONE + 4, ROUND_ONE + 4.5, t) *
      (1 - smooth(RESET, RESET + 0.6, t)),
    template:
      pulse(ROUND_ONE + 2.4, 0.35, 0.5, t) +
      pulse(arrival(1) + 0.05, 0.3, 0.35, t),
    testComb: pulse(arrival(4) + 0.15, 0.1, 0.5, t),
    tooth,
  };
};

/** The still picture: round 1 in its tray, round 2 landed, the tape printed. */
export const REST = 22.6;

/** The moments a key press steps between. */
export const BEATS = [
  0.4,
  1.8,
  ROUND_ONE + 1.4,
  ROUND_ONE + 4.6,
  arrival(1) + 0.3,
  arrival(5) + 0.3,
  OVER + 0.2,
  REST,
] as const;
