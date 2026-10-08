import { Functions } from "@repo/sdk";

import data from "./project.json" with { type: "json" };

/**
 * The convex-merged design's example project, as the data the sdk's
 * builders encode it to (`project.json`): a `fixBug` kind with a
 * red-then-green check, deciders by glob with the owners for the rest, the
 * budget and caps, `Assisted-by` trailers, and the record window. The run
 * block is the one found in CI; claims and the vouch file keep their
 * defaults.
 *
 * The example's one function-valued rule rides where the sdk keeps it,
 * under its `Functions` symbol, which JSON never meets: a proposal opens
 * alone for someone with three unreverted landings in the territory.
 */
const project = Object.defineProperty({ ...data }, Functions, {
  enumerable: false,
  value: {
    admit: undefined,
    opensAlone: (proposal: { readonly record: number }) => proposal.record >= 3,
  },
});

export default project;
