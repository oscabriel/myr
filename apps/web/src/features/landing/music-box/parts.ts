/**
 * The music box's parts, built once as data. Static parts are whole lists of
 * marks; a part that turns or changes shape is a function of its angle, which
 * the art draws at rest and the motion calls every frame.
 */
import {
  arcOn,
  ribsOn,
  at,
  coil,
  cornersOf,
  frameAlong,
  inFrame,
  insetPlan,
  knurl,
  onTop,
  planOutline,
  polyline,
  post,
  prism,
  ringOn,
  ringOnTop,
  rod,
  segment,
  sideSeam,
  slab,
  ticksAlongX,
  turned,
  view,
  dot,
  hullOf,
  pathOf,
  sub,
} from "./iso.ts";
import type { Flat, Frame, Plan, Point } from "./iso.ts";
import {
  ARBOR_FROM,
  ARM_DOWN,
  ARM_R,
  ARM_XS,
  AXIS,
  BASE,
  BASE_H,
  BED,
  BED_TOP,
  BRIDGE_POSTS,
  BRIDGE_TOP,
  BRIDGE_W,
  BRIDGES,
  CAMERA,
  CAM_BOX,
  CARRIAGE_HALF,
  CARRIAGE_TOP,
  CASE,
  CASE_FLOOR,
  COMB_BACK,
  COMB_T,
  COMB_Z,
  CRANK_R,
  CRANK_X,
  DRUM_FROM,
  DRUM_R,
  DRUM_TO,
  FOLLOWER_X,
  FOOT_H,
  HINGE,
  LID_DEPTH,
  LID_OPEN,
  LIP,
  LIP_TOP,
  PIN_LENGTH,
  PIVOT,
  PRINTER,
  RAIL_BED,
  RAIL_BED_TOP,
  RAIL_TOP,
  RAILS,
  RULES_FROM,
  RULES_TO,
  SECTION,
  SECTION_MID,
  STATIONS,
  STRIP_T,
  STRIP_Y,
  TAPE,
  TEETH,
  TEETH_PER_SECTION,
  TOOTH_ROOT,
  TOOTH_TIP,
  TOOTH_W,
  TRAY_H,
  TRAY_HALF,
  TRAY_Y,
  WALL,
  WALL_TOP,
  sectionFrom,
  sectionTo,
  toothX,
} from "./layout.ts";
import { dots, line, solid } from "./marks.ts";
import type { Mark, Tone } from "./marks.ts";

const C = CAMERA;

const CHEAP_X = STATIONS.at(3) ?? 0;

const HELD_X = STATIONS.at(5) ?? 0;

const HUMAN_X = STATIONS.at(6) ?? 0;

const flat = (point: Point) => at(point, C);

const X: Point = [1, 0, 0];

const Y: Point = [0, 1, 0];

const Z: Point = [0, 0, 1];

/** The cylinder's frame: along x, angle 0 toward the viewer (+y), turning up. */
export const DRUM_FRAME: Frame = { a: X, o: [0, AXIS[0], AXIS[1]], u: Y, v: Z };

const screws = (points: readonly Point[], size = 0.5) =>
  dots(points.map(flat), size, "mid");

const box = (
  from: Point,
  to: Point,
  tone: Tone,
  options: { readonly r?: number; readonly bevel?: number } = {}
) =>
  solid(
    slab(
      {
        d: to[1] - from[1],
        r: options.r ?? 0.8,
        w: to[0] - from[0],
        x: from[0],
        y: from[1],
      },
      from[2],
      to[2] - from[2],
      C,
      { bevel: options.bevel ?? 0, steps: 3 }
    ),
    tone
  );

/** The bench: feet, a bevelled top with a groove, corner screws and a label plate. */
export const bench = (): readonly Mark[] => {
  const feet = cornersOf(BASE, 24).toSorted(
    (a, b) => a[0] * C.cosA + a[1] * C.sinA - (b[0] * C.cosA + b[1] * C.sinA)
  );

  const corner = cornersOf(BASE, 10);

  const label: Plan = {
    d: 14,
    r: 1,
    w: 34,
    x: BASE.x + 14,
    y: BASE.y + BASE.d - 24,
  };

  return [
    ...feet.flatMap((foot) => [
      solid(post(foot, 8, -BASE_H - FOOT_H, 1.6, C), "lo"),
      solid(post(foot, 6.2, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, C), "mid"),
    ]),
    solid(slab(BASE, -BASE_H, BASE_H, C, { bevel: 1.6, steps: 8 }), "mid", {
      inner: [line(sideSeam(BASE, -BASE_H + 4, C, 8), "faint")],
    }),
    line(planOutline(insetPlan(BASE, 5), 0, C, 8), "lo"),
    line(corner.map((point) => ringOnTop(point, 2.2, 0, C, 16)).join(""), "lo"),
    screws(corner.map(([x, y]) => [x, y, 0])),
    solid(slab(label, 0, 0.8, C, { steps: 2 }), "lo", { crease: "none" }),
    line(planOutline(insetPlan(label, 1.6), 0.8, C, 2), "faint"),
    line(
      onTop(
        [
          [label.x + 4, label.y + 4.5],
          [label.x + 26, label.y + 4.5],
        ],
        0.8,
        C
      ),
      "lo",
      { free: true }
    ),
    line(
      onTop(
        [
          [label.x + 4, label.y + 7.5],
          [label.x + 20, label.y + 7.5],
        ],
        0.8,
        C
      ),
      "lo",
      { free: true }
    ),
    line(
      onTop(
        [
          [label.x + 4, label.y + 10.5],
          [label.x + 23, label.y + 10.5],
        ],
        0.8,
        C
      ),
      "lo",
      { free: true }
    ),
    screws(
      [
        [label.x + 30.5, label.y + 3.5, 0.8],
        [label.x + 30.5, label.y + 10.5, 0.8],
      ],
      0.45
    ),
  ];
};

/** The lid's own frame: along its thickness, x across, its depth up and back. */
const LID: Frame = {
  a: [0, -Math.sin(LID_OPEN), Math.cos(LID_OPEN)],
  o: [CASE.x, HINGE[0], HINGE[1]],
  u: X,
  v: [0, Math.cos(LID_OPEN), Math.sin(LID_OPEN)],
};

const LID_BAR = 7;

/** Where the lid's glass turns frosted: the right of it holds a layer. */
const FROST_FROM = 196;

const rect = (
  u0: number,
  v0: number,
  u1: number,
  v1: number
): readonly Flat[] => [
  [u0, v0],
  [u1, v0],
  [u1, v1],
  [u0, v1],
];

