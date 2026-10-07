import data from "./project.json" with { type: "json" };

/**
 * The convex-merged design's example project (its §3), as the data the sdk's
 * builders encode it to (`project.json`): a `fixBug` kind with a
 * red-then-green check, deciders by glob with the owners for the rest, the
 * budget and caps, `Assisted-by` trailers, and the record window. The run
 * block is the one found in CI; claims and the vouch file keep their
 * defaults.
 *
 * The example's one function-valued rule rides beside the data, where JSON
 * leaves it out: a proposal opens alone for someone who has held three asks.
 */
const project = Object.defineProperty({ ...data }, "opensAlone", {
  enumerable: false,
  value: (facts: { readonly held: number }) => facts.held >= 3,
});

export default project;
