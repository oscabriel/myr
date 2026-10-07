import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";

import { oauthProvider, signInServices } from "./auth/provider.ts";
import { decodeEnv, platformOf } from "./platform.ts";
import { serve } from "./surfaces.ts";

export { Project } from "./project-do.ts";

export { Answer } from "./workflows/answer.ts";

export { OnPush } from "./workflows/on-push.ts";

// Built once per isolate, at module load, touching no binding: the env is
// decoded once for the fetch handler, and both the platform's services and
// sign-in's are made from what it decoded to; an env that fails to decode
// fails them both, on use. (Each Project DO and Workflow decodes the same
// env the same way, for its own ports.)
const config = Effect.runSyncExit(decodeEnv(env));

const platform = serve(Layer.unwrap(Effect.map(config, platformOf)));

// OAuth and sign-in answer their own paths and hand the rest to the
// platform (W3 316).
const { handler } = oauthProvider(
  Layer.unwrap(Effect.map(config, signInServices)),
  (request) => platform.handler(request)
);

export default handler;