/** The glass lid, open: a frame, a clear pane, a frosted panel, hinges and a stay. */
export const lid = (): readonly Mark[] => {
  const width = CASE.w;
  const thick = 3.6;

  const bar = (u0: number, v0: number, u1: number, v1: number) =>
    solid(prism(LID, rect(u0, v0, u1, v1), -thick, 0, C), "mid");

  const pane = (u0: number, u1: number) =>
    prism(LID, rect(u0, LID_BAR, u1, LID_DEPTH - LID_BAR), -2.2, -1.4, C);

  const frost = Array.from({ length: 10 }, (_row, row) =>
    Array.from({ length: 11 }, (_column, column) =>
      flat(
        inFrame(LID, -1.4, [
          FROST_FROM + 3.5 + column * 6.6 + (row % 2) * 3.3,
          LID_BAR + 4 + row * 6,
        ])
      )
    )
  ).flat();

  // Glints run bar to bar, their ends under the frame.
  const glint = (u: number) =>
    polyline(
      [
        inFrame(LID, -1.4, [u, LID_BAR - 1]),
        inFrame(LID, -1.4, [
          u + (LID_DEPTH - LID_BAR * 2 + 2) * 0.45,
          LID_DEPTH - LID_BAR + 1,
        ]),
      ],
      C
    );

  return [
    solid(pane(LID_BAR, FROST_FROM), "faint", { crease: "none", glass: true }),
    solid(pane(FROST_FROM, width - LID_BAR), "faint", {
      crease: "none",
      glass: true,
    }),
    dots(frost, 0.42, "lo"),
    line(glint(40), "faint"),
    line(glint(52), "faint"),
    bar(0, 0, width, LID_BAR),
    bar(0, LID_DEPTH - LID_BAR, width, LID_DEPTH),
    bar(0, LID_BAR, LID_BAR, LID_DEPTH - LID_BAR),
    bar(width - LID_BAR, LID_BAR, width, LID_DEPTH - LID_BAR),
    bar(FROST_FROM - 1.5, LID_BAR, FROST_FROM + 1.5, LID_DEPTH - LID_BAR),
    screws(
      [
        inFrame(LID, 0, [3.5, 3.5]),
        inFrame(LID, 0, [width - 3.5, 3.5]),
        inFrame(LID, 0, [3.5, LID_DEPTH - 3.5]),
        inFrame(LID, 0, [width - 3.5, LID_DEPTH - 3.5]),
      ],
      0.45
    ),
  ];
};

const knuckle = (x: number) =>
  solid(
    rod(frameAlong([0, HINGE[0], HINGE[1] + 0.4], X), x, x + 14, 2.2, C, 18),
    "mid"
  );

/** The hinges between lid and back wall, and the stay that holds the lid open. */
export const hinges = (): readonly Mark[] => {
  const low: Point = [CASE.x + WALL + 1.2, CASE.y + 44, WALL_TOP - 6];
  const high = inFrame(LID, 0.6, [WALL + 1.2, 38]);
  const stay = frameAlong(low, sub(high, low));
  const length = Math.hypot(...sub(high, low));

  return [
    knuckle(CASE.x + 30),
    knuckle(CASE.x + CASE.w - 44),
    solid(rod(stay, 0, length, 0.8, C, 10), "mid", { crease: "none" }),
    screws([low, high], 0.55),
  ];
};

/** The case behind the movement: floor, back wall, far end wall, bedplate. */
export const caseBack = (): readonly Mark[] => {
  const floor = CASE;
  const back: Plan = { d: WALL, r: 1, w: CASE.w, x: CASE.x, y: CASE.y };

  const end: Plan = {
    d: CASE.d - WALL,
    r: 1,
    w: WALL,
    x: CASE.x,
    y: CASE.y + WALL,
  };

  const bedScrews = cornersOf(BED, 5);

  return [
    solid(slab(floor, 0, CASE_FLOOR, C, { bevel: 0.6, steps: 3 }), "mid"),
    solid(
      slab(back, CASE_FLOOR, WALL_TOP - CASE_FLOOR, C, {
        bevel: 0.6,
        steps: 3,
      }),
      "mid",
      {
        inner: [line(sideSeam(back, WALL_TOP - 9, C, 3), "faint")],
      }
    ),
    solid(
      slab(end, CASE_FLOOR, WALL_TOP - CASE_FLOOR, C, { bevel: 0.6, steps: 3 }),
      "mid",
      {
        inner: [line(sideSeam(end, WALL_TOP - 9, C, 3), "faint")],
      }
    ),
    solid(
      slab(BED, CASE_FLOOR, BED_TOP - CASE_FLOOR, C, { bevel: 0.6, steps: 3 }),
      "lo"
    ),
    line(planOutline(insetPlan(BED, 2.4), BED_TOP, C, 3), "faint"),
    screws(bedScrews.map(([x, y]) => [x, y, BED_TOP])),
  ];
};

const TOOTH_ANGLE = Math.atan2(COMB_Z + COMB_T - AXIS[1], TOOTH_TIP - AXIS[0]);

/** A pin's place on the cylinder, by its tooth and its angle. */
export interface Pin {
  readonly x: number;
  readonly angle: number;
}

/** A tune that never changes between server and browser: a fixed hash, no randomness. */
const hash = (seed: number) => {
  const mixed = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;

  return mixed - Math.floor(mixed);
};

/** The tune: two to five pins per tooth, spaced round the cylinder. */
export const TUNE: readonly Pin[] = Array.from(
  { length: TEETH },
  (_, tooth) => {
    const count = 2 + Math.floor(hash(tooth + 1) * 4);

    return Array.from({ length: count }, (_pin, index) => ({
      angle:
        ((index + hash(tooth * 7 + index * 3 + 2) * 0.6) / count) * Math.PI * 2,
      x: toothX(tooth),
    }));
  }
).flat();

/** The rules track's pins: a short fixed program that drives the gate's cams. */
export const RULES: readonly Pin[] = Array.from({ length: 12 }, (_, index) => ({
  angle: (index / 12) * Math.PI * 2 + (index % 3) * 0.08,
  x: RULES_FROM + 3 + (index % 2) * 5,
}));

/** A pin's base and tip on screen at the cylinder's angle, and how squarely it faces the viewer. */
export const pinAt = (pin: Pin, turnAngle: number) => {
  const angle = pin.angle + turnAngle;
  const radial: Point = [0, Math.cos(angle), Math.sin(angle)];

  const base: Point = [
    pin.x,
    AXIS[0] + radial[1] * DRUM_R,
    AXIS[1] + radial[2] * DRUM_R,
  ];

  return {
    base: flat(base),
    facing: dot(radial, view(C)),
    tip: flat([
      pin.x,
      base[1] + radial[1] * PIN_LENGTH,
      base[2] + radial[2] * PIN_LENGTH,
    ]),
  };
};

