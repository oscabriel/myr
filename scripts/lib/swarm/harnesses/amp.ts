// Amp asks before running a command unless its settings say `amp.dangerouslyAllowAll`,
// so the workspace gets a settings file of its own. An archived thread cannot be
// continued, so every run passes `--no-archive-after-execute`.
import { streamJsonEvents } from "./claude-code.ts";
import type { HarnessDriver } from "./event.ts";

export const ampSettingsFile = (dir: string) => `${dir}/amp-settings.json`;

const headless = (model: string, dir: string) => [
  "--stream-json",
  "-m",
  model,
  "--settings-file",
  ampSettingsFile(dir),
  "--no-archive-after-execute",
];

export const amp: HarnessDriver = {
  files: ({ dir }) => [
    {
      content: `${JSON.stringify({ "amp.dangerouslyAllowAll": true }, null, 2)}\n`,
      path: ampSettingsFile(dir),
    },
  ],
  harness: "amp",
  parse: streamJsonEvents("assistant"),
  resume: ({ model, prompt, session, workspace }) => [
    "amp",
    "threads",
    "continue",
    session,
    "-x",
    prompt,
    ...headless(model, workspace.dir),
  ],
  start: ({ brief, model, workspace }) => [
    "amp",
    "-x",
    brief,
    ...headless(model, workspace.dir),
  ],
};
