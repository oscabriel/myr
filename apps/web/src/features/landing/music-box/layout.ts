/**
 * Where every part of the music box sits, in world units: x along the
 * cylinder, y toward the viewer, z up. One camera serves the static art and
 * every frame of the motion.
 */
import { boxCorners, fitCamera } from "./iso.ts";
import type { Flat, Plan, Point } from "./iso.ts";

export const WIDTH = 760;

export const HEIGHT = 470;

/** The bench everything stands on. */
export const BASE: Plan = { d: 196, r: 8, w: 368, x: -200, y: -106 };

export const BASE_H = 12;

export const FOOT_H = 5;

/** The music box's case, its front left open so the comb shows. */
export const CASE: Plan = { d: 96, r: 2, w: 284, x: -172, y: -98 };

export const CASE_FLOOR = 5;

export const WALL = 6;

export const WALL_TOP = 58;

/** The brass bedplate the movement is built on. */
export const BED: Plan = { d: 74, r: 2, w: 252, x: -160, y: -88 };

export const BED_TOP = 9;

/** The cylinder's axis, along x. */
export const AXIS: Flat = [-50, 33];

export const DRUM_R = 19;

export const PIN_LENGTH = 2.2;

export const TEETH = 40;

export const PITCH = 4.35;

export const FIRST_TOOTH = -120;

export const TEETH_PER_SECTION = 4;

export const toothX = (tooth: number) => FIRST_TOOTH + tooth * PITCH;

/** Where the tune's surface runs, flange to flange. */
export const DRUM_FROM = toothX(0) - 3.2;

export const DRUM_TO = toothX(TEETH - 1) + 3.2;

/** The rules track: a short drum of its own on the same arbor, whose pins drive the gate. */
export const RULES_FROM = DRUM_TO + 5;

export const RULES_TO = RULES_FROM + 11;

export const ARBOR_FROM = -150;

export const ARBOR_TO = 121;

export const BRIDGES = [-140, 84] as const;

export const BRIDGE_W = 7;

/** The comb: teeth tips just clear of the pins, root on a cast block. */
export const TOOTH_TIP = -29.8;

export const TOOTH_ROOT = -16;

export const COMB_BACK = -10;

export const COMB_Z = 30;

export const COMB_T = 1.4;

export const TOOTH_W = 3.3;

/** The section an ask names: its territory, four teeth wide. */
export const SECTION = 9;

export const sectionFrom = (section: number) =>
  toothX(section * TEETH_PER_SECTION) - PITCH / 2;

export const sectionTo = (section: number) =>
  toothX(section * TEETH_PER_SECTION + TEETH_PER_SECTION - 1) + PITCH / 2;

export const SECTION_MID = (sectionFrom(SECTION) + sectionTo(SECTION)) / 2;

/** The front lip of the case, with the ruler of teeth and sections on top. */
export const LIP: Plan = { d: 6, r: 1, w: 272, x: -166, y: -8 };

export const LIP_TOP = 11;

/** The gate: a rail along the front, one bridge per stage over it. */
export const RAIL_BED: Plan = { d: 18, r: 2, w: 268, x: -192, y: 28 };

export const RAIL_BED_TOP = 5;

export const RAILS = [31, 41] as const;

export const RAIL_TOP = 8;

export const CARRIAGE_HALF = 15;

export const CARRIAGE_TOP = 11;

export const STRIP_Y: Flat = [34, 40];

export const STRIP_T = 1.2;

/** Where the carriage takes an answer in, and where the press takes it from. */
export const INTAKE_X = -174;

export const PRESS_X = SECTION_MID;

/** The seven stages, cheapest first, each a bridge over the rail. */
export const STATIONS = [-146, -120, -94, -68, -42, -16, 10] as const;

export const BRIDGE_POSTS = [24, 48] as const;

export const BRIDGE_TOP = 30;

/** One tray per stage, in front of its bridge: every refused answer ends in exactly one. */
export const TRAY_Y: Flat = [56, 78];

export const TRAY_HALF = 10;

export const TRAY_H = 10;

/** The press: two arms that swing an answer over the comb onto the cylinder. */
export const PIVOT: Flat = [-7, 33.8];

export const ARM_XS = [SECTION_MID - 11.5, SECTION_MID + 11.5] as const;

/** Where the arm's cradle holds the strip: on the carriage, and on the cylinder's top. */
export const GRIP_LOW: Flat = [37, 12.2];

export const ARM_R = Math.hypot(GRIP_LOW[0] - PIVOT[0], GRIP_LOW[1] - PIVOT[1]);

export const ARM_DOWN = Math.atan2(
  GRIP_LOW[1] - PIVOT[1],
  GRIP_LOW[0] - PIVOT[0]
);

export const ARM_OVER = ARM_DOWN + Math.PI;

export const ARM_PARK = (96 * Math.PI) / 180;

/** The lid, hinged on the back wall and opened past upright. */
export const HINGE: Flat = [CASE.y + WALL / 2, WALL_TOP];

export const LID_OPEN = (112 * Math.PI) / 180;

export const LID_DEPTH = 74;

/** The ledger: a printer whose paper tape runs out toward the viewer. */
export const PRINTER: Plan = { d: 26, r: 2, w: 36, x: 104, y: 12 };

export const TAPE: Plan = { d: 44, r: 0, w: 14, x: 115, y: 38 };

/** The rules follower and the rod it pushes to the gate's cam box. */
export const FOLLOWER_X = (RULES_FROM + RULES_TO) / 2;

export const CAM_BOX: Plan = { d: 18, r: 1.5, w: 16, x: 60, y: 28 };

/** The crank, outside the right wall, on the arbor. */
export const CRANK_X = ARBOR_TO - 2;

export const CRANK_R = 15;

const lidTop: Point = [
  CASE.x,
  HINGE[0] + Math.cos(LID_OPEN) * LID_DEPTH,
  HINGE[1] + Math.sin(LID_OPEN) * LID_DEPTH,
];

export const CAMERA = fitCamera(
  [
    ...boxCorners(BASE, -BASE_H - FOOT_H, 0),
    lidTop,
    [CASE.x + CASE.w, lidTop[1], lidTop[2]],
    [SECTION_MID, PIVOT[0], PIVOT[1] + ARM_R + 4],
  ],
  { azimuth: 58, elevation: 30, height: HEIGHT, pad: 22, width: WIDTH }
);