/** How far a tooth's tip is lifted when a pin has just passed it, by the pin's angle past the tip. */
export const pluck = (past: number) => {
  const wrapped = Math.atan2(Math.sin(past), Math.cos(past));

  if (wrapped < -0.14 || wrapped > 1.2) {
    return 0;
  }

  return wrapped <= 0
    ? ((wrapped + 0.14) / 0.14) * 0.9
    : 0.9 * Math.exp(-wrapped / 0.18) * Math.cos(wrapped * 70);
};

export const pinPast = (pin: Pin, turnAngle: number) =>
  pin.angle + turnAngle - TOOTH_ANGLE;

/** A standard that carries the arbor: a slab with a bearing boss. */
const bridge = (x: number): readonly Mark[] => {
  const plan: Plan = { d: 22, r: 1.5, w: BRIDGE_W, x, y: AXIS[0] - 11 };

  return [
    solid(
      slab(plan, BED_TOP, AXIS[1] + 6 - BED_TOP, C, { bevel: 0.5, steps: 3 }),
      "mid"
    ),
    solid(rod(DRUM_FRAME, x - 1, x + BRIDGE_W + 1, 6, C, 32), "mid"),
    line(ringOn(DRUM_FRAME, x + BRIDGE_W + 1, 3.6, C, 24), "lo"),
    screws(
      [
        [x + BRIDGE_W / 2, plan.y + 3, AXIS[1] + 6],
        [x + BRIDGE_W / 2, plan.y + plan.d - 3, AXIS[1] + 6],
      ],
      0.42
    ),
  ];
};

/** The far side of the movement: governor, gear, arbor, left bridge and flange. */
export const movementBack = (): readonly Mark[] => {
  const governor: Flat = [BRIDGES[0] - 12, AXIS[0] - 14];
  const bridgeLeft = bridge(BRIDGES[0]);

  return [
    solid(post(governor, 4.5, BED_TOP, 3, C, 20), "mid"),
    solid(post(governor, 1.3, BED_TOP + 3, 32, C, 12), "mid", {
      crease: "none",
    }),
    solid(post(governor, 2.6, BED_TOP + 12, 9, C, 18), "mid"),
    line(knurl(governor, 2.6, [BED_TOP + 12, BED_TOP + 21], 14, C), "lo"),
    solid(rod(DRUM_FRAME, ARBOR_FROM, BRIDGES[0], 2.4, C, 20), "mid"),
    solid(rod(DRUM_FRAME, ARBOR_FROM + 2, ARBOR_FROM + 6, 9, C, 40), "mid", {
      inner: [
        line(
          ribsOn(DRUM_FRAME, [ARBOR_FROM + 2.3, ARBOR_FROM + 5.7], 9, 36, C),
          "lo"
        ),
      ],
    }),
    ...bridgeLeft,
    solid(rod(DRUM_FRAME, BRIDGES[0] + BRIDGE_W, DRUM_FROM, 2.4, C, 20), "mid"),
    solid(rod(DRUM_FRAME, DRUM_FROM - 2, DRUM_FROM, DRUM_R + 2, C, 64), "mid"),
  ];
};

/** The governor's fan, turning fast while the tune plays. */
export const governorFan = (angle: number): readonly Mark[] => {
  const centre: Point = [BRIDGES[0] - 12, AXIS[0] - 14, BED_TOP + 33];
  const across: Point = [Math.cos(angle), Math.sin(angle), 0];

  const vane: Frame = {
    a: across,
    o: centre,
    u: [-Math.sin(angle), Math.cos(angle), 0],
    v: Z,
  };

  return [
    solid(prism(vane, rect(-0.35, -3, 0.35, 3), -9, -1.5, C), "mid"),
    solid(prism(vane, rect(-0.35, -3, 0.35, 3), 1.5, 9, C), "mid"),
    solid(
      post([centre[0], centre[1]], 1.7, centre[2] - 3.4, 6.8, C, 14),
      "mid"
    ),
  ];
};

const sectionSeams = () =>
  Array.from({ length: TEETH / TEETH_PER_SECTION - 1 }, (_, index) =>
    arcOn(DRUM_FRAME, sectionFrom(index + 1), DRUM_R, C)
  ).join("");

/** The cylinder itself, seamed at every section's edge. */
export const drum = (): readonly Mark[] => [
  solid(rod(DRUM_FRAME, DRUM_FROM, DRUM_TO, DRUM_R, C, 72), "hi", {
    inner: [line(sectionSeams(), "faint")],
  }),
];

/** The near side of the movement: flange, rules track, right bridge, ratchet. */
export const movementFront = (): readonly Mark[] => [
  solid(rod(DRUM_FRAME, DRUM_TO, DRUM_TO + 2, DRUM_R + 2, C, 64), "mid", {
    inner: [line(ringOn(DRUM_FRAME, DRUM_TO + 2, DRUM_R - 4, C, 48), "faint")],
  }),
  solid(rod(DRUM_FRAME, DRUM_TO + 2, RULES_FROM - 1, 2.4, C, 20), "mid"),
  solid(
    rod(DRUM_FRAME, RULES_FROM - 1, RULES_FROM, DRUM_R + 1.5, C, 56),
    "mid"
  ),
];

export const rulesTrack = (): readonly Mark[] => [
  solid(rod(DRUM_FRAME, RULES_FROM, RULES_TO, DRUM_R, C, 64), "hi"),
];

export const movementEnd = (): readonly Mark[] => [
  solid(rod(DRUM_FRAME, RULES_TO, RULES_TO + 1, DRUM_R + 1.5, C, 56), "mid"),
  solid(rod(DRUM_FRAME, RULES_TO + 1, BRIDGES[1], 2.4, C, 20), "mid"),
  ...bridge(BRIDGES[1]),
  solid(
    rod(
      DRUM_FRAME,
      BRIDGES[1] + BRIDGE_W + 1,
      BRIDGES[1] + BRIDGE_W + 4,
      14,
      C,
      56
    ),
    "mid"
  ),
];

const RATCHET_S = BRIDGES[1] + BRIDGE_W + 4;

const RATCHET_TEETH = 18;

/** The ratchet's saw teeth on its face, at its angle: a landing clicks it one tooth down. */
export const ratchetTeeth = (angle: number) =>
  polyline(
    Array.from({ length: RATCHET_TEETH * 2 + 1 }, (_, index) => {
      const tooth = Math.floor(index / 2);

      const a =
        angle + (tooth / RATCHET_TEETH) * Math.PI * 2 + (index % 2) * 0.02;

      const r = index % 2 === 0 ? 12.6 : 9.8;

      return inFrame(DRUM_FRAME, RATCHET_S, [r * Math.cos(a), r * Math.sin(a)]);
    }),
    C
  );

