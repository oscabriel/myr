import handler from "@tanstack/react-start/server-entry";

import { addressedEntry } from "./server/addresses.ts";
import { edgeEntry } from "./server/edge-cache.ts";

export default edgeEntry(addressedEntry(handler));
