import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";

import { oauthProvider, signInServices } from "./auth/provider.ts";
import { decodeEnv, platformOf } from "./platform.ts";
import { telemetryOf } from "./ports.ts";
import { serve } from "./surfaces.ts";

export { Project } from "./project-do.ts";

export { Answer } from "./workflows/answer.ts";

export { OnPush } from "./workflows/on-push.ts";

// Built at module load, touching no binding. Both routers' builds await nothing, so
// no request ever waits on a build another request started.
const config = Effect.runSyncExit(decodeEnv(env));

const telemetry = Layer.unwrap(Effect.map(config, telemetryOf));

const platform = serve(Layer.unwrap(Effect.map(config, platformOf)), telemetry);

const { handler } = oauthProvider(
  Layer.unwrap(Effect.map(config, signInServices)),
  (request) => platform.handler(request),
  telemetry
);

export default handler;