/** The pawl that holds the ratchet, and its click spring. */
export const pawl = (): readonly Mark[] => {
  const pivot: Point = [RATCHET_S + 1.2, AXIS[0] + 10, AXIS[1] + 18];
  const frame = frameAlong([RATCHET_S, pivot[1], pivot[2]], X);

  return [
    solid(
      post(
        [RATCHET_S + 1.5, AXIS[0] + 10],
        1.6,
        BED_TOP,
        pivot[2] - BED_TOP,
        C,
        12
      ),
      "mid",
      {
        crease: "none",
      }
    ),
    solid(
      prism(
        frame,
        [
          [-2.2, -1.6],
          [2.2, -1.6],
          [0.6, -7.4],
          [-1, -6.8],
        ],
        0,
        2.4,
        C
      ),
      "mid"
    ),
    solid(rod(frame, 2.4, 3.2, 1.2, C, 12), "mid"),
  ];
};

/** The comb's cast block and the lead weights under its bass teeth. */
export const combBlock = (): readonly Mark[] => {
  const from = toothX(0) - 3;
  const to = toothX(TEETH - 1) + 3;

  const block: Plan = {
    d: COMB_BACK - (TOOTH_ROOT - 2),
    r: 1,
    w: to - from,
    x: from,
    y: TOOTH_ROOT - 2,
  };

  return [
    solid(
      slab(block, BED_TOP, COMB_Z - BED_TOP, C, { bevel: 0.5, steps: 3 }),
      "mid",
      {
        inner: [line(sideSeam(block, COMB_Z - 5, C, 3), "faint")],
      }
    ),
    ...Array.from({ length: 8 }, (_, tooth) =>
      box(
        [
          toothX(tooth) - TOOTH_W / 2 + 0.2,
          TOOTH_TIP + 1.5,
          COMB_Z - 3.2 + tooth * 0.2,
        ],
        [toothX(tooth) + TOOTH_W / 2 - 0.2, TOOTH_TIP + 6.5, COMB_Z],
        "lo"
      )
    ),
  ];
};

/** One tooth of the comb, built at rest; the motion lifts its group when a pin plucks it. */
export const tooth = (index: number) =>
  slab(
    {
      d: TOOTH_ROOT - TOOTH_TIP,
      r: 0.5,
      w: TOOTH_W,
      x: toothX(index) - TOOTH_W / 2,
      y: TOOTH_TIP,
    },
    COMB_Z,
    COMB_T,
    C,
    { steps: 2 }
  );

/** The comb's root plate over the block, screwed down once a section. */
export const combRoot = (): readonly Mark[] => {
  const from = toothX(0) - 3;
  const to = toothX(TEETH - 1) + 3;

  const root: Plan = {
    d: COMB_BACK - TOOTH_ROOT,
    r: 0.8,
    w: to - from,
    x: from,
    y: TOOTH_ROOT,
  };

  return [
    solid(slab(root, COMB_Z, COMB_T, C, { bevel: 0.4, steps: 2 }), "hi", {
      crease: "lo",
    }),
    screws(
      Array.from({ length: TEETH / TEETH_PER_SECTION }, (_, section): Point => [
        (sectionFrom(section) + sectionTo(section)) / 2,
        (TOOTH_ROOT + COMB_BACK) / 2,
        COMB_Z + COMB_T,
      ]),
      0.55
    ),
  ];
};

/** The rules follower: a roller on the rules track and the lever it rocks. */
export const follower = (): readonly Mark[] => {
  const x = FOLLOWER_X;

  return [
    box([x - 4, -22, CASE_FLOOR], [x + 4, -12, BED_TOP + 3], "mid"),
    solid(
      rod(frameAlong([x - 3.5, -17, BED_TOP + 3], X), 0, 7, 2, C, 16),
      "mid"
    ),
    solid(
      prism(
        frameAlong([x - 1.2, 0, 0], X),
        [
          [-17.4, BED_TOP + 2],
          [-15.8, BED_TOP + 4],
          [AXIS[0] + DRUM_R + 4.4, AXIS[1] - 1.8],
          [AXIS[0] + DRUM_R + 2.2, AXIS[1] - 3.2],
        ],
        0,
        2.4,
        C
      ),
      "mid"
    ),
    solid(
      rod(
        frameAlong([x - 2, AXIS[0] + DRUM_R + 3, AXIS[1] - 2.2], X),
        0,
        4,
        2.6,
        C,
        20
      ),
      "mid"
    ),
    solid(
      prism(
        frameAlong([x - 1, 0, 0], X),
        [
          [-17, BED_TOP + 3],
          [-15.6, BED_TOP + 2],
          [-9, 14.6],
          [-10.4, 15.6],
        ],
        0,
        2,
        C
      ),
      "mid"
    ),
  ];
};

/** The front lip, its ruler of teeth and sections, the pillars of the press. */
export const lipAndRuler = (): readonly Mark[] => {
  const strip: Plan = {
    d: 4,
    r: 0.6,
    w: sectionTo(TEETH / TEETH_PER_SECTION - 1) - sectionFrom(0) + 2,
    x: sectionFrom(0) - 1,
    y: -7,
  };

  const ticks = ticksAlongX(
    Array.from({ length: TEETH + 1 }, (_, index) => toothX(index) - 4.35 / 2),
    TEETH_PER_SECTION,
    strip.y + 0.4,
    LIP_TOP + 0.5,
    [1.2, 2.6],
    C
  );

  return [
    solid(
      slab(LIP, CASE_FLOOR, LIP_TOP - CASE_FLOOR, C, { bevel: 0.5, steps: 2 }),
      "mid"
    ),
    solid(slab(strip, LIP_TOP, 0.5, C, { steps: 2 }), "lo", { crease: "none" }),
    line(ticks.minor, "lo"),
    line(ticks.major, "mid"),
  ];
};

/** The press's two pillars on the lip, each with its pivot boss. */
export const pillars = (): readonly Mark[] =>
  ARM_XS.flatMap((x, index) => {
    const outward = index === 0 ? -1 : 1;
    const px = x + outward * 3.2;

    return [
      solid(post([px, PIVOT[0]], 2.6, LIP_TOP, 2, C, 18), "mid"),
      solid(
        post([px, PIVOT[0]], 1.8, LIP_TOP + 2, PIVOT[1] - LIP_TOP - 2, C, 16),
        "mid",
        {
          crease: "none",
        }
      ),
      solid(
        rod(frameAlong([px - 2.2, PIVOT[0], PIVOT[1]], X), 0, 4.4, 3, C, 20),
        "mid"
      ),
    ];
  });

