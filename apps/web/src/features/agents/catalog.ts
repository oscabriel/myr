/**
 * The CLI's commands as `bun run gen` writes them, read at build time, so
 * `llms.txt` lists what the CLI has rather than a copy (issue 505).
 */
import { Effect, Schema } from "effect";

import catalog from "../../../../../docs/reference/commands.json";
import { CommandsJson } from "./commands.ts";

/**
 * `docs/reference/commands.json`, decoded. `gen:check` keeps the file in
 * this shape, so a catalog that does not decode is a defect of the build,
 * not of a request.
 */
export const commands = Schema.decodeUnknownEffect(CommandsJson)(catalog).pipe(
  Effect.orDie
);
