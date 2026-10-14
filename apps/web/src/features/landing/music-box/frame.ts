/**
 * What changes from one frame to the next: transforms, the pins on the
 * turning cylinder, the tape's printed entries. Pure functions of a pose, so
 * the server's still picture and the browser's first frame are the same.
 */
import { translateBy } from "./iso.ts";
import {
  CAMERA,
  CARRIAGE_TOP,
  SECTION,
  STATIONS,
  TAPE,
  TEETH,
  TEETH_PER_SECTION,
  TRAY_Y,
  STRIP_Y,
  toothX,
} from "./layout.ts";
import { ASKS } from "./model.ts";
import type { Pose } from "./model.ts";
import { RULES, TUNE, entry, pinAt, pinPast, pluck } from "./parts.ts";
import type { Pin } from "./parts.ts";

const C = CAMERA;

const move = (x: number, y: number, z: number) => translateBy(C, [x, y, z]);

/** Each ask's tooth, its sour pin and the pin that corrects it. */
const ASK_PINS = ASKS.map((offset, index) => {
  const x = toothX(SECTION * TEETH_PER_SECTION + offset);

  return {
    fixed: { angle: 1.1 + index * 1.7 + 0.9, x },
    sour: { angle: 1.1 + index * 1.7, x },
  };
});

const cycleOf = (pose: Pose) => pose.ask;

/** Where each of the four pin tones begins, by how squarely a pin faces the viewer. */
const PIN_TONES = [0.14, 0.28, 0.45] as const;

const buckets = (pins: readonly Pin[], turn: number) => {
  const ds = ["", "", "", ""];

  for (const pin of pins) {
    const { base, facing, tip } = pinAt(pin, turn);

    if (facing > 0.02) {
      const bucket = PIN_TONES.filter((edge) => facing >= edge).length;

      ds[bucket] +=
        `M${base[0].toFixed(1)} ${base[1].toFixed(1)}L${tip[0].toFixed(1)} ${tip[1].toFixed(1)}`;
    }
  }

  return ds;
};

const one = (pin: Pin, turn: number) => buckets([pin], turn).join("");

/** The pins of the tune, the ask's sour pin and its correction, at the cylinder's angle. */
export const drumPins = (pose: Pose) => {
  const current = cycleOf(pose);

  const done = ASK_PINS.slice(0, Math.max(0, current)).map(
    (pins) => pins.fixed
  );

  const ask = ASK_PINS[current];

  return {
    ask: ask !== undefined && pose.fixed < 1 ? one(ask.sour, pose.drum) : "",
    fixed: ask !== undefined && pose.fixed > 0 ? one(ask.fixed, pose.drum) : "",
    tune: buckets([...TUNE, ...done], pose.drum),
  };
};

/** Every pin the cylinder carries now, for the teeth they pluck. */
const pinsNow = (pose: Pose) => {
  const current = cycleOf(pose);
  const ask = ASK_PINS[current];

  return [
    ...TUNE,
    ...ASK_PINS.slice(0, Math.max(0, current)).map((pins) => pins.fixed),
    ...(ask === undefined ? [] : [pose.fixed < 0.5 ? ask.sour : ask.fixed]),
  ];
};

export const rulesPins = (turn: number) => buckets(RULES, turn);

const TOOTH_STATES = [
  ["ask", (pose: Pose) => pose.fixed < 0.5],
  ["landed", (pose: Pose) => pose.fresh > 0.5],
] as const;

/** How each tooth reads: the ask's tooth lit while it plays sour, green just after it lands. */
export const toothState = (pose: Pose, index: number) =>
  index === pose.tooth
    ? TOOTH_STATES.find(([, when]) => when(pose))?.[0]
    : undefined;

const TOOTH_LIFT = C.k * C.cosE;

/** The motion's transforms and paths at a pose. */
export const liveFrame = (pose: Pose) => {
  const lifts = Array.from({ length: TEETH }, () => 0);

  for (const pin of pinsNow(pose)) {
    const index = Math.round((pin.x - toothX(0)) / (toothX(1) - toothX(0)));
    const lift = pluck(pinPast(pin, pose.drum));

    if (Math.abs(lift) > Math.abs(lifts[index] ?? 0)) {
      lifts[index] = lift;
    }
  }

  const stray =
    pose.round === 1 && pose.drop === 0 ? pose.carriage : STATIONS[1];

  return {
    bell: move(Math.sin(pose.bell * 18) * 0.5 * pose.bell, 0, 0),
    carriage: move(pose.carriage, 0, 0),
    claim: move((1 - pose.claim) * 26, 0, 0),
    claimOpacity: pose.claim,
    fan: pose.drum * 14,
    /** The stray pin, once the shape stage has found it. */
    fault: pose.drop > 0 || pose.flags.includes("refused"),
    feeler: move(0, 0, -pose.feeler * 1.6),
    flag: move(toothX(pose.tooth), 0, 0),
    ratchet: -pose.ratchet * ((Math.PI * 2) / 18),
    slip: move(0, 0, (pose.slip - 1) * 10),
    stray: move(
      stray,
      pose.drop * (TRAY_Y[0] + 9 - (STRIP_Y[0] + STRIP_Y[1]) / 2),
      -pose.drop * (CARRIAGE_TOP - 1.4)
    ),
    strayOpacity: pose.round === 1 || pose.drop > 0 ? pose.dropped : 0,
    teeth: lifts.map((lift) =>
      lift === 0
        ? undefined
        : `translate(0 ${(-lift * TOOTH_LIFT * 0.6).toFixed(2)})`
    ),
    template: move(0, 0, -pose.template * 1.7),
    testComb: move(Math.sin(pose.testComb * 30) * 0.3 * pose.testComb, 0, 0),
  };
};

/** The tape's printed entries: one per landing, sliding out as each prints. */
export const tapeEntries = (pose: Pose) => {
  const landed = Math.floor(pose.entries / 2);

  const shift =
    pose.printing < 1 && pose.printing > 0 ? (pose.printing - 1) * 7 : 0;

  return Array.from({ length: landed }, (_, newest) => newest * 7 + shift)
    .filter((out) => out >= 0 && out < TAPE.d - 8)
    .map((out) => entry(out))
    .join("");
};
