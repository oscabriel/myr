import type { Posture } from "@repo/protocol/posture";

import { POSTURE_MARKS } from "../shared/mark-look.ts";
import { postureLabel, postureWord } from "./posture-label.ts";

/** A project's posture in a list of projects: its mark, its word, and the whole label for a screen reader. */
export const PostureMark = ({ posture }: { readonly posture: Posture }) => {
  const { icon: Icon, tone } = POSTURE_MARKS[posture];

  return (
    <span
      className="text-label text-muted-foreground ml-auto flex shrink-0 items-center gap-1 font-normal"
      data-posture={posture}
      title={postureLabel(posture)}
    >
      <Icon
        aria-hidden="true"
        className={`size-3.5 ${tone}`}
        strokeWidth={1.75}
      />
      {postureWord(posture)}
      <span className="sr-only">: {postureLabel(posture)}</span>
    </span>
  );
};
