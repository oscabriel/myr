import handler from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";

import { addressedEntry } from "./server/addresses.ts";
import { edgeEntry } from "./server/edge-cache.ts";
import { renewingEntry } from "./server/session.ts";

export default edgeEntry(renewingEntry(env)(addressedEntry(handler)));