/** The rail bed, its two rails and the back posts of every stage's bridge. */
export const railBack = (): readonly Mark[] => [
  solid(slab(RAIL_BED, 0, RAIL_BED_TOP, C, { bevel: 0.6, steps: 3 }), "mid"),
  ...RAILS.map((y) =>
    solid(
      slab(
        { d: 2.4, r: 0.6, w: RAIL_BED.w - 8, x: RAIL_BED.x + 4, y: y - 1.2 },
        RAIL_BED_TOP,
        RAIL_TOP - RAIL_BED_TOP,
        C,
        { bevel: 0.3, steps: 2 }
      ),
      "mid"
    )
  ),
  screws(
    RAILS.flatMap((y) =>
      [RAIL_BED.x + 8, RAIL_BED.x + RAIL_BED.w - 8].map((x): Point => [
        x,
        y,
        RAIL_TOP,
      ])
    ),
    0.4
  ),
  ...STATIONS.map((x) =>
    box(
      [x - 2.5, BRIDGE_POSTS[0] - 2, 0],
      [x + 2.5, BRIDGE_POSTS[0] + 2, BRIDGE_TOP],
      "mid"
    )
  ),
  box(
    [RAIL_BED.x + 1.5, 29, RAIL_BED_TOP],
    [RAIL_BED.x + 4.5, 45, RAIL_BED_TOP + 7],
    "mid",
    { bevel: 0.3 }
  ),
];

/** The carriage that takes an answer down the rail, built at x = 0. */
export const carriage = (): readonly Mark[] => {
  const plan: Plan = {
    d: 16,
    r: 1.5,
    w: CARRIAGE_HALF * 2,
    x: -CARRIAGE_HALF,
    y: 29,
  };

  return [
    ...[-CARRIAGE_HALF + 3, CARRIAGE_HALF - 7].flatMap((x) =>
      RAILS.map((y) =>
        box([x, y - 2.4, RAIL_TOP - 1], [x + 4, y + 2.4, RAIL_TOP + 1], "mid")
      )
    ),
    solid(
      slab(plan, RAIL_TOP + 0.6, CARRIAGE_TOP - RAIL_TOP - 0.6, C, {
        bevel: 0.5,
        steps: 3,
      }),
      "mid"
    ),
    line(
      onTop(
        [
          [-CARRIAGE_HALF, STRIP_Y[0] - 1],
          [CARRIAGE_HALF, STRIP_Y[0] - 1],
        ],
        CARRIAGE_TOP,
        C
      ),
      "faint"
    ),
    line(
      onTop(
        [
          [-CARRIAGE_HALF, STRIP_Y[1] + 1],
          [CARRIAGE_HALF, STRIP_Y[1] + 1],
        ],
        CARRIAGE_TOP,
        C
      ),
      "faint"
    ),
    screws(
      [-11, -4, 4, 11].map((x): Point => [
        x,
        plan.y + plan.d - 1.8,
        CARRIAGE_TOP,
      ]),
      0.4
    ),
  ];
};

/** A strip's own frame on the carriage, at x = 0: along x, across y, up z. */
const ON_CARRIAGE: Frame = {
  a: Z,
  o: [0, (STRIP_Y[0] + STRIP_Y[1]) / 2, CARRIAGE_TOP],
  u: X,
  v: Y,
};

export const STRIP_HALF = (TEETH_PER_SECTION * 4.35) / 2 + 1;

/**
 * An answer: a brass strip of pins for one section, in its own frame. A stray
 * pin past its end is what the shape stage refuses.
 */
export const strip = (
  stray: boolean,
  frame: Frame = ON_CARRIAGE
): readonly Mark[] => {
  const across = (STRIP_Y[1] - STRIP_Y[0]) / 2;
  const strayX = STRIP_HALF + 2.4;
  const length = stray ? STRIP_HALF + 4.6 : STRIP_HALF;

  const pins = [
    ...[-1.5, -0.5, 0.5, 1.5].map((index) => index * 4.35),
    ...(stray ? [strayX] : []),
  ].map((x, index) => {
    const y = index % 2 === 0 ? -1.2 : 1.2;

    return line(
      polyline(
        [
          inFrame(frame, STRIP_T, [x, y]),
          inFrame(frame, STRIP_T + 1.8, [x, y]),
        ],
        C
      ),
      x === strayX ? "lit" : "hi",
      { width: 1.1 }
    );
  });

  const plate = solid(
    prism(frame, rect(-STRIP_HALF, -across, length, across), 0, STRIP_T, C),
    "hi",
    {
      crease: "lo",
    }
  );

  // Pins that point away from the viewer hide behind their plate. Both sets
  // are always drawn, one of them empty, so a turning strip keeps its paths.
  const facing = dot(frame.a, view(C)) > 0;
  const hidden = pins.map((pin) => ({ ...pin, d: "" }));

  return [...(facing ? hidden : pins), plate, ...(facing ? pins : hidden)];
};

const bridgeTop = (x: number): readonly Mark[] => [
  box(
    [x - 4, BRIDGE_POSTS[0] - 3, BRIDGE_TOP],
    [x + 4, BRIDGE_POSTS[1] + 3, BRIDGE_TOP + 4],
    "mid",
    { bevel: 0.4 }
  ),
  screws(
    [BRIDGE_POSTS[0], BRIDGE_POSTS[1]].map((y): Point => [
      x,
      y,
      BRIDGE_TOP + 4,
    ]),
    0.42
  ),
];

const frontPost = (x: number) =>
  box(
    [x - 2.5, BRIDGE_POSTS[1] - 2, RAIL_BED_TOP - 5],
    [x + 2.5, BRIDGE_POSTS[1] + 2, BRIDGE_TOP],
    "mid"
  );

const hanger = (x: number, low: number) =>
  solid(post([x, 36], 1, low, BRIDGE_TOP - low, C, 10), "mid", {
    crease: "none",
  });

