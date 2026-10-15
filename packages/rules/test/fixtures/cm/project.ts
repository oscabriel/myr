import { Functions } from "@repo/sdk";

import data from "./project.json" with { type: "json" };

const project = Object.defineProperty({ ...data }, Functions, {
  enumerable: false,
  value: {
    admit: (claimant: { readonly record: number }) => claimant.record >= 3,
  },
});

export default project;
