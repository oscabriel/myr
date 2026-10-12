import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Schema } from "effect";

export const TEN_LISTED = Schema.decodeSync(Schema.Array(ProjectListing))([
  { openAsks: 1, posture: "open", project: "oscabriel/alpha" },
  { openAsks: 5, posture: "open", project: "oscabriel/datekit" },
  { openAsks: 0, posture: "open", project: "oscabriel/zeta" },
  { openAsks: 9, posture: "open", project: "oscabriel/burrow" },
  { openAsks: 3, posture: "open", project: "oscabriel/kite" },
  { openAsks: 5, posture: "open", project: "github.com/pallets/click" },
  { openAsks: 0, posture: "open", project: "oscabriel/yarrow" },
  { openAsks: 2, posture: "open", project: "github.com/sindresorhus/ky" },
  { openAsks: 3, posture: "open", project: "oscabriel/hearth" },
  { openAsks: 7, posture: "open", project: "oscabriel/ember" },
]);

export const EIGHT_LEADING = [
  "oscabriel/burrow",
  "oscabriel/ember",
  "github.com/pallets/click",
  "oscabriel/datekit",
  "oscabriel/hearth",
  "oscabriel/kite",
  "github.com/sindresorhus/ky",
  "oscabriel/alpha",
] as const;