/** Each stage's bridge front, crossbar and fixed instrument, by stage. */
export const stationFronts = (): readonly (readonly Mark[])[] => [
  // Parse: a slot gauge the strip must pass under.
  [
    frontPost(STATIONS[0]),
    box([STATIONS[0] - 6, 30, 16], [STATIONS[0] + 6, 42, BRIDGE_TOP], "mid", {
      bevel: 0.4,
    }),
    line(
      polyline(
        [
          [STATIONS[0] - 4, 42, 18],
          [STATIONS[0] + 4, 42, 18],
          [STATIONS[0] + 4, 42, 20],
          [STATIONS[0] - 4, 42, 20],
        ],
        C,
        true
      ),
      "lo"
    ),
    ...bridgeTop(STATIONS[0]),
  ],
  // Shape: the template's guide; the template itself moves.
  [frontPost(STATIONS[1]), ...bridgeTop(STATIONS[1])],
  // Merge: a roller in a fork that rolls the strip against main.
  [
    frontPost(STATIONS[2]),
    box([STATIONS[2] - 5, 30, 21], [STATIONS[2] + 5, 31.6, BRIDGE_TOP], "mid"),
    solid(rod(frameAlong([STATIONS[2], 31.6, 18], Y), 0, 9, 4.2, C, 28), "hi"),
    line(arcOn(frameAlong([STATIONS[2], 31.6, 18], Y), 4.5, 4.2, C), "faint"),
    box(
      [STATIONS[2] - 5, 40.6, 21],
      [STATIONS[2] + 5, 42.2, BRIDGE_TOP],
      "mid"
    ),
    ...bridgeTop(STATIONS[2]),
  ],
  // Cheap: the feeler's guide; the feeler itself moves.
  [
    frontPost(STATIONS[3]),
    ...bridgeTop(STATIONS[3]),
    box([STATIONS[3] - 3, 33, 24], [STATIONS[3] + 3, 39, BRIDGE_TOP], "mid"),
  ],
  // Checks: a small test comb under the bar; its teeth move.
  [
    frontPost(STATIONS[4]),
    box([STATIONS[4] - 7, 30, 24], [STATIONS[4] + 7, 34, BRIDGE_TOP], "mid"),
    ...bridgeTop(STATIONS[4]),
  ],
  // Held back: a sealed box under a frosted top; its bell moves.
  [
    frontPost(STATIONS[5]),
    box([STATIONS[5] - 7, 29, 17], [STATIONS[5] + 7, 43, BRIDGE_TOP], "mid", {
      bevel: 0.5,
    }),
    dots(
      Array.from({ length: 5 }, (_row, row) =>
        Array.from({ length: 4 }, (_column, column) =>
          flat([
            STATIONS[5] - 5.2 + column * 3.5 + (row % 2) * 1.6,
            30.6 + row * 2.8,
            BRIDGE_TOP,
          ])
        )
      ).flat(),
      0.38,
      "lo"
    ),
    ...bridgeTop(STATIONS[5]),
  ],
  // Maintainer: a decision lever with its sand-glass, taken only when a person must choose.
  [frontPost(STATIONS[6]), ...bridgeTop(STATIONS[6])],
];

/** A template plate that drops onto the strip: its window is the section's territory. */
export const template = (): readonly Mark[] => {
  const [, x] = STATIONS;
  const plate: Plan = { d: 10, r: 0.8, w: 22, x: x - 11, y: 32 };

  return [
    hanger(x, 18),
    solid(slab(plate, 16, 1.6, C, { bevel: 0.3, steps: 2 }), "hi", {
      crease: "lo",
    }),
    line(
      planOutline({ d: 6, r: 0.4, w: 18.4, x: x - 9.2, y: 34 }, 17.6, C, 2),
      "lo"
    ),
  ];
};

/** The feeler: a sprung plunger that taps every pin for one bent flat. */
export const feeler = (): readonly Mark[] => {
  const x = CHEAP_X;
  const spring = coil([x, 36], 1.8, [19, 24], 4, C);

  return [
    line(spring.back, "lo"),
    solid(post([x, 36], 0.9, 15, 9.5, C, 10), "hi", { crease: "none" }),
    solid(post([x, 36], 1.6, 18, 1, C, 14), "mid"),
    line(spring.front, "mid"),
  ];
};

/** The test comb's five teeth, pointing down at the strip. */
export const testTeeth = (): readonly Mark[] =>
  Array.from({ length: 5 }, (_, index) => {
    const x = STATIONS[4] - 5 + index * 2.5;

    return solid(
      slab({ d: 1.4, r: 0.3, w: 1.6, x: x - 0.8, y: 32 }, 15.5, 8.5, C, {
        steps: 1,
      }),
      "hi",
      { crease: "lo" }
    );
  });

/** The held-back stage's bell, on a post above its sealed box. */
export const bell = (): readonly Mark[] => {
  const x = HELD_X;
  const centre: Point = [x, 36, BRIDGE_TOP + 4];
  const frame = frameAlong(centre, Z);

  return [
    solid(post([x, 36], 0.8, BRIDGE_TOP + 4, 4, C, 10), "mid", {
      crease: "none",
    }),
    solid(
      turned(
        frame,
        [
          [4, 5.6],
          [5, 5.4],
          [7, 4.2],
          [9.4, 3.2],
          [11, 2],
          [11.6, 0],
        ],
        C,
        28
      ),
      "hi",
      { crease: "lo" }
    ),
  ];
};

/** A small sand-glass: two cones between two plates, on three posts. */
export const sandGlass = (
  centre: Flat,
  z: number,
  height = 9
): readonly Mark[] => {
  const frame = frameAlong([centre[0], centre[1], z], Z);
  const half = height / 2;

  return [
    solid(post(centre, 2.6, z, 0.8, C, 16), "mid"),
    solid(
      turned(
        frame,
        [
          [0.8, 2.1],
          [half - 0.3, 0.35],
          [half, 0.3],
        ],
        C,
        18
      ),
      "faint",
      { crease: "none" }
    ),
    solid(
      turned(
        frame,
        [
          [half, 0.3],
          [half + 0.3, 0.35],
          [height - 0.8, 2.1],
        ],
        C,
        18
      ),
      "faint",
      { crease: "none" }
    ),
    ...[0, 2.1, 4.2].map((angle) =>
      solid(
        post(
          [
            centre[0] + 2.1 * Math.cos(angle),
            centre[1] + 2.1 * Math.sin(angle),
          ],
          0.3,
          z + 0.8,
          height - 1.6,
          C,
          6
        ),
        "mid",
        { crease: "none" }
      )
    ),
    solid(post(centre, 2.6, z + height - 0.8, 0.8, C, 16), "mid"),
  ];
};

/** The maintainer's lever and sand-glass: left at its default, since this ask needs no person. */
export const lever = (): readonly Mark[] => {
  const x = HUMAN_X;
  const frame = frameAlong([x, 36, BRIDGE_TOP + 4], [0.55, 0, 0.83]);

  return [
    solid(post([x, 36], 2.4, BRIDGE_TOP + 4, 2, C, 16), "mid"),
    solid(rod(frame, 1, 12, 0.8, C, 10), "mid"),
    solid(rod(frame, 12, 15, 1.7, C, 14), "hi"),
    ...sandGlass([x - 1, 26.5], BRIDGE_TOP + 4),
  ];
};

/** A stage's flag on its crossbar: drawn by state, never coloured without its word. */
export const flag = (x: number) =>
  slab(
    { d: 1, r: 0.2, w: 6, x: x - 3, y: BRIDGE_POSTS[1] + 1 },
    BRIDGE_TOP + 4,
    4.5,
    C,
    { steps: 1 }
  );

