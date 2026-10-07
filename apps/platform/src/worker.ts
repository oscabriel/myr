import { env } from "cloudflare:workers";

import { platform } from "./platform.ts";
import { serve } from "./surfaces.ts";

export { Project } from "./project-do.ts";

export { Answer } from "./workflows/answer.ts";

export { OnPush } from "./workflows/on-push.ts";

// Built once per isolate, at module load: the env is decoded here and nowhere
// else.
const { handler } = serve(platform(env));

export default {
  fetch: (request) => handler(request),
} satisfies ExportedHandler<Env>;
