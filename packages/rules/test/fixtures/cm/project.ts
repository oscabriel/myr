import { Functions } from "@repo/sdk";

import data from "./project.json" with { type: "json" };

const project = Object.defineProperty({ ...data }, Functions, {
  enumerable: false,
  value: {
    admit: undefined,
    opensAlone: (proposal: { readonly record: number }) => proposal.record >= 3,
  },
});

export default project;