/** The trays, one per stage: their backs and floors, behind whatever lands in them. */
export const trayBacks = (): readonly Mark[] =>
  STATIONS.flatMap((x) => [
    box([x - TRAY_HALF, TRAY_Y[0], 0], [x + TRAY_HALF, TRAY_Y[1], 1.4], "lo"),
    box(
      [x - TRAY_HALF, TRAY_Y[0], 1.4],
      [x + TRAY_HALF, TRAY_Y[0] + 1.2, TRAY_H],
      "mid"
    ),
    box(
      [x - TRAY_HALF, TRAY_Y[0] + 1.2, 1.4],
      [x - TRAY_HALF + 1.2, TRAY_Y[1] - 1.2, TRAY_H - 2],
      "mid"
    ),
  ]);

/** The trays' near walls, each with a label holder. */
export const trayFronts = (): readonly Mark[] =>
  STATIONS.flatMap((x) => [
    box(
      [x + TRAY_HALF - 1.2, TRAY_Y[0] + 1.2, 1.4],
      [x + TRAY_HALF, TRAY_Y[1] - 1.2, TRAY_H - 2],
      "mid"
    ),
    box(
      [x - TRAY_HALF, TRAY_Y[1] - 1.2, 1.4],
      [x + TRAY_HALF, TRAY_Y[1], TRAY_H - 3],
      "mid",
      { bevel: 0.3 }
    ),
    line(
      polyline(
        [
          [x - 5, TRAY_Y[1], 3],
          [x + 5, TRAY_Y[1], 3],
          [x + 5, TRAY_Y[1], 5.6],
          [x - 5, TRAY_Y[1], 5.6],
        ],
        C,
        true
      ),
      "lo"
    ),
    line(
      segment([x - 3.6, TRAY_Y[1], 4.3], [x + 1.6, TRAY_Y[1], 4.3], C),
      "faint",
      { free: true }
    ),
  ]);

/** Everything above a tray's floor, on screen: a slip rising in it shows only there. */
export const trayOpening = (x: number) => {
  const floor = [
    [x - TRAY_HALF + 1.2, TRAY_Y[0] + 1.2],
    [x + TRAY_HALF - 1.2, TRAY_Y[0] + 1.2],
    [x + TRAY_HALF - 1.2, TRAY_Y[1] - 1.2],
    [x - TRAY_HALF + 1.2, TRAY_Y[1] - 1.2],
  ].map(([px = 0, py = 0]) => flat([px, py, 1.4]));

  return pathOf(
    hullOf([...floor, ...floor.map(([sx, sy]): Flat => [sx, sy - 80])]),
    true
  );
};

/** A refusal's printed slip, built sunk in its tray; the motion raises it. */
export const slip = (x: number): readonly Mark[] => {
  const frame: Frame = {
    a: [0, 0.97, 0.26],
    o: [x, TRAY_Y[0] + 6, 1.4],
    u: X,
    v: [0, -0.26, 0.97],
  };

  const rule = (v: number, from: number, to: number) =>
    polyline([inFrame(frame, 0.5, [from, v]), inFrame(frame, 0.5, [to, v])], C);

  return [
    solid(prism(frame, rect(-6, 0, 6, 13), 0, 0.5, C), "hi", { crease: "lo" }),
    line(rule(11, -4.5, 3.5), "lo", { free: true }),
    line(rule(9, -4.5, 4.5), "lo", { free: true }),
    line(rule(7, -4.5, 1), "lo", { free: true }),
  ];
};

const armTip = (angle: number): Flat => [
  PIVOT[0] + Math.cos(angle) * ARM_R,
  PIVOT[1] + Math.sin(angle) * ARM_R,
];

const link = (x: number, angle: number) => {
  const frame: Frame = {
    a: [0, Math.cos(angle), Math.sin(angle)],
    o: [x, PIVOT[0], PIVOT[1]],
    u: X,
    v: [0, -Math.sin(angle), Math.cos(angle)],
  };

  return solid(
    prism(frame, rect(-1.1, -1.8, 1.1, 1.8), -3, ARM_R + 1.5, C),
    "mid"
  );
};

/** The press's far arm and the cradle between the arms, at the arms' angle. */
export const armBack = (angle: number): readonly Mark[] => {
  const tip = armTip(angle);
  const along: Point = [0, Math.cos(angle), Math.sin(angle)];

  const cradle: Frame = {
    a: X,
    o: [0, tip[0] - along[1] * 5, tip[1] - along[2] * 5],
    u: along,
    v: [0, -Math.sin(angle), Math.cos(angle)],
  };

  return [
    link(ARM_XS[0], angle),
    solid(
      prism(
        cradle,
        rect(-1.4, -1.4, 1.4, 1.4),
        ARM_XS[0] + 1.1,
        ARM_XS[1] - 1.1,
        C
      ),
      "mid"
    ),
  ];
};

/** The strip the press holds: turned over with the arms, its pins down onto the cylinder. */
export const armStrip = (angle: number) => {
  const over = angle - ARM_DOWN;
  const up: Point = [0, -Math.sin(over), Math.cos(over)];
  const tip = armTip(angle);

  return strip(false, {
    a: up,
    o: [SECTION_MID, tip[0] - up[1] * STRIP_T, tip[1] - up[2] * STRIP_T],
    u: X,
    v: [0, Math.cos(over), Math.sin(over)],
  });
};

/** The press's near arm. */
export const armFront = (angle: number): readonly Mark[] => [
  link(ARM_XS[1], angle),
];

/** The rod the rules follower pushes, and the cam box at the end of the rail it drives. */
export const rulesLink = (): readonly Mark[] => [
  solid(
    rod(
      frameAlong([FOLLOWER_X, -11, 14.6], Y),
      0,
      CAM_BOX.y + 2 + 11,
      1,
      C,
      12
    ),
    "mid",
    { crease: "none" }
  ),
  solid(slab(CAM_BOX, 0, 16, C, { bevel: 0.5, steps: 3 }), "mid", {
    inner: [line(sideSeam(CAM_BOX, 11, C, 3), "faint")],
  }),
  line(
    ringOnTop(
      [CAM_BOX.x + CAM_BOX.w / 2, CAM_BOX.y + CAM_BOX.d / 2],
      4.4,
      16,
      C,
      28
    ),
    "lo"
  ),
  screws(
    cornersOf(CAM_BOX, 2.4).map(([x, y]) => [x, y, 16]),
    0.42
  ),
];

