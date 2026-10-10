/**
 * A code page's 404: the refusal the platform gave (`UnknownProject`,
 * `UnknownRevision`, `UnknownPath`, `UnknownCommit`), as `git` would print
 * it, carried in the loader's not-found; or, for an address that can name
 * nothing, a sentence saying why.
 */
import { Option, Schema } from "effect";

import { NotFoundView } from "../ask/refused.tsx";
import { Refusals } from "../shared/refusals.ts";

const decodeRefusals = Schema.decodeUnknownOption(Refusals);

const NOTHING =
  "Nothing is at this address: a code page names a project, then main, a whole 40-hex commit id or a tag, then a path in the project.";

export const CodeNotFound = ({ data }: { readonly data?: unknown }) => (
  <NotFoundView
    nothing={NOTHING}
    refusals={Option.getOrUndefined(decodeRefusals(data))}
    title="Not found"
  />
);
