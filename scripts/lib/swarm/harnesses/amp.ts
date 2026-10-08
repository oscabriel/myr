/**
 * Amp, headless: execute mode (`-x`) with Claude Code-compatible stream JSON,
 * in an agent mode (`-m`, the contributor's "model"). Amp asks before it
 * runs a command unless its settings say `amp.dangerouslyAllowAll`, so the
 * workspace gets a settings file of its own (`--settings-file`; the
 * workspace's `XDG_CONFIG_HOME` hides the user's). A thread that execute
 * mode archives cannot be continued ("This thread is archived and cannot be
 * continued", found on the first resume), so every run passes
 * `--no-archive-after-execute`; `amp threads continue <id> -x` resumes it.
 */
import { streamJsonEvents } from "./claude-code.ts";
import type { HarnessDriver } from "./event.ts";

/** The workspace's Amp settings: `<dir>/amp-settings.json`. */
export const ampSettingsFile = (dir: string) => `${dir}/amp-settings.json`;

/** The flags every run shares: stream JSON, the mode, the settings, and a thread kept open. */
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