/** The near end wall: a framed glass pane the right end of the movement shows through. */
export const glassWall = (): readonly Mark[] => {
  const x = CASE.x + CASE.w - WALL;
  const frame: Frame = { a: X, o: [x, 0, 0], u: Y, v: Z };

  const bar = (y0: number, z0: number, y1: number, z1: number) =>
    solid(prism(frame, rect(y0, z0, y1, z1), 0, WALL, C), "mid");

  const front = CASE.y + CASE.d;

  return [
    solid(
      prism(
        frame,
        rect(CASE.y + 5, CASE_FLOOR + 4, front - 5, WALL_TOP - 4),
        2.6,
        3.4,
        C
      ),
      "faint",
      {
        crease: "none",
        glass: true,
      }
    ),
    line(
      polyline(
        [
          [x + 3.4, front - 22, CASE_FLOOR + 3],
          [x + 3.4, front - 46, WALL_TOP - 3],
        ],
        C
      ),
      "faint"
    ),
    line(
      polyline(
        [
          [x + 3.4, front - 14, CASE_FLOOR + 3],
          [x + 3.4, front - 38, WALL_TOP - 3],
        ],
        C
      ),
      "faint"
    ),
    bar(CASE.y, CASE_FLOOR, CASE.y + 5, WALL_TOP),
    bar(CASE.y + 5, CASE_FLOOR, front - 5, CASE_FLOOR + 4),
    bar(CASE.y + 5, WALL_TOP - 4, front - 5, WALL_TOP),
    bar(front - 5, CASE_FLOOR, front, WALL_TOP),
    screws(
      [
        [x + WALL, CASE.y + 2.5, WALL_TOP - 2],
        [x + WALL, front - 2.5, WALL_TOP - 2],
        [x + WALL, CASE.y + 2.5, CASE_FLOOR + 2],
        [x + WALL, front - 2.5, CASE_FLOOR + 2],
      ],
      0.45
    ),
  ];
};

/** The crank outside the glass, on the arbor, at its angle. */
export const crank = (angle: number): readonly Mark[] => {
  const hub: Point = [CRANK_X, AXIS[0], AXIS[1]];
  const along: Point = [0, Math.cos(angle), Math.sin(angle)];

  const end: Point = [
    CRANK_X + 1.5,
    AXIS[0] + along[1] * CRANK_R,
    AXIS[1] + along[2] * CRANK_R,
  ];

  const armFrame: Frame = {
    a: along,
    o: hub,
    u: X,
    v: [0, -Math.sin(angle), Math.cos(angle)],
  };

  return [
    solid(rod(DRUM_FRAME, CASE.x + CASE.w, CRANK_X, 2.4, C, 18), "mid"),
    solid(rod(DRUM_FRAME, CRANK_X - 1, CRANK_X + 2, 4, C, 22), "mid"),
    solid(prism(armFrame, rect(-0.2, -2, 3, 2), 0, CRANK_R, C), "mid"),
    solid(rod(frameAlong(end, X), 1.5, 3, 2.2, C, 16), "mid"),
    solid(rod(frameAlong(end, X), 3, 11, 2, C, 18), "hi"),
    line(arcOn(frameAlong(end, X), 7, 2, C, 18), "faint"),
  ];
};

/** The ledger's printer and its roll, with the tape running out over the bench. */
export const printer = (): readonly Mark[] => {
  const roll = frameAlong([PRINTER.x + 4, PRINTER.y + 10, 28], X);

  const slot: Plan = {
    d: 1.4,
    r: 0.4,
    w: TAPE.w + 2,
    x: TAPE.x - 1,
    y: PRINTER.y + PRINTER.d - 0.7,
  };

  return [
    solid(slab(PRINTER, 0, 20, C, { bevel: 0.6, steps: 3 }), "mid", {
      inner: [line(sideSeam(PRINTER, 15, C, 3), "faint")],
    }),
    line(planOutline(slot, 20, C, 2), "lo"),
    line(
      polyline(
        [
          [TAPE.x - 1, PRINTER.y + PRINTER.d, 0.6],
          [TAPE.x + TAPE.w + 1, PRINTER.y + PRINTER.d, 0.6],
          [TAPE.x + TAPE.w + 1, PRINTER.y + PRINTER.d, 2.4],
          [TAPE.x - 1, PRINTER.y + PRINTER.d, 2.4],
        ],
        C,
        true
      ),
      "lo"
    ),
    box(
      [PRINTER.x + 2, PRINTER.y + 6, 20],
      [PRINTER.x + 6, PRINTER.y + 14, 28],
      "mid"
    ),
    box(
      [PRINTER.x + PRINTER.w - 6, PRINTER.y + 6, 20],
      [PRINTER.x + PRINTER.w - 2, PRINTER.y + 14, 28],
      "mid"
    ),
    solid(rod(roll, -1, PRINTER.w - 6, 7, C, 40), "hi"),
    line(ringOn(roll, PRINTER.w - 6, 2, C, 16), "lo"),
    screws(
      cornersOf(PRINTER, 2.5).map(([x, y]) => [x, y, 20]),
      0.42
    ),
  ];
};

/** The paper tape on the bench: a thin flat strip, printed by the motion. */
export const tape = (): readonly Mark[] => [
  solid(slab(TAPE, 0, 0.3, C, { steps: 1 }), "lo", {
    crease: "none",
    flat: true,
  }),
  line(
    polyline(
      [
        [TAPE.x, PRINTER.y + PRINTER.d, 0.3],
        [TAPE.x, TAPE.y, 0.3],
      ],
      C
    ),
    "lo"
  ),
];

/** One printed entry on the tape, at its distance out from the printer: two rule lines. */
export const entry = (out: number) => {
  const y = TAPE.y + 3 + out;

  return [
    onTop(
      [
        [TAPE.x + 2.5, y],
        [TAPE.x + 11, y],
      ],
      0.3,
      C
    ),
    onTop(
      [
        [TAPE.x + 2.5, y + 2.2],
        [TAPE.x + 8, y + 2.2],
      ],
      0.3,
      C
    ),
  ].join("");
};

/** The claim: a clip on the ruler over its section, carrying a sand-glass. */
export const claimClip = (): readonly Mark[] => {
  const from = sectionFrom(SECTION) + 0.6;
  const to = sectionTo(SECTION) - 0.6;

  return [
    box([from, -7.6, LIP_TOP + 0.5], [to, -2.6, LIP_TOP + 2], "hi"),
    line(
      onTop(
        [
          [from + 2, -5.1],
          [to - 7, -5.1],
        ],
        LIP_TOP + 2,
        C
      ),
      "faint",
      { free: true }
    ),
    ...sandGlass([to - 3.4, -5.1], LIP_TOP + 2, 8),
  ];
};

/** The ask's flag on its pin, at the sour tooth. */
export const askFlag = (x: number): readonly Mark[] => [
  solid(post([x, -4.6], 1.3, LIP_TOP + 0.5, 1.2, C, 14), "mid"),
  solid(post([x, -4.6], 0.5, LIP_TOP + 1.7, 21, C, 8), "mid", {
    crease: "none",
  }),
  solid(
    prism(
      frameAlong([x + 0.5, -4.6, LIP_TOP + 16.5], X),
      rect(-0.25, 0, 0.25, 6),
      0,
      8,
      C
    ),
    "hi",
    { crease: "lo", lit: true }
  ),
  solid(post([x, -4.6], 0.9, LIP_TOP + 22.7, 0.9, C, 10), "mid"),
];
