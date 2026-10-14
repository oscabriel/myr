/**
 * What the drawing is made of: solids, lines and dots, each with its tone,
 * built as data so the server and the browser draw the same paths.
 */
import type { Flat, Solid } from "./iso.ts";

/** Base and feet are `lo`, structure `mid`, the subject `hi`, grooves `faint`. */
export type Tone = "hi" | "mid" | "lo" | "faint";

/** A state colour, always beside the readout's word for it. */
export type State = "landed" | "refused" | "sealed" | "checking";

export interface SolidMark {
  readonly kind: "solid";
  readonly solid: Solid;
  readonly tone: Tone;
  readonly crease?: Tone | "none";
  /** The one accent: the part the reader should watch. */
  readonly lit?: boolean;
  /** No side tones: a floor or an inlay thinner than a unit. */
  readonly flat?: boolean;
  /** Glass: a pale pane the parts behind show through. */
  readonly glass?: boolean;
  /** Seams and bands that sit under the silhouette. */
  readonly inner?: readonly LineMark[];
}

export interface LineMark {
  readonly kind: "line";
  readonly d: string;
  readonly tone: Tone | "lit";
  /** An end meant to stop on a bare face: rule lines that stand for print. */
  readonly free?: boolean;
  readonly width?: number;
}

export interface DotsMark {
  readonly kind: "dots";
  readonly points: readonly Flat[];
  readonly size: number;
  readonly tone: Tone;
}

export type Mark = SolidMark | LineMark | DotsMark;

export const solid = (
  paths: Solid,
  tone: Tone,
  options: Omit<SolidMark, "kind" | "solid" | "tone"> = {}
): SolidMark => ({ kind: "solid", solid: paths, tone, ...options });

export const line = (
  d: string,
  tone: Tone | "lit" = "lo",
  options: Omit<LineMark, "kind" | "d" | "tone"> = {}
): LineMark => ({ d, kind: "line", tone, ...options });

export const dots = (
  points: readonly Flat[],
  size = 0.5,
  tone: Tone = "mid"
): DotsMark => ({ kind: "dots", points, size, tone });
