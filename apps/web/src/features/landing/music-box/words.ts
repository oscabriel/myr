/** The music box's card and legend: what each part stands for, in GLOSSARY.md's words. */

export const FIGURE = {
  caption:
    "Everything on main is public, under glass. A project states each change it wants as a tooth that plays sour; anyone can claim it and push an answer. The gate checks every answer, cheapest stage first: a refused answer drops into that stage's tray with its reason, and one that passes every stage is pinned by the press, which alone writes the cylinder.",
  fig: "Fig 1",
  hint: "Click or press Space for the next step",
  label:
    "A cylinder music box under an open glass lid, with a seven-stage gate along its front. The ask is a comb tooth that plays sour. A first answer, a strip of pins, is refused at the second stage and drops into its tray with a printed slip; a second passes all seven, and the press turns it onto the cylinder while a tape prints its credit. Arrow keys step through the story.",
  title: "A music box only its own press can pin",
} as const;

export type KeyMark =
  | "raised"
  | "lit"
  | "landed"
  | "refused"
  | "sealed"
  | "glass";

export interface Key {
  readonly word: string;
  readonly part: string;
  readonly mark: KeyMark;
}

export const KEYS: readonly Key[] = [
  {
    mark: "raised",
    part: "the pinned cylinder; only the press writes it.",
    word: "main",
  },
  {
    mark: "glass",
    part: "the glass lid. A frosted panel is a layer.",
    word: "Public",
  },
  { mark: "lit", part: "the lit tooth, a note that plays sour.", word: "Ask" },
  {
    mark: "raised",
    part: "that tooth's section of the comb.",
    word: "Territory",
  },
  {
    mark: "raised",
    part: "the clip on the section, with its sand-glass.",
    word: "Claim",
  },
  { mark: "raised", part: "a strip of pins on the carriage.", word: "Answer" },
  {
    mark: "raised",
    part: "seven bridges over the rail, cheapest first.",
    word: "Gate",
  },
  {
    mark: "sealed",
    part: "the sealed box: one bell, pass or fail.",
    word: "Held-back check",
  },
  {
    mark: "refused",
    part: "the tray under the stage that refused, and its slip.",
    word: "Refusal",
  },
  {
    mark: "landed",
    part: "the press turns the strip onto the cylinder; the tape prints the credit.",
    word: "Landing",
  },
];
